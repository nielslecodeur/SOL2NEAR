// TRY TESTNET build (`vite build --mode testnet`, served on :4185): the REAL NEAR Wallet Selector (MyNearWallet, Meteor),
// real NEAR testnet reads, every signature locked. Live: public testnet RPC and the real MyNearWallet login page.
// A wallet session is restored the way MyNearWallet stores it after a sign-in (the account id only: this dApp asks for no
// access key, so no key exists anywhere). Nothing here can sign; every test asserts that no wallet window is asked to sign.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const T = "http://127.0.0.1:4185/";
const RPC = "https://test.rpc.fastnear.com";
const USDC = "usdc.tidepool-sandbox.testnet";
const panel = (page: Page) => page.locator("section.nearpanel");

async function restoreSession(ctx: BrowserContext, accountId: string) {
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem("e2e-seeded")) return; // seed once: a later sign-out must not be undone by a reload
    localStorage.setItem("signedAccountId", a);
    localStorage.setItem("near-wallet-selector:selectedWalletId", JSON.stringify("my-near-wallet"));
    localStorage.setItem("near-wallet-selector:recentlySignedInWallets", JSON.stringify(["my-near-wallet"]));
    sessionStorage.setItem("e2e-seeded", "1");
  }, accountId);
}
async function view(page: Page, contract: string, method: string, args: object) {
  const r = await page.request.post(RPC, { data: { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } } });
  const j = await r.json();
  return JSON.parse(Buffer.from(j.result.result).toString());
}
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("@live @testnet Try Testnet build: real wallet connection, signing locked", () => {
  test("banner, Try Testnet in the menu; the real Wallet Selector lists MyNearWallet and Meteor; MyNearWallet opens its real testnet login (no contract: no access key); closing it connects nothing", async ({ page, context }) => {
    const errors = watch(page);
    const popups: string[] = [];
    context.on("page", (p) => popups.push(p.url()));
    await page.goto(T + "#/console");
    await expect(page.getByTestId("signing-locked-banner")).toContainText("Signing is locked");
    await expect(page.getByLabel("Main").getByRole("link", { name: "Try Testnet" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Try Testnet" })).toBeVisible();
    await panel(page).getByRole("button", { name: "Connect NEAR wallet" }).click();
    await expect(page.getByText("MyNearWallet", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Meteor Wallet", { exact: true })).toBeVisible();
    const popup = context.waitForEvent("page");
    await page.getByText("MyNearWallet", { exact: true }).click();
    const login = await popup;
    expect(login.url()).toMatch(/^https:\/\/testnet\.mynearwallet\.com\/login\/\?success_url=/);
    expect(login.url()).not.toContain("contract_id"); // sign-in without a contract: no function-call key is ever created
    await login.close(); // the user refuses / closes the wallet window
    await page.keyboard.press("Escape");
    await expect(panel(page).getByRole("button", { name: "Connect NEAR wallet" })).toBeVisible({ timeout: 10_000 });
    await expect(panel(page)).not.toContainText("Disconnect");
    expect(popups.every((u) => !/sign|transaction/i.test(new URL(u).pathname))).toBe(true);
    expect(errors).toEqual([]);
  });

  test("restored session: the real account, its real testnet balances and its 3 Treasury deposits; Disconnect returns to Connect", async ({ page, context }) => {
    const errors = watch(page);
    const acct = "lowarena9362.testnet";
    await restoreSession(context, acct);
    await page.goto(T + "#/dashboard");
    await expect(panel(page).getByText(acct, { exact: true })).toBeVisible({ timeout: 30_000 });
    const usdc = await view(page, USDC, "ft_balance_of", { account_id: acct });
    await expect(panel(page).locator(".stat", { hasText: "USDC on NEAR" }).locator("b")).toHaveText((Number(BigInt(usdc)) / 1e6).toString(), { timeout: 30_000 });
    const deposits = await view(page, "treasury.sol2near-dev.testnet", "get_creator_deposits", { creator: acct });
    expect(deposits.length).toBe(3);
    await expect(page.locator(".row:not(.head)")).toHaveCount(deposits.length, { timeout: 30_000 });
    await expect(page.locator(".row", { hasText: "87.9948 USDC" })).toBeVisible(); // deposit #3, the bridged USDC (G7)
    await page.screenshot({ path: "../../docs/h6/try-testnet-connected.jpg", type: "jpeg", quality: 72, fullPage: true });
    await panel(page).getByRole("button", { name: "Disconnect" }).click();
    await expect(panel(page).getByRole("button", { name: "Connect NEAR wallet" })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(panel(page).getByRole("button", { name: "Connect NEAR wallet" })).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test("restored session with test USDC: the review shows the exact ft_transfer_call, and signing is locked (no send button, no wallet window)", async ({ page, context }) => {
    const errors = watch(page);
    const popups: string[] = [];
    context.on("page", (p) => popups.push(p.url()));
    await restoreSession(context, "sol2near-dev.testnet");
    await page.goto(T + "#/dashboard");
    await expect(panel(page).getByText("accepted by Treasury")).toBeVisible({ timeout: 30_000 });
    await panel(page).getByLabel("USDC amount").fill("2");
    await panel(page).getByRole("button", { name: "Deposit to Treasury" }).click();
    const review = page.getByRole("dialog", { name: "Review before signing" });
    await expect(review).toContainText("ft_transfer_call");
    await expect(review).toContainText("treasury.sol2near-dev.testnet");
    await expect(review.getByTestId("signing-locked")).toBeDisabled();
    await expect(review.getByTestId("signing-locked-note")).toContainText("cannot send it");
    await expect(page.getByRole("button", { name: "Confirm & open wallet" })).toHaveCount(0);
    await page.screenshot({ path: "../../docs/h6/try-testnet-review-locked.jpg", type: "jpeg", quality: 72, fullPage: true });
    await review.getByRole("button", { name: "Cancel" }).click();
    expect(popups).toEqual([]); // no wallet window was ever opened
    expect(errors).toEqual([]);
  });

  test("a mainnet account restored from the wallet is never exposed to the app: it stays disconnected, nothing is read or offered", async ({ page, context }) => {
    await restoreSession(context, "alice.near");
    await page.goto(T + "#/dashboard");
    await expect(panel(page).getByRole("button", { name: "Connect NEAR wallet" })).toBeVisible({ timeout: 30_000 });
    await expect(panel(page)).not.toContainText("alice.near");
    await expect(panel(page).getByRole("button", { name: "Deposit to Treasury" })).toHaveCount(0);
  });
});
