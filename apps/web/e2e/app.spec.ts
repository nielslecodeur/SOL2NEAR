// Browser tests in the REAL local Google Chrome (Playwright, channel "chrome").
// Tags:
//   @live  real NEAR testnet reads (read-only RPC), real Wallet Selector. Nothing is signed.
//   @mock  a MOCKED wallet injected through the e2e-only hook (never a real wallet) and/or intercepted RPC.
// No test clicks anything that could reach a real wallet signature: the only "Confirm & open wallet" clicks
// happen with the mocked wallet, which rejects and never touches the network.
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
    await page.goto("/#/dashboard");
    const total = (Number(BigInt(acc.total_received)) / 1e6).toString();
    await expect(page.locator(".stat", { hasText: "USDC received by Treasury (all creators)" }).locator("b")).toHaveText(total);
    await expect(page.getByText("BACKED ON REF")).toBeVisible();
    await expect(page.getByText("SIMULATED / DEMO DATA: nothing on this screen comes from a chain.")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("no session: Connect button; the real modal lists MyNearWallet and Meteor; closing it signs nothing", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/#/dashboard");
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
    await page.goto("/#/dashboard");
    await page.getByLabel("Creator account").fill(DEV);
    // exact match, inside the watch form: "Loading wallets…" (NEAR panel) also contains "Load"
    await page.locator("form.watch").getByRole("button", { name: "Load", exact: true }).click();
    const row = page.locator(".row", { hasText: "20 USDC" });
    await expect(row).toContainText("LP CONFIRMED");
    await expect(row).toContainText("Claimed");
  });

  test("demo mode is labelled SIMULATED and hides the NEAR panel; live mode shows no simulated data", async ({ page }) => {
    await page.goto("/#/dashboard");
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
    await page.goto("/#/dashboard");
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
    await page.goto("http://127.0.0.1:4184/#/dashboard");
    const connect = nearPanel(page).getByRole("button", { name: "Connect NEAR wallet" });
    await expect(connect).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("BACKED ON REF")).toBeVisible();
    await connect.click();
    await expect(page.getByText("MyNearWallet", { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test("mobile 390px: no horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/dashboard");
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
    await page.goto("/#/dashboard");
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
    await page.goto("/#/dashboard");
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
    await page.goto("/#/dashboard");
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
    await page.goto("/#/dashboard");
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
    await page.goto("/#/dashboard");
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
    await page.goto("/#/dashboard");
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

// ---- V4.1B: TreasuryV4 journey + Position Manager. Signing is LOCKED; TreasuryV4 is NOT deployed on testnet. ----
const pilot = (page: Page) => page.getByLabel("V4.1 Classic pilot");
const SANDBOX_VIEWS = JSON.parse(readFileSync(new URL("../../../packages/near-client/src/fixtures/v4_sandbox_views.json", import.meta.url), "utf8"));
async function preview(page: Page, stage: string, path = "/#/positions") {
  await page.addInitScript((st) => { localStorage.setItem("sol2near:v4-source", "sandbox-snapshot"); localStorage.setItem("sol2near:v4-stage", st); }, stage);
  await page.goto(path);
}
const position = (page: Page, id = "0") => page.getByLabel(`Position ${id}`);
async function allLockedButtonsDisabled(page: Page) {
  const locked = page.getByRole("button", { name: /— locked$/ });
  expect(await locked.count()).toBeGreaterThan(0);
  for (const b of await locked.all()) await expect(b).toBeDisabled();
}

test.describe("@live V4.1B on public testnet (read only)", () => {
  test("pilot: NOT DEPLOYED from live reads, FUEL_NOT_ELIGIBLE from the deployed FUEL, no quote, tracker NOT_DEPLOYED, nothing signable", async ({ page }) => {
    await mockWallet(page, DEV);
    const errors = watchErrors(page);
    const fuelCfg = (await view<{ config: { treasury_id: string } }>("fuel.sol2near-dev.testnet", "get_reactor")).config;
    await page.goto("/#/pools");
    await expect(pilot(page).getByTestId("deployment")).toHaveText("NOT DEPLOYED", { timeout: 30_000 });
    await expect(pilot(page)).toContainText("FUEL_NOT_ELIGIBLE");
    await expect(pilot(page)).toContainText(fuelCfg.treasury_id);
    await expect(pilot(page).getByLabel("Estimate problems")).toContainText("not deployed");
    await expect(pilot(page)).toContainText("none exists on testnet yet");
    await expect(pilot(page).locator('[data-state="NOT_DEPLOYED"]')).toBeVisible();
    await page.goto("/#/positions");
    await expect(page.getByTestId("no-positions")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => (window as any).__signCalls)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("mobile 390px: the Position Manager has no horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preview(page, "lp_confirmed_locked");
    await expect(position(page)).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("@preview V4.1B Position Manager on REAL contract views from the LOCAL sandbox (not testnet)", () => {
  test("LOCKED: verified shares, lock end, withdraw refused (lock, sandbox network), FUEL not eligible, every action locked", async ({ page }) => {
    await preview(page, "lp_confirmed_locked");
    await expect(page.getByRole("note").filter({ hasText: "LOCAL SANDBOX SNAPSHOT" })).toBeVisible(); // V4.3A: the DCL preview adds its own note
    const p = position(page);
    await expect(p).toHaveAttribute("data-state", "LOCKED", { timeout: 30_000 });
    await expect(p).toContainText("verified on Ref");
    await expect(p).toContainText("✓ USDC reconciles");
    await expect(p).toContainText("LOCAL SANDBOX · NOT AN INVESTMENT");
    await expect(p).toContainText("FUEL_NOT_ELIGIBLE");
    await expect(p).toContainText("not a profit figure");
    const blocked = p.getByLabel("Withdraw blocked");
    await expect(blocked).toContainText("Locked until");
    await expect(blocked).toContainText("Wrong network (sandbox)");
    await allLockedButtonsDisabled(page);
    await page.screenshot({ path: "test-results/v41b-locked.png", fullPage: true });
  });

  test("WITHDRAWABLE after the lock: only network / account reasons remain, no prerequisite once mft-registered, still locked", async ({ page }) => {
    await preview(page, "lp_unlocked_registered");
    const p = position(page);
    await expect(p).toHaveAttribute("data-state", "WITHDRAWABLE", { timeout: 30_000 });
    await expect(p.getByLabel("Withdraw blocked")).not.toContainText("Locked until");
    await expect(p.getByLabel("Withdraw", { exact: true })).not.toContainText("mft_register");
    await expect(p.getByRole("button", { name: "Withdraw LP — locked" })).toBeDisabled();
  });

  test("not mft-registered: the prerequisite is shown; WITHDRAWN: a second withdrawal is refused", async ({ page }) => {
    await preview(page, "lp_unlocked_not_registered");
    await expect(position(page).getByLabel("Withdraw", { exact: true })).toContainText("mft_register", { timeout: 30_000 });
    await page.getByLabel("Sandbox stage").selectOption("lp_withdrawn");
    await expect(position(page)).toHaveAttribute("data-state", "WITHDRAWN");
    await expect(position(page).getByLabel("Withdraw blocked")).toContainText("already withdrawn");
  });

  test("RECOVERY_REQUIRED after the price-impact guard: resume or abort only, each explained; ABORTED: the 810 USDC leftover is recoverable", async ({ page }) => {
    await preview(page, "parked_price_impact");
    const p = position(page, "1");
    await expect(p).toHaveAttribute("data-state", "RECOVERY_REQUIRED", { timeout: 30_000 });
    await expect(p).toContainText("guard_price_impact");
    for (const id of ["resume_lp", "abort_lp"]) {
      const r = p.getByLabel(`Recovery ${id}`);
      for (const k of ["Objective", "Funds", "Preconditions", "Recipient", "Risks"]) await expect(r).toContainText(k);
      await expect(r.getByRole("button")).toBeDisabled();
    }
    await expect(p.getByLabel(/^Recovery withdraw_leftover/)).toHaveCount(0); // nothing parked as leftover yet
    await expect(p.getByLabel("Recovery withdraw_reserve")).toContainText("73600000 USDC-atomic"); // 8 % reserves of both deposits (1.6 + 72)
    await page.getByLabel("Sandbox stage").selectOption("aborted_with_leftovers");
    await expect(p).toHaveAttribute("data-state", "ABORTED");
    await expect(p.getByLabel("Recovery withdraw_leftover_usdc")).toContainText("810000000 USDC-atomic");
    await expect(p.getByLabel("Recovery resume_lp")).toHaveCount(0);
  });

  test("estimator + review on the sandbox pool: 20 USDC planned like the contract did; 900 USDC refused by the impact guard; sign locked", async ({ page }) => {
    await preview(page, "budget_allocated", "/#/pools");
    const est = pilot(page).getByLabel("Estimate", { exact: true });
    await expect(est).toContainText("LP budget 18", { timeout: 30_000 });
    await expect(est).toContainText("Swap 8.97332 USDC");
    const review = pilot(page).getByLabel("Review");
    await expect(review).toContainText("usdc.test.near.ft_transfer_call");
    await expect(review).toContainText("treasury-v4.test.near.execute_lp");
    await expect(review.getByRole("button", { name: "Sign deposit — locked" })).toBeDisabled();
    await expect(review).toContainText("Signing is disabled in V4.1B");
    await pilot(page).getByLabel("USDC amount").fill("900");
    await expect(pilot(page).getByLabel("Estimate problems")).toContainText("price impact");
    await page.screenshot({ path: "test-results/v41b-estimator.png", fullPage: true });
  });
});

/**
 * OFFLINE replay for the V4.1B "deployed pilot" tests. The pilot accounts are answered by hand (below). Every OTHER testnet
 * RPC call the page makes (V3 Treasury snapshot, deployed FUEL config, wallet balances…) is answered from a dated snapshot
 * of the real responses, recorded once with `E2E_RECORD=1`: no public endpoint is contacted, so these tests are
 * deterministic. An unrecorded call gets an explicit RPC error (the page must then show "read failed", never guess).
 * Mainnet, Tidepool and Solana are blocked in these tests.
 */
const RPC_SNAPSHOT = new URL("./fixtures/testnet-rpc-snapshot.json", import.meta.url);
const RECORD = !!process.env.E2E_RECORD;
const recorded: Record<string, unknown> = !RECORD && existsSync(RPC_SNAPSHOT) ? JSON.parse(readFileSync(RPC_SNAPSHOT, "utf8")).responses : {};
const rpcKey = (body: { method?: string; params?: unknown }) => `${body.method} ${JSON.stringify(body.params)}`;
async function mockDeployedPilot(page: Page, o: { config: object; position?: object; inFlight?: object | null; nowNs: string }) {
  const bytes = (v: unknown) => Array.from(Buffer.from(JSON.stringify(v)));
  await page.route(/free\.rpc\.fastnear\.com|near\.drpc\.org|usetidepool\.tech|solana\.com/, (route) => route.abort("blockedbyclient")); // offline
  await page.route(/near-testnet\.drpc\.org|test\.rpc\.fastnear\.com/, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const p = body.params ?? {};
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
    if (body.method === "block") return reply({ header: { timestamp_nanosec: o.nowNs, height: 1 } });
    if (body.method === "query" && p.request_type === "view_account" && /^(treasury-v4|s2nmeme)\.sol2near-dev\.testnet$/.test(p.account_id))
      return reply({ amount: "1", locked: "0", code_hash: "E2EMockCodeHash1111111111111111111111111111", storage_usage: 1, block_height: 1, block_hash: "x" });
    if (body.method === "query" && p.request_type === "call_function") {
      const args = JSON.parse(Buffer.from(p.args_base64 ?? "", "base64").toString() || "{}");
      const k = `${p.account_id}.${p.method_name}`;
      const answer: Record<string, unknown> = {
        "treasury-v4.sol2near-dev.testnet.get_config": o.config,
        "treasury-v4.sol2near-dev.testnet.get_in_flight": o.inFlight ?? null,
        "treasury-v4.sol2near-dev.testnet.get_creator_deposits": o.position ? [{ id: "0" }] : [],
        "treasury-v4.sol2near-dev.testnet.get_position": o.position ?? null,
        "treasury-v4.sol2near-dev.testnet.get_reserve": "0",
        "treasury-v4.sol2near-dev.testnet.get_base_balance": "0",
        "s2nmeme.sol2near-dev.testnet.storage_balance_of": { total: "1250000000000000000000", available: "0" },
      };
      if (k in answer) return reply({ result: bytes(answer[k]), logs: [], block_height: 1, block_hash: "x" });
      if (p.account_id === "ref-finance-101.testnet" && args.pool_id === 9999) {
        const pool = { pool_kind: "SIMPLE_POOL", token_account_ids: ["usdc.tidepool-sandbox.testnet", "s2nmeme.sol2near-dev.testnet"], amounts: ["1000000000", "1000000000000000000000000"], total_fee: 30, shares_total_supply: "1000000000000000000000000", amp: 0 };
        const ref: Record<string, unknown> = { get_pool: pool, get_return: "8867071669659872053870", get_pool_shares: "0", mft_has_registered: false, predict_remove_liquidity: ["0", "0"] };
        if (p.method_name in ref) return reply({ result: bytes(ref[p.method_name]), logs: [], block_height: 1, block_hash: "x" });
      }
    }
    const key = rpcKey(body);
    if (RECORD) {
      for (let i = 0; ; i++) {
        const resp = await route.fetch().catch(() => null);
        const j = resp ? await resp.json().catch(() => null) : null;
        if (j?.result || i >= 3) {
          if (j?.result) recorded[key] = j.result;
          return j ? route.fulfill({ json: { ...j, id: body.id } }) : route.abort("failed");
        }
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    if (key in recorded) return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: recorded[key] } });
    return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: `E2E OFFLINE: unrecorded RPC call ${key.slice(0, 160)}` } } });
  });
}
const plannedConfig = (poolId: number) => ({
  config: { network: "testnet", pool: { dex: "ref-finance-101.testnet", pool_id: poolId, usdc_token: "usdc.tidepool-sandbox.testnet", base_token: "s2nmeme.sol2near-dev.testnet", usdc_decimals: 6, base_decimals: 18 },
    min_deposit: "1000000", lp_lock_duration_ns: "600000000000", guards: { max_slippage_bps: 100, max_price_impact_bps: 1000, max_plan_ttl_ns: "600000000000" } },
  lp_bps: 9000, reserve_bps: 800, community_bps: 200, ready: true, usdc_pool_index: 0, fuel: "FUEL_NOT_ELIGIBLE",
});

test.describe("@offline V4.1B with a replayed RPC (no contract exists on testnet)", () => {
  test.afterAll(() => {
    if (RECORD) writeFileSync(RPC_SNAPSHOT, JSON.stringify({ recorded_at: new Date().toISOString(), note: "REAL public NEAR testnet RPC responses recorded with E2E_RECORD=1 for the @offline tests (view calls only). Replayed, never edited by hand.", responses: recorded }, null, 1) + "\n");
  });
  test("deployed with the WRONG configuration (the sandbox config): DEPLOYED · NOT READY, nothing unlocked", async ({ page }) => {
    await mockDeployedPilot(page, { config: SANDBOX_VIEWS.config, nowNs: SANDBOX_VIEWS.budget_allocated.now_ns });
    await page.goto("/#/pools");
    await expect(pilot(page).getByTestId("deployment")).toContainText("DEPLOYED · NOT READY", { timeout: 30_000 });
    await expect(pilot(page).locator('[data-state="NOT_DEPLOYED"]')).toBeVisible();
  });

  test("deployed and READY, a job in flight: SWAP_PENDING survives a reload (state from the chain), no resend, reconcile not yet; signing still locked", async ({ page }) => {
    await mockWallet(page, "alice.testnet");
    const nowNs = (BigInt(Date.now()) * 1_000_000n).toString();
    const real = SANDBOX_VIEWS.budget_allocated.position;
    const pos = { ...real, deposit: { ...real.deposit, creator: "alice.testnet", dex: "ref-finance-101.testnet", base_token: "s2nmeme.sol2near-dev.testnet", status: { SwapPending: { usdc: "18000000" } } } };
    await mockDeployedPilot(page, { config: plannedConfig(9999), position: pos, inFlight: { deposit_id: "0", since: nowNs, job: "Lp" }, nowNs });
    await page.goto("/#/positions");
    for (const pass of ["first load", "after reload"]) {
      const p = position(page);
      await expect(p, pass).toHaveAttribute("data-state", "SWAP_PENDING", { timeout: 30_000 });
      await expect(p.getByTestId("state-detail")).toContainText("do not resend");
      await expect(p.getByLabel("Recovery reconcile")).toContainText("Too early");
      await expect(p.getByLabel("Recovery resume_lp")).toHaveCount(0);
      await expect(p.getByLabel("Withdraw blocked")).toContainText("No confirmed LP");
      await allLockedButtonsDisabled(page);
      if (pass === "first load") await page.reload();
    }
    expect(await page.evaluate(() => (window as any).__signCalls)).toBe(0);
  });

  test("deployed and READY: the estimator plans against the live (intercepted) pool and Ref get_return; the review is prepared, signing stays locked", async ({ page }) => {
    await mockWallet(page, "alice.testnet");
    await mockDeployedPilot(page, { config: plannedConfig(9999), nowNs: (BigInt(Date.now()) * 1_000_000n).toString() });
    await page.goto("/#/pools");
    await expect(pilot(page).getByTestId("deployment")).toContainText("DEPLOYED · awaiting validation", { timeout: 30_000 });
    await expect(pilot(page).getByLabel("Estimate", { exact: true })).toContainText("Ref get_return ✓ equals the plan");
    await expect(pilot(page).locator('[data-state="READY"]')).toBeVisible();
    await expect(pilot(page).getByRole("button", { name: "Sign deposit — locked" })).toBeDisabled();
    await expect(pilot(page).getByLabel("Review")).toContainText("Signing is disabled in V4.1B");
  });

  test("testnet RPC down: the pilot and the Position Manager say the read failed and unlock nothing", async ({ page }) => {
    await page.route(/near-testnet\.drpc\.org|test\.rpc\.fastnear\.com/, (route) => route.abort("failed")); // MOCK outage
    await page.goto("/#/pools");
    await expect(pilot(page)).toContainText("Live read failed", { timeout: 30_000 });
    await page.goto("/#/positions");
    await expect(page.getByText(/Live read failed/)).toBeVisible({ timeout: 30_000 });
  });
});

// ---- V4.2A: Rhea DCL / Nearly pools (mainnet READ ONLY) + TreasuryDCL position PREVIEW (local sandbox views) ----
const dcl = (page: Page, key: string) => page.locator(`article[data-dcl="${key}"]`);
test.describe("@live V4.2A DCL section (real mainnet views, nothing executable)", () => {
  test("3 real Nearly pools classified live: NEARLY / NEARKAT feasible for a local test, DRAGON blocked by its tax; V4.0 untouched", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/#/pools");
    await expect(page.locator("article.pool")).toHaveCount(6, { timeout: 30_000 }); // V4.0 catalogue unchanged
    await expect(page.locator("article.dclpool")).toHaveCount(0); // nothing read from mainnet until asked
    await page.getByRole("button", { name: "Read the 3 Nearly pools (mainnet, read-only)" }).click();
    await expect(page.locator("article.dclpool")).toHaveCount(3, { timeout: 60_000 });
    await expect(dcl(page, "dcl:nearly")).toContainText("FEASIBLE FOR LOCAL DCL TEST", { timeout: 45_000 });
    await expect(dcl(page, "dcl:nearkat")).toContainText("FEASIBLE FOR LOCAL DCL TEST");
    await expect(dcl(page, "dcl:dragon")).toContainText("BLOCKED TAX");
    await expect(dcl(page, "dcl:dragon")).toContainText(/tax v2: buy 100 \/ sell 100 bps/);
    for (const k of ["dcl:nearly", "dcl:nearkat", "dcl:dragon"]) {
      await expect(dcl(page, k)).toContainText("Not executable.");
      await expect(dcl(page, k)).toContainText("lock");
    }
    await expect(dcl(page, "dcl:nearly")).toContainText("other positions exist beside the launch position");
    const est = page.getByLabel("DCL estimator");
    await est.getByRole("button", { name: "Simulate (read-only)" }).click();
    await expect(est.getByLabel("DCL estimate")).toContainText("Split 90/8/2: LP budget 90 USDC", { timeout: 60_000 });
    await expect(est.getByLabel("DCL estimate")).toContainText("Not executable");
    await expect(est.getByLabel("DCL estimate")).toContainText("FUEL_NOT_ELIGIBLE");
    await page.getByLabel("V4.2A DCL Nearly pools").screenshot({ path: "../../docs/v4/v42a-dcl-pools.jpg", type: "jpeg", quality: 70 });
    expect(await page.evaluate(() => (window as any).__signCalls ?? 0)).toBe(0);
    expect(errors).toEqual([]);
  });
});
test.describe("@preview V4.2A TreasuryDCL position on REAL views from the LOCAL sandbox (real DCL wasm)", () => {
  test("confirmed → fees → out of range → withdrawn; FUEL not eligible; no action button", async ({ page }) => {
    await page.route(/free\.rpc\.fastnear\.com|near\.drpc\.org/, (route) => route.abort("failed")); // the preview needs no network
    await page.goto("/#/pools");
    const p = page.getByLabel("DCL position preview");
    await expect(p).toContainText("PREVIEW — TreasuryDCL views from a LOCAL SANDBOX");
    await expect(p).toContainText("POSITION_LOCKED");
    await expect(p).toContainText("price inside the range");
    await expect(p).toContainText("rawmeme.test.near|wrap.test.near|10000#4");
    await expect(p).toContainText("✓ reconciles with the budget");
    await p.getByLabel("Stage").selectOption("fees_claimed");
    await expect(p).toContainText(/claimed 4,489\.5\d+ RAWMEME/);
    await p.getByLabel("Stage").selectOption("out_of_range");
    await expect(p).toContainText("price above the range: the position is entirely wNEAR");
    await p.getByLabel("Stage").selectOption("position_withdrawn");
    await expect(p).toContainText("WITHDRAWN");
    await expect(p).toContainText("FUEL_NOT_ELIGIBLE");
    await expect(p.getByRole("button")).toHaveCount(0);
    await p.getByLabel("Stage").selectOption("out_of_range");
    await p.screenshot({ path: "../../docs/v4/v42a-dcl-position.jpg", type: "jpeg", quality: 70 });
  });
  test("mainnet RPC down: the DCL cards are OBSERVE ONLY (unreadable), nothing executable, V4.0 still renders", async ({ page }) => {
    const errors = watchErrors(page);
    await page.route(/free\.rpc\.fastnear\.com|near\.drpc\.org/, (route) => route.abort("failed")); // MOCK mainnet outage
    await page.goto("/#/pools");
    await page.getByRole("button", { name: "Read the 3 Nearly pools (mainnet, read-only)" }).click();
    await expect(page.locator("article.dclpool")).toHaveCount(3, { timeout: 30_000 });
    for (const k of ["dcl:nearly", "dcl:nearkat", "dcl:dragon"]) {
      await expect(dcl(page, k)).toContainText("OBSERVE ONLY");
      await expect(dcl(page, k)).toContainText("nothing is concluded from a failed read");
    }
    await expect(page.getByLabel("DCL estimator")).toHaveCount(0);
    await expect(page.locator("article.pool")).toHaveCount(6);
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });
  test("mobile 390px: the DCL section has no horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/pools");
    await page.getByRole("button", { name: "Read the 3 Nearly pools (mainnet, read-only)" }).click();
    await expect(page.locator("article.dclpool")).toHaveCount(3, { timeout: 60_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// ---- V4.3A Creator Portal, since H6 the developer "Testnet console" (#/console); the NEARLY journey is #/explore ----
const portal = (page: Page) => page.locator("main.portal");
const step = (page: Page, n: number) => portal(page).getByRole("list", { name: "Journey" }).getByRole("button").nth(n);
/** MOCK Tidepool /v0/quote (dry): same response shape as the live API (packages/crosschain fixtures). */
async function mockTidepoolQuote(page: Page, out: (amountIn: string) => { amountOut: string; minAmountOut: string }) {
  await page.route(/usetidepool\.tech\/v0\/quote/, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const o = out(body.amount);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ correlationId: "e2e-mock", signature: "e2e-mock", quote: { amountIn: body.amount, ...o, timeEstimate: 30 } }) });
  });
}
async function freshPortal(page: Page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-init")) {
      localStorage.removeItem("sol2near:portal-step");
      sessionStorage.setItem("e2e-init", "1");
    }
  });
}

test.describe("@live V4.3A Creator Portal", () => {
  test("H6 a new visitor lands on the home page: value proposition, read-only status, How it works with networks and honest status per evidence kind, no JS error, nothing signed", async ({ page }) => {
    const errors = watchErrors(page);
    await freshPortal(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Fuel memecoin liquidity across chains." })).toBeVisible();
    await expect(page.getByText("Read-only demonstration · No real funds required")).toBeVisible();
    await expect(page.getByLabel("Sample position from a historical quote")).toContainText(/Historical quote · mainnet block \d+/);
    await page.getByLabel("Main").getByRole("link", { name: "How it works" }).click();
    await expect(page.getByLabel("Networks")).toContainText("Tidepool");
    await expect(page.getByLabel("Networks")).toContainText("community sandbox, not NEAR Intents");
    const st = page.getByLabel("Feature status");
    await expect(st.locator('[data-feature="deposit"] [data-evidence]')).toHaveText("Executed on NEAR testnet");
    await expect(st.locator('[data-feature="bridge"] [data-evidence]')).toHaveText("Bridged once: Solana devnet → NEAR testnet");
    await expect(st.locator('[data-feature="v42_dcl"] [data-evidence]')).toHaveText("Local sandbox only (real code, local state)");
    await expect(st.locator('[data-feature="nearly_pools"] [data-evidence]')).toHaveText("Live read (no transaction)");
    for (const f of ["memecoin_execution", "g8", "creator_fees", "phantom_only", "exit_v3"]) await expect(st.locator(`[data-feature="${f}"] [data-evidence]`)).toHaveText("Not available");
    await expect(page.getByText(/No yield\s+is promised/)).toBeVisible();
    await page.goto("/#/console");
    await expect(page.getByTestId("mode-note")).toContainText("not a memecoin");
    await expect(nearPanel(page)).toBeVisible(); // console step 1 shows the real NEAR panel
    await page.screenshot({ path: "../../docs/v4/v43a-portal-home.jpg", type: "jpeg", quality: 70, fullPage: true });
    expect(await page.evaluate(() => (window as any).__signCalls ?? 0)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("live mode, step 2: only pool 2951 is available (labelled not a memecoin); every other pool is not available, with its reason", async ({ page }) => {
    await freshPortal(page);
    await page.goto("/#/console");
    await step(page, 1).click();
    const s2 = page.getByLabel("Step 2 Choose pool");
    await expect(s2.locator("li.ok")).toHaveCount(1, { timeout: 30_000 });
    await expect(s2.locator("li.ok")).toContainText("ref-finance-101.testnet #2951");
    await expect(s2.locator("li.ok")).toContainText("not a memecoin");
    await expect(s2.locator("li.ko")).toHaveCount(5);
    await expect(s2.locator('li[data-offer="near-testnet:ref-finance-101.testnet:2131"]')).toContainText("NOT AVAILABLE");
  });

  test("H6 Explore = the NEARLY journey in 3 steps: a LIVE indicative quote pinned to one mainnet block, the sandbox proof; nothing enabled can execute", async ({ page }) => {
    await page.goto("/#/explore");
    await expect(page.getByTestId("nearly-evidence-note")).toContainText("no mainnet contribution has ever been made");
    await expect(page.getByRole("navigation", { name: "Journey" }).getByRole("link")).toHaveCount(3);
    await expect(nearPanel(page)).toHaveCount(0); // no NEAR wallet on the product pages
    await page.getByText("Advanced details").click();
    await expect(page.getByLabel("NEARLY pool details")).toContainText("nearly-993927.nearlytrade.near|wrap.near|10000");
    await page.getByRole("link", { name: /Next: Preview/ }).click();
    await page.getByRole("button", { name: "Get a live indicative quote" }).click();
    await expect(page.getByTestId("quote-source")).toHaveText("Live indicative quote", { timeout: 120_000 });
    await expect(page.getByTestId("quote-label")).toContainText(/Mainnet block \d+ · .* UTC/);
    await expect(page.getByTestId("quote-label")).toContainText("Not an executable offer");
    await page.getByText("Advanced details").click();
    await expect(page.getByLabel("NEARLY contribution quote")).toContainText("NEARLY +");
    await expect(page.getByLabel("NEARLY contribution quote")).toContainText("Price impact");
    await expect(page.getByRole("button", { name: "Execute on mainnet — not available" })).toBeDisabled();
    await page.getByRole("link", { name: /Next: Proof/ }).click();
    await expect(page.getByLabel("Sandbox proof summary card")).toContainText("Local sandbox execution verified");
    const actionable = await page.locator("button:enabled:visible").allInnerTexts();
    expect(actionable.filter((t) => /^\s*(fund|execute|sign|deposit|bridge|deploy|claim|withdraw)/i.test(t))).toEqual([]);
  });

  test("step 5: the real G6/G7 creator's positions in the common shape — #1/#2 confirmed with verified shares, #3 (bridged) not LP; no exit offered", async ({ page }) => {
    await freshPortal(page);
    await page.goto("/#/console");
    await step(page, 4).click();
    const s5 = page.getByLabel("Step 5 Track");
    await s5.getByLabel("NEAR account").fill("lowarena9362.testnet");
    await s5.getByRole("button", { name: "Load" }).click();
    await expect(s5.locator("article.unified")).toHaveCount(3, { timeout: 30_000 });
    const c2 = s5.getByLabel("Position v3:2");
    await expect(c2).toContainText("CONFIRMED ON NEAR TESTNET");
    await expect(c2).toContainText("verified on the DEX");
    await expect(c2).toContainText("FUEL Claimed");
    await expect(c2).toContainText("Not offered: V3 withdraw_lp exists in the contract but was never exercised on-chain");
    await expect(s5.getByLabel("Position v3:3")).toContainText("NOT CONFIRMED AS LP");
    await expect(s5.getByLabel("Position v3:3")).toContainText("LP budget 79.19532 USDC waiting");
  });

  test("Positions page: V3 live cards, V4.1 pilot (not deployed) and the DCL sandbox preview are separate and labelled", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sol2near:account", "lowarena9362.testnet"));
    await page.goto("/#/positions");
    await expect(page.getByLabel("Unified positions").locator("article.unified")).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByTestId("no-positions")).toContainText("TreasuryV4 is not deployed on testnet", { timeout: 30_000 });
    await expect(page.getByLabel("DCL position preview")).toContainText("LOCAL SANDBOX");
    await page.screenshot({ path: "../../docs/v4/v43a-positions.jpg", type: "jpeg", quality: 60, fullPage: true });
  });

  test("mobile 390px: every portal step has no horizontal page scroll", async ({ page }) => {
    await freshPortal(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/console");
    for (let i = 0; i < 5; i++) {
      await step(page, i).click();
      await page.waitForTimeout(400);
      const wide = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(-3).map((e) => `${e.tagName}.${e.className}:${Math.round(e.getBoundingClientRect().right)}`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `step ${i + 1} ${wide.join(" ")}`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("@mock V4.3A Creator Portal with an intercepted Tidepool quote (pool 2951 read live)", () => {
  test("simulator: 14 rows from the quote, the live pool and the rules; split on the guaranteed minimum; a quote older than 60 s blocks", async ({ page }) => {
    await page.clock.install();
    await freshPortal(page);
    await mockTidepoolQuote(page, () => ({ amountOut: "1994800", minAmountOut: "1994800" })); // the G7 numbers
    await page.goto("/#/console");
    await step(page, 2).click();
    const s3 = page.getByLabel("Step 3 Simulate");
    await s3.getByLabel("USDC to send from Solana").fill("2");
    await s3.getByRole("button", { name: "Simulate (read-only)" }).click();
    const t = s3.getByLabel("Contribution simulation");
    await expect(t.locator("tr")).toHaveCount(14, { timeout: 30_000 });
    await expect(t).toContainText("2 → 1.9948 USDC, cost 0.0052 USDC");
    await expect(t).toContainText("LP 1.79532 · creator reserve 0.159584 · community 0.039896 USDC");
    await expect(t).toContainText(/Ref get_return = plan/);
    await expect(s3.getByTestId("sim-ok")).toBeVisible();
    await page.clock.fastForward(65_000);
    await expect(t).toContainText("STALE, refresh before signing");
    await expect(s3.getByLabel("Blocking")).toContainText("quote older than 60 s");
    await page.screenshot({ path: "../../docs/v4/v43a-simulator.jpg", type: "jpeg", quality: 70, fullPage: true });
  });
  test("simulator: 1 USDC (0.9974 arrives) is blocked below the Treasury minimum; Tidepool down → nothing downstream is computed", async ({ page }) => {
    await freshPortal(page);
    await mockTidepoolQuote(page, () => ({ amountOut: "997400", minAmountOut: "997400" }));
    await page.goto("/#/console");
    await step(page, 2).click();
    const s3 = page.getByLabel("Step 3 Simulate");
    await s3.getByLabel("USDC to send from Solana").fill("1");
    await s3.getByRole("button", { name: "Simulate (read-only)" }).click();
    await expect(s3.getByLabel("Blocking")).toContainText("below the Treasury minimum deposit 1", { timeout: 30_000 });
    await page.unroute(/usetidepool\.tech\/v0\/quote/);
    await page.route(/usetidepool\.tech/, (r) => r.abort("failed")); // MOCK Tidepool outage
    await s3.getByRole("button", { name: "Simulate (read-only)" }).click();
    await expect(s3.getByLabel("Blocking")).toContainText("no bridge quote", { timeout: 30_000 });
    await expect(s3.getByLabel("Contribution simulation")).not.toContainText("LP 0.");
    await expect(s3.getByLabel("Contribution simulation")).toContainText("unknown without a quote");
  });
  test("Phantom (MOCK injected provider): absent → explained; trusted session restored after reload; empty devnet USDC balance read from Solana devnet", async ({ page }) => {
    await freshPortal(page);
    await page.goto("/#/console");
    await expect(page.getByLabel("Solana wallet")).toContainText("Phantom not detected");
    await expect(page.getByRole("button", { name: "Connect Phantom" })).toBeDisabled();
    // MOCK provider: approves only an explicit connect, then reconnects silently (onlyIfTrusted) like Phantom
    await page.addInitScript(() => {
      const pk = { toBase58: () => "11111111111111111111111111111111" };
      (window as any).phantom = { solana: {
        publicKey: null,
        connect: async (o?: { onlyIfTrusted?: boolean }) => {
          if (o?.onlyIfTrusted && !localStorage.getItem("e2e-trusted")) throw new Error("User rejected");
          localStorage.setItem("e2e-trusted", "1");
          return { publicKey: pk };
        },
        signAndSendTransaction: async () => { (window as any).__solSign = ((window as any).__solSign ?? 0) + 1; throw new Error("e2e: never sign"); },
      } };
    });
    await page.reload();
    await page.getByRole("button", { name: "Connect Phantom" }).click();
    await expect(page.getByLabel("Solana wallet")).toContainText("Connected 11111111111111111111111111111111");
    await expect(page.getByTestId("sol-usdc")).toHaveText("0", { timeout: 30_000 }); // real Solana devnet read: no token account
    await expect(page.getByLabel("Solana wallet")).toContainText("No devnet USDC on this address");
    await page.reload();
    await expect(page.getByLabel("Solana wallet")).toContainText("Connected 11111111111111111111111111111111"); // session restored, no click
    expect(await page.evaluate(() => (window as any).__solSign ?? 0)).toBe(0);
  });
  test("reload keeps the console step (per-viewer convenience) and the Explore step (in the URL)", async ({ page }) => {
    await freshPortal(page);
    await page.goto("/#/console");
    await step(page, 3).click();
    await page.reload();
    await expect(step(page, 3)).toHaveAttribute("aria-current", "step");
    await page.goto("/#/explore/proof");
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Journey" }).getByRole("link", { name: /Proof/ })).toHaveAttribute("aria-current", "step");
  });
});

// ---- G9.1: PUBLIC READ-ONLY DEMO build (dist-public, served on :4182). Every external request is blocked: deterministic.
const PUBLIC = "http://127.0.0.1:4182/";
async function publicOffline(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort("blockedbyclient")); // offline: no public endpoint
  // a Phantom-like provider is present in the browser: the public build must never touch it
  await page.addInitScript(() => {
    (window as any).__phantomCalls = 0;
    const spy = async () => { (window as any).__phantomCalls++; throw new Error("e2e: must not be called"); };
    (window as any).phantom = { solana: { publicKey: null, connect: spy, signAndSendTransaction: spy, signTransaction: spy } };
    (window as any).solana = (window as any).phantom.solana;
  });
}
test.describe("@offline @public G9.1 read-only demo build", () => {
  test("every route loads directly and after a reload; the read-only banner is always shown; no wallet, no signing button", async ({ page }) => {
    await publicOffline(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    for (const hash of ["", "#/", "#/how", "#/explore", "#/explore/preview", "#/explore/proof", "#/console", "#/portal", "#/dashboard", "#/pools", "#/positions", "#/proofs", "#/reactor"]) {
      await page.goto(PUBLIC + hash);
      await expect(page.getByTestId("read-only-banner")).toContainText("cannot send any transaction");
      await page.reload();
      await expect(page.getByTestId("read-only-banner")).toBeVisible();
      await expect(page.getByRole("button", { name: /Connect NEAR wallet|Connect Phantom|Connect Solana wallet|Bridge \d|Deploy liquidity|Register for FUEL|Claim .* FUEL|Sign/ })).toHaveCount(0);
    }
    expect(await page.evaluate(() => (window as any).__phantomCalls)).toBe(0);
    expect(pageErrors).toEqual([]);
  });
  test("H6 home: the product in one screen, a working Explore CTA; the testnet console explains wallets as unavailable, its NEAR panel is the read-only notice, the bridge card cannot deposit", async ({ page }) => {
    await publicOffline(page);
    await page.goto(PUBLIC);
    await expect(page.getByRole("heading", { level: 1, name: "Fuel memecoin liquidity across chains." })).toBeVisible();
    await expect(page.getByText("Explore how Solana capital can become a verifiable liquidity position on NEAR.")).toBeVisible();
    await expect(page.getByText("Read-only demonstration · No real funds required")).toBeVisible();
    await expect(page.getByLabel("Main").getByRole("link")).toHaveText(["Explore", "How it works", "Proof"]);
    await page.screenshot({ path: "../../docs/h6/home-desktop.jpg", type: "jpeg", quality: 72, fullPage: true });
    await page.getByRole("link", { name: "Explore the demo" }).first().click();
    await expect(page).toHaveURL(/#\/explore\/choose$/);
    await expect(page.getByRole("navigation", { name: "Journey" }).getByRole("link", { name: /Choose/ })).toHaveAttribute("aria-current", "step");
    await page.goto(PUBLIC + "#/console"); // the developer testnet journey: wallet panel and bridge card are read-only stubs
    await expect(page.getByTestId("wallets-disabled")).toContainText("contains no wallet code");
    await expect(page.getByLabel("NEAR wallet (not available in the public demo)")).toContainText("not included");
    await page.getByRole("list", { name: "Journey" }).getByRole("button").nth(3).click();
    await expect(page.getByLabel("Bridge (read-only)")).toContainText("not available");
    expect(await page.locator("button:enabled:visible").allInnerTexts().then((t) => t.filter((x) => /^\s*(fund|execute|sign|deposit|bridge|deploy|claim|withdraw|connect)/i.test(x)))).toEqual([]);
    expect(await page.evaluate(() => (window as any).__phantomCalls)).toBe(0);
    await page.screenshot({ path: "../../docs/v4/g91-public-portal.jpg", type: "jpeg", quality: 70, fullPage: true });
  });
  test("Proofs page lists the executed transactions with explorer links and the documentation; CSP meta present", async ({ page }) => {
    await publicOffline(page);
    await page.goto(PUBLIC + "#/proofs");
    await expect(page.getByLabel("On-chain testnet proofs").locator("article")).toHaveCount(4); // simple view: 4 milestones
    await expect(page.getByLabel("On-chain testnet proofs").locator('a[href*="explorer.solana.com/tx/bGUicpgy"]')).toHaveCount(1);
    await expect(page.getByLabel("Executed transactions")).toHaveCount(0);
    await page.getByRole("button", { name: "Technical view" }).click();
    const txs = page.getByLabel("Executed transactions");
    await expect(txs.locator("tr")).toHaveCount(16);
    await expect(txs.locator('[data-proof="G7-SOL"] a')).toHaveAttribute("href", /explorer\.solana\.com\/tx\/bGUicpgy.*cluster=devnet/);
    await expect(txs.locator('[data-proof="C2"] a')).toHaveAttribute("href", "https://testnet.nearblocks.io/txns/4F2wXqzmyBVaPqKa6mE3KMFjFv2S3U3GxXJYJfNsSSHA");
    await expect(page.getByLabel("Proofs and documentation")).toContainText("G8 is not completed");
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("connect-src 'self' https://near-testnet.drpc.org");
    expect(csp).toContain("form-action 'none'");
    await page.screenshot({ path: "../../docs/v4/g91-public-proofs.jpg", type: "jpeg", quality: 70, fullPage: true });
  });
  test("mobile 390px: no horizontal scroll on the public routes", async ({ page }) => {
    await publicOffline(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const hash of ["#/", "#/how", "#/explore/choose", "#/explore/preview", "#/explore/proof", "#/proofs", "#/console", "#/pools", "#/positions"]) {
      await page.goto(PUBLIC + hash);
      await expect(page.getByTestId("read-only-banner")).toBeVisible();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), hash).toBeLessThanOrEqual(0);
    }
  });
  test("H1/H3/H6 NEARLY journey offline: historical snapshot + quote labelled with their block, the real error of a failed live quote, no invented quote, the sandbox proof in two levels with code provenance", async ({ page }) => {
    test.setTimeout(150_000); // the failed live quote goes through the client's retries on every provider first
    await publicOffline(page);
    await page.goto(PUBLIC + "#/explore");
    await expect(page.getByTestId("nearly-evidence-note")).toContainText("no mainnet contribution has ever been made");
    const nav = page.getByRole("navigation", { name: "Journey" }).getByRole("link");
    await expect(nav).toHaveText([/Choose/, /Preview/, /Proof/]);
    const choose = page.getByLabel("Step 1 Choose");
    await expect(choose).toContainText(/Snapshot · block \d+/);
    await choose.getByText("Advanced details").click();
    await expect(page.getByLabel("NEARLY pool details")).toContainText(/SNAPSHOT block \d+/);
    await nav.nth(1).click();
    const pv = page.getByLabel("Step 2 Preview");
    await expect(page.getByLabel("Contribution preview")).toContainText("90 USDC");
    await expect(page.getByLabel("90/8/2 split", { exact: true })).toContainText("90 USDC");
    await expect(page.getByTestId("quote-source")).toHaveText("Historical quote");
    await expect(page.getByTestId("quote-label")).toContainText(/Mainnet block \d+ · 2026-11-14 15:51 UTC/);
    await expect(page.getByTestId("quote-label")).toContainText("Not an executable offer");
    await expect(page.getByLabel("Contribution preview")).toContainText("NEARLY");
    await page.getByRole("button", { name: "Get a live indicative quote" }).click();
    await expect(page.getByTestId("quote-error")).toContainText("Live quote failed", { timeout: 60_000 }); // every endpoint is blocked: the real error is shown
    await expect(page.getByTestId("quote-source")).toHaveText("Historical quote"); // and the historical quote keeps its label
    await expect(pv.getByRole("button", { name: "Execute on mainnet — not available" })).toBeDisabled();
    await page.screenshot({ path: "../../docs/h6/explore-preview-desktop.jpg", type: "jpeg", quality: 72, fullPage: true });
    await nav.nth(0).click();
    await page.getByLabel("Contribution", { exact: true }).fill("250");
    await nav.nth(1).click();
    await expect(page.getByTestId("quote-none")).toBeVisible(); // no invented quote for another amount
    await expect(page.getByLabel("Contribution preview")).toContainText("needs a quote");
    await nav.nth(2).click();
    const card = page.getByLabel("Sandbox proof summary card");
    await expect(card).toContainText("Local sandbox execution verified");
    for (const f of ["Position created", "Ownership verified", "Fees accounted for", "Withdrawal tested"]) await expect(card.locator(`li.fact.ok[data-fact="${f}"]`)).toHaveCount(1);
    await expect(card.getByText("58", { exact: true })).toBeVisible();
    await expect(card.getByText("3 / 3", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Sandbox steps")).toHaveCount(0); // the 58 steps stay behind the technical view
    await card.getByRole("button", { name: "View technical evidence" }).click();
    const tech = page.getByLabel("Technical evidence");
    await expect(tech).toContainText("LOCAL SANDBOX");
    await expect(page.getByLabel("Code provenance").getByText("= mainnet code")).toHaveCount(3);
    await expect(page.getByLabel("Sandbox steps").locator("tr[data-step]")).toHaveCount(58);
    await expect(page.getByLabel("Sandbox proof summary", { exact: true })).toContainText("treasury-dcl.test.near");
    await page.locator('tr[data-step="F1"]').getByRole("button", { name: "proof" }).click();
    await expect(tech.locator("pre.json")).toContainText("dcl_nft_token_owner");
    await expect(page.getByLabel("Fees and exit")).toContainText("not a forecast");
    await page.screenshot({ path: "../../docs/v4/h1-nearly-sandbox-proof.jpg", type: "jpeg", quality: 70, fullPage: true });
    await nav.nth(0).click();
    await page.getByLabel("Contribution", { exact: true }).fill("100");
    await nav.nth(1).click();
    await expect(page.getByTestId("quote-source")).toHaveText("Historical quote");
    await page.screenshot({ path: "../../docs/v4/h1-nearly-quote.jpg", type: "jpeg", quality: 70, fullPage: true });
    expect(await page.evaluate(() => (window as any).__phantomCalls)).toBe(0);
  });
  test("H6 NEARLY journey at 390px: no horizontal scroll on any of the 3 steps, advanced details and technical evidence open", async ({ page }) => {
    await publicOffline(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PUBLIC + "#/explore/choose");
    await page.getByText("Advanced details").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "choose").toBeLessThanOrEqual(0);
    await page.screenshot({ path: "../../docs/h6/explore-choose-mobile.jpg", type: "jpeg", quality: 72, fullPage: true });
    await page.goto(PUBLIC + "#/explore/preview");
    await page.getByText("Advanced details").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "preview").toBeLessThanOrEqual(0);
    await page.goto(PUBLIC + "#/explore/proof");
    await page.getByRole("button", { name: "View technical evidence" }).click();
    await page.locator('tr[data-step="F1"]').getByRole("button", { name: "proof" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "proof").toBeLessThanOrEqual(0);
    await page.goto(PUBLIC + "#/");
    await page.screenshot({ path: "../../docs/h6/home-mobile.jpg", type: "jpeg", quality: 72, fullPage: true });
    await page.goto(PUBLIC + "#/proofs");
    await page.screenshot({ path: "../../docs/h6/proof-mobile.jpg", type: "jpeg", quality: 72, fullPage: true });
  });
  test("H6 keyboard: skip link, main navigation and the Developers menu work without a mouse", async ({ page }) => {
    await publicOffline(page);
    await page.goto(PUBLIC);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "SOL2NEAR home" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Main").getByRole("link", { name: "Explore" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/explore$/);
    await page.locator(".devmenu summary").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".devmenu-list").getByRole("link", { name: "Testnet console" })).toBeVisible();
    await page.locator(".devmenu-list").getByRole("link", { name: "Pools" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/pools$/);
    await expect(page.locator(".devmenu-list")).toBeHidden(); // the menu closes after navigation
  });
  test("H6 Proof page and Explore at 1440px and 768px: simple and technical views, no horizontal scroll", async ({ page }) => {
    await publicOffline(page);
    for (const w of [1440, 768]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(PUBLIC + "#/proofs");
      if (w === 1440) await page.screenshot({ path: "../../docs/h6/proof-desktop.jpg", type: "jpeg", quality: 72, fullPage: true });
      await page.getByRole("button", { name: "Technical view" }).click();
      await expect(page.getByLabel("Sandbox steps").locator("tr[data-step]")).toHaveCount(58);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), String(w)).toBeLessThanOrEqual(0);
      await page.goto(PUBLIC + "#/explore/choose");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `explore ${w}`).toBeLessThanOrEqual(0);
      if (w === 1440) await page.screenshot({ path: "../../docs/h6/explore-choose-desktop.jpg", type: "jpeg", quality: 72, fullPage: true });
      if (w === 768) await page.screenshot({ path: "../../docs/h6/explore-choose-tablet.jpg", type: "jpeg", quality: 72, fullPage: true });
    }
  });
});
