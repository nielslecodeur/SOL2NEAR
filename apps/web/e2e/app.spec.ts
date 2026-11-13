// Browser tests in the REAL local Google Chrome (Playwright, channel "chrome").
// Tags:
//   @live  real NEAR testnet reads (read-only RPC), real Wallet Selector. Nothing is signed.
//   @mock  a MOCKED wallet injected through the e2e-only hook (never a real wallet) and/or intercepted RPC.
// No test clicks anything that could reach a real wallet signature: the only "Confirm & open wallet" clicks
// happen with the mocked wallet, which rejects and never touches the network.
import { expect, test, type Page } from "@playwright/test";

const RPCS = ["https://near-testnet.drpc.org", "https://test.rpc.fastnear.com"];
const DEV = "sol2near-dev.testnet";
const TREASURY = "treasury.sol2near-dev.testnet";

/** Test-side read-only view (same two public providers as the app). */
async function view<T>(account: string, method: string, args: object = {}): Promise<T> {
  let last: unknown;
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = await r.json();
      if (j.result?.result) return JSON.parse(Buffer.from(j.result.result).toString());
      last = j.error ?? j;
    } catch (e) { last = e; }
  }
  throw new Error(`view ${method}: ${String((last as Error)?.message ?? JSON.stringify(last))}`);
}

/** Collects JS errors; the Tidepool DNS failure of this network is expected and filtered. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/usetidepool|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** MOCK wallet through the e2e-only hook. signAndSend always rejects and counts calls; it never uses the network. */
async function mockWallet(page: Page, accountId: string) {
  await page.addInitScript((id) => {
    (window as any).__signCalls = 0;
    (window as any).__SOL2NEAR_E2E_WALLET__ = {
      accountId: id,
      connect() {},
      async disconnect() {},
      subscribe() { return () => {}; },
      async signAndSend() { (window as any).__signCalls++; throw new Error("User rejected the request"); },
    };
  }, accountId);
}

const nearPanel = (page: Page) => page.locator("section.nearpanel");

test.describe("@live real testnet reads, real Wallet Selector", () => {
  test("loads without JS errors; Treasury totals equal get_accounting", async ({ page }) => {
    const errors = watchErrors(page);
    const acc = await view<{ total_received: string; recorded_shares: string }>(TREASURY, "get_accounting");
    await page.goto("/");
    const total = (Number(BigInt(acc.total_received)) / 1e6).toString();
    await expect(page.locator(".stat", { hasText: "USDC received by Treasury (all creators)" }).locator("b")).toHaveText(total);
    await expect(page.getByText("BACKED ON REF")).toBeVisible();
    await expect(page.getByText("SIMULATED / DEMO DATA: nothing on this screen comes from a chain.")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("no session: Connect button; the real modal lists MyNearWallet and Meteor; closing it signs nothing", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    const connect = nearPanel(page).getByRole("button", { name: "Connect NEAR wallet" });
    await expect(connect).toBeVisible();
    await connect.click();
    await expect(page.getByText("MyNearWallet", { exact: true })).toBeVisible({ timeout: 20_000 }); // wallet chunk is lazy-loaded
    await expect(page.getByText("Meteor Wallet", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/wallet-modal.png" });
    await page.keyboard.press("Escape");
    await expect(connect).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("sol2near.near-tx"))).toBeNull();
    expect(errors).toEqual([]);
  });

  test("watch mode for the dev account shows the real G2 deposit and FUEL claim", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Creator account").fill(DEV);
    // exact match, inside the watch form: "Loading wallets…" (NEAR panel) also contains "Load"
    await page.locator("form.watch").getByRole("button", { name: "Load", exact: true }).click();
    const row = page.locator(".row", { hasText: "20 USDC" });
    await expect(row).toContainText("LP CONFIRMED");
    await expect(row).toContainText("Claimed");
  });

  test("demo mode is labelled SIMULATED and hides the NEAR panel; live mode shows no simulated data", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Data source").selectOption("demo");
    await expect(page.getByText("SIMULATED / DEMO DATA: nothing on this screen comes from a chain.")).toBeVisible();
    await expect(nearPanel(page)).toHaveCount(0);
    await page.screenshot({ path: "test-results/demo.png", fullPage: true });
    await page.getByLabel("Data source").selectOption("testnet");
    await expect(page.getByText("SIMULATED / DEMO DATA: nothing on this screen comes from a chain.")).toHaveCount(0);
    await expect(nearPanel(page)).toBeVisible();
  });

  test("strict CSP without 'unsafe-eval': app and wallet modal work; only zod's caught capability probe is reported", async ({ page }) => {
    const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:; frame-src https:";
    const violations: string[] = [];
    await page.exposeFunction("__reportCsp", (v: string) => violations.push(v));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as any).__reportCsp(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile?.split("/").pop()}`)));
    await page.route("**/", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const r = await route.fetch();
      return route.fulfill({ response: r, headers: { ...r.headers(), "content-security-policy": csp } });
    });
    const errors = watchErrors(page);
    await page.goto("/");
    await expect(page.getByText("BACKED ON REF")).toBeVisible();
    await nearPanel(page).getByRole("button", { name: "Connect NEAR wallet" }).click();
    await expect(page.getByText("MyNearWallet", { exact: true })).toBeVisible({ timeout: 20_000 });
    // zod v4 (via @meteorwallet/sdk) probes `new Function("")` inside try/catch at load and falls back to jitless mode.
    expect(violations.every((v) => v.startsWith("script-src eval") && /^script-src eval\s+wallet-/.test(v)), violations.join(" ; ")).toBe(true);
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });

  test("dev server (README step 6): renders, no JS error, real wallet modal opens", async ({ page }) => {
    // Regression G6: the dev server rendered a blank page (`Buffer`/`global`/`process` not defined) while the
    // production build worked. src/polyfills.ts fixes it.
    const errors = watchErrors(page);
    await page.goto("http://127.0.0.1:4184/");
    const connect = nearPanel(page).getByRole("button", { name: "Connect NEAR wallet" });
    await expect(connect).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("BACKED ON REF")).toBeVisible();
    await connect.click();
    await expect(page.getByText("MyNearWallet", { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test("mobile 390px: no horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(nearPanel(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("@mock mocked wallet (e2e hook) + real testnet reads", () => {
  test("connected: balances read live, Treasury acceptance and storage shown", async ({ page }) => {
    await mockWallet(page, DEV);
    const errors = watchErrors(page);
    await page.goto("/");
    const panel = nearPanel(page);
    await expect(panel.getByText(DEV, { exact: true })).toBeVisible();
    await expect(panel.getByText("accepted by Treasury")).toBeVisible();
    const usdc = await view<string>("usdc.tidepool-sandbox.testnet", "ft_balance_of", { account_id: DEV });
    await expect(panel.locator(".stat", { hasText: "USDC on NEAR" }).locator("b")).toHaveText((Number(BigInt(usdc)) / 1e6).toString());
    await page.screenshot({ path: "test-results/connected-mock.png", fullPage: true });
    expect(errors).toEqual([]);
  });

  test("deposit form: invalid, below minimum, over balance are refused before any review", async ({ page }) => {
    await mockWallet(page, DEV);
    await page.goto("/");
    const panel = nearPanel(page);
    await expect(panel.getByText("accepted by Treasury")).toBeVisible();
    const input = panel.getByLabel("USDC amount");
    const deposit = panel.getByRole("button", { name: "Deposit to Treasury" });
    for (const [value, msg] of [["abc", /positive amount/], ["0.5", /Minimum deposit is 1 USDC/], ["100000", /exceeds your USDC balance/], ["1.0000001", /at most 6 decimals/]] as const) {
      await input.fill(value);
      await expect(panel.locator(".problems")).toContainText(msg);
      await expect(deposit).toBeDisabled();
    }
  });

  test("2 USDC: 90/8/2 preview, exact review, mocked rejection recorded, nothing sent; history survives reload", async ({ page }) => {
    await mockWallet(page, DEV);
    await page.goto("/");
    const panel = nearPanel(page);
    await expect(panel.getByText("accepted by Treasury")).toBeVisible();
    await panel.getByLabel("USDC amount").fill("2");
    await expect(panel.locator(".split")).toContainText("LP 1.8");
    await panel.getByRole("button", { name: "Deposit to Treasury" }).click();
    const review = page.getByRole("dialog", { name: "Review before signing" });
    await expect(review).toContainText("Token: usdc.tidepool-sandbox.testnet");
    await expect(review).toContainText("Amount: 2 USDC = 2000000 atomic");
    await expect(review).toContainText(`receiver ${TREASURY}, msg {"action":"deposit"}, 1 yoctoNEAR, 100 Tgas`);
    await expect(review).toContainText("LP 1.8 · creator reserve 0.16 · community 0.04");
    await page.screenshot({ path: "test-results/review-2usdc.png", fullPage: true });
    await review.getByRole("button", { name: "Confirm & open wallet" }).click();
    await expect(panel.locator(".histrow").first()).toContainText("rejected");
    await expect(panel.locator(".histrow").first()).toContainText("nothing was sent");
    expect(await page.evaluate(() => (window as any).__signCalls)).toBe(1);
    await page.reload();
    await expect(nearPanel(page).locator(".histrow").first()).toContainText("rejected");
  });

  test("balances received after connecting appear with Refresh (G6 regression)", async ({ page }) => {
    await mockWallet(page, DEV);
    await page.goto("/");
    const panel = nearPanel(page);
    await expect(panel.getByText("accepted by Treasury")).toBeVisible();
    // MOCK: from now on the RPC reports 123 USDC for the account (as if the faucet had just paid it)
    await page.route(/near-testnet\.drpc\.org|test\.rpc\.fastnear\.com/, async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes("ft_balance_of") && body.includes(Buffer.from(JSON.stringify({ account_id: DEV })).toString("base64")))
        return route.fulfill({ json: { jsonrpc: "2.0", id: "sol2near", result: { result: Array.from(Buffer.from('"123000000"')), logs: [], block_height: 1, block_hash: "x" } } });
      return route.continue();
    });
    await panel.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(panel.locator(".stat", { hasText: "USDC on NEAR" }).locator("b")).toHaveText("123");
  });

  test("mainnet account from the wallet is refused", async ({ page }) => {
    await mockWallet(page, "alice.near");
    await page.goto("/");
    await expect(nearPanel(page).getByText("alice.near is not a NEAR testnet account")).toBeVisible();
    await expect(nearPanel(page).getByRole("button", { name: "Deposit to Treasury" })).toHaveCount(0);
  });

  test("browser-wallet return: hash attached, unknown tx stays 'verifying', a new deposit is blocked", async ({ page }) => {
    await mockWallet(page, DEV);
    await page.addInitScript((dev) => {
      if (!localStorage.getItem("sol2near.near-tx"))
        localStorage.setItem("sol2near.near-tx", JSON.stringify([{ id: "e2e-1", kind: "deposit", accountId: dev, createdAt: 1, updatedAt: 1, status: "awaiting_signature", amount: "2000000" }]));
    }, DEV);
    // MOCK: the RPC answers UNKNOWN_TRANSACTION for tx status (the fake hash does not exist); other reads stay real.
    await page.route(/near-testnet\.drpc\.org|test\.rpc\.fastnear\.com/, async (route) => {
      if ((route.request().postData() ?? "").includes("EXPERIMENTAL_tx_status"))
        return route.fulfill({ json: { jsonrpc: "2.0", id: "sol2near", error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" }, message: "unknown" } } });
      return route.continue();
    });
    await page.goto("/?transactionHashes=E2EFakeHash111");
    const panel = nearPanel(page);
    await expect(panel.locator(".histrow").first()).toContainText("submitted");
    await expect(page).toHaveURL(/\/$/); // wallet params removed from the URL
    await expect(panel.getByText("accepted by Treasury")).toBeVisible();
    await panel.getByLabel("USDC amount").fill("2");
    await panel.getByRole("button", { name: "Deposit to Treasury" }).click();
    await expect(panel.getByText(/A previous deposit is not resolved yet \(submitted\)/)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Review before signing" })).toHaveCount(0);
  });

  test("NEAR RPC unavailable: clear errors, no crash, nothing sent", async ({ page }) => {
    await mockWallet(page, DEV);
    const errors = watchErrors(page);
    await page.route(/near-testnet\.drpc\.org|test\.rpc\.fastnear\.com/, (route) => route.abort("failed")); // MOCK outage of BOTH providers
    await page.goto("/");
    await expect(nearPanel(page).getByText(/Could not read NEAR testnet/)).toBeVisible();
    await expect(page.getByText(/Testnet read failed/)).toBeVisible();
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
    expect(await page.evaluate(() => (window as any).__signCalls)).toBe(0);
  });
});

// ---- V4.0 Pool Explorer: READ ONLY. No wallet is involved; the mocked wallet only counts that nothing was signed. ----
const PILOT_KEY = "near-testnet:ref-finance-101.testnet:2951";
const card = (page: Page, key: string) => page.locator(`article[data-pool="${key}"]`);

test.describe("@live V4.0 Pool Explorer (real testnet + mainnet reads, read-only)", () => {
  test("catalogue read live: only pool 2951 is selectable; memecoin and mainnet pools are observe only with reasons", async ({ page }) => {
    const errors = watchErrors(page);
    const pool = await view<{ total_fee: number }>("ref-finance-101.testnet", "get_pool", { pool_id: 2951 });
    await page.goto("/#/pools");
    await expect(page.locator("article.pool")).toHaveCount(6, { timeout: 30_000 });
    await expect(page.getByText(/1 selectable of 6/)).toBeVisible({ timeout: 30_000 });
    const pilot = card(page, PILOT_KEY);
    await expect(pilot).toContainText("ELIGIBLE");
    await expect(pilot).toContainText(`${pool.total_fee} bps`); // fee read live, equal to get_pool
    await expect(pilot.getByRole("button", { name: "Select this pool" })).toBeVisible();
    for (const key of ["near-testnet:ref-finance-101.testnet:2131", "near-testnet:ref-finance-101.testnet:2190", "near-mainnet:v2.ref-finance.near:5462", "near-mainnet:v2.ref-finance.near:4276", "near-mainnet:dclv2.ref-labs.near:nearly-993927.nearlytrade.near|wrap.near|10000"]) {
      const c = card(page, key);
      await expect(c).toContainText("OBSERVE ONLY");
      await expect(c.getByRole("button")).toHaveCount(0);
      await expect(c.getByLabel("Why observe only")).toContainText("Not selectable.");
    }
    await expect(card(page, "near-testnet:ref-finance-101.testnet:2131")).toContainText(/appear only in pool 2951/);
    await expect(card(page, "near-mainnet:dclv2.ref-labs.near:nearly-993927.nearlytrade.near|wrap.near|10000")).toContainText(/positions are NFTs/);
    await page.screenshot({ path: "test-results/v4-pools.png", fullPage: true });
    expect(errors).toEqual([]);
  });

  test("select 2951: survives a reload, and the read-only preflight equals Ref's own get_return", async ({ page }) => {
    await mockWallet(page, DEV);
    await page.goto("/#/pools");
    await card(page, PILOT_KEY).getByRole("button", { name: "Select this pool" }).click({ timeout: 30_000 });
    await page.reload();
    const sel = page.getByLabel("Selected pool preflight");
    await expect(sel).toContainText("= Treasury pool", { timeout: 30_000 });
    await sel.getByRole("button", { name: "Quote (read-only)" }).click();
    await expect(sel.getByLabel("Preflight result")).toContainText("✓ equals the plan", { timeout: 30_000 });
    await expect(sel.getByLabel("Preflight result")).toContainText(/Price impact \d+\.\d\d %/);
    expect(await page.evaluate(() => (window as any).__signCalls)).toBe(0);
  });
  test("mobile 390px: the Pool Explorer has no horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/pools");
    await expect(page.locator("article.pool")).toHaveCount(6, { timeout: 30_000 });
    await expect(page.getByText(/selectable of 6/)).toBeVisible({ timeout: 30_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("@mock V4.0 Pool Explorer failure cases", () => {
  test("a stored OBSERVE_ONLY selection is cleared on load; mainnet RPC down -> mainnet pools unreadable, still observe only", async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => localStorage.setItem("sol2near:v4-pool", "near-testnet:ref-finance-101.testnet:2131"));
    await page.route(/free\.rpc\.fastnear\.com|near\.drpc\.org/, (route) => route.abort("failed")); // MOCK mainnet outage only
    await page.goto("/#/pools");
    await expect(page.getByRole("status")).toContainText("Previous selection cleared: OBSERVE_ONLY", { timeout: 30_000 });
    const chill = card(page, "near-mainnet:v2.ref-finance.near:5462");
    await expect(chill).toContainText("✗ readable");
    await expect(chill).toContainText("OBSERVE ONLY");
    await expect(card(page, PILOT_KEY)).toContainText("ELIGIBLE"); // testnet reads are unaffected
    expect(await page.evaluate(() => localStorage.getItem("sol2near:v4-pool"))).toBeNull();
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });
});
