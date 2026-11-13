// Tests for the dashboard's NEAR layer.
// REAL fixtures: src/near/fixtures/*.json are the final outcomes of the G2 testnet transactions C1, C2, C4, C6, C7
// (fetched read-only from an archival RPC). Variants built from them are marked SYNTHETIC: they test the parser,
// they are not on-chain facts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeAction, claimCall, closeSeasonCall, executeLpCall, fuelStorageCall, planFromPool, registerPositionCall } from "./actions.ts";
import { GAS, TREASURY_ACCOUNT_ID, USDC_TOKEN_ID, isTestnetAccount } from "./config.ts";
import {
  DEPOSIT_MSG, analyzeDeposit, checkDeposit, confirmInTreasury, depositCall, previewSplit, type DepositContext,
} from "./deposit.ts";
import { WalletError, isRejection } from "./errors.ts";
import { applyWalletReturn, parseWalletReturn, txHistory } from "./history.ts";
import { parseOutcome, type TxOutcome } from "./outcome.ts";
import { nearRpc, type NearRpc } from "./rpc.ts";

const fx = (name: string): TxOutcome => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const clone = <T>(x: T): T => structuredClone(x);
const b64 = (v: unknown) => btoa(JSON.stringify(v));
const DEV = "sol2near-dev.testnet";
const CFG = {
  config: { usdc_token: USDC_TOKEN_ID, min_deposit: "1000000", pool_id: 2951, lp_lock_duration_ns: "600000000000" },
  lp_bps: 9000, reserve_bps: 800, community_bps: 200, ready: true,
};
const ctx = (over: Partial<DepositContext> = {}): DepositContext => ({
  accountId: DEV, nearBalance: 10n ** 24n, usdcBalance: 29_900_000n, senderRegistered: true, treasuryRegistered: true,
  cfg: CFG, tokenId: USDC_TOKEN_ID, treasuryId: TREASURY_ACCOUNT_ID, ...over,
});
const problems = (input: string, over: Partial<DepositContext> = {}) => {
  const r = checkDeposit(input, ctx(over));
  return r.ok ? [] : r.problems.join(" | ");
};

// ---------- Wallet ----------

test("wallet: only testnet accounts are accepted (mainnet never)", () => {
  for (const ok of ["sol2near-dev.testnet", "a.b.testnet", "a".repeat(64).replace(/a/g, "f"), "0x" + "ab".repeat(20)]) assert.ok(isTestnetAccount(ok), ok);
  for (const bad of ["alice.near", "testnet", "Alice.testnet", "sol2near-dev.testnet.near", ""]) assert.ok(!isTestnetAccount(bad), bad);
  assert.match(String(problems("10", { accountId: "alice.near" })), /not a testnet account/);
});

test("wallet: disconnected -> deposit not allowed", () => {
  assert.match(String(problems("10", { accountId: null, usdcBalance: null, nearBalance: null })), /Connect a NEAR testnet wallet/);
});

test("wallet: rejection vs other errors", () => {
  assert.ok(isRejection(new Error("User rejected the transaction")));
  assert.ok(isRejection({ code: 4001, message: "x" }));
  assert.ok(isRejection(new Error("User cancelled the action")));
  assert.ok(!isRejection(new Error("Failed to fetch")));
  assert.ok(!isRejection(new Error("Transaction has expired")));
  assert.equal(new WalletError("x", true).rejected, true);
});

test("wallet: no NEAR for gas -> blocked before signing", () => {
  assert.match(String(problems("10", { nearBalance: 10n ** 21n })), /Not enough NEAR for gas/);
});

test("wallet: reload restores the history and applies the browser-wallet redirect result", () => {
  const m = new Map<string, string>();
  const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  const h1 = txHistory(storage);
  const rec = h1.add({ kind: "deposit", accountId: DEV, amount: "10000000" });
  const h2 = txHistory(storage); // page reloaded after the wallet redirect
  assert.equal(h2.list(DEV)[0]!.status, "awaiting_signature");
  const back = parseWalletReturn("?account_id=x&transactionHashes=AAA,BBB");
  assert.deepEqual(back, { hashes: ["AAA", "BBB"] });
  const r = applyWalletReturn(h2, back, DEV)!;
  assert.equal(r.id, rec.id);
  assert.equal(r.status, "submitted");
  assert.equal(r.txHash, "BBB");
});

test("wallet: redirect with an error marks the request rejected; ambiguous returns are not guessed", () => {
  const h = txHistory(null);
  h.add({ kind: "claim", accountId: DEV, target: "0" });
  assert.equal(applyWalletReturn(h, parseWalletReturn("?errorCode=userRejected&errorMessage=User%20rejected"), DEV)!.status, "rejected");
  const h2 = txHistory(null);
  h2.add({ kind: "deposit", accountId: DEV, amount: "1" });
  h2.add({ kind: "claim", accountId: DEV, target: "0" });
  assert.equal(applyWalletReturn(h2, { hashes: ["X"] }, DEV), undefined);
  assert.ok(h2.list(DEV).every((r) => r.status === "awaiting_signature"));
  assert.equal(parseWalletReturn("?foo=1"), null);
});

// ---------- USDC ----------

test("USDC: exact call for 10 USDC (ft_transfer_call, msg, 1 yocto, 100 Tgas)", () => {
  const r = checkDeposit("10", ctx());
  assert.ok(r.ok);
  assert.equal(r.amount, 10_000_000n);
  assert.deepEqual(r.call, {
    receiverId: "usdc.tidepool-sandbox.testnet", methodName: "ft_transfer_call",
    args: { receiver_id: "treasury.sol2near-dev.testnet", amount: "10000000", msg: '{"action":"deposit"}' },
    gas: 100n * 10n ** 12n, deposit: 1n,
  });
  assert.equal(DEPOSIT_MSG, '{"action":"deposit"}');
  assert.deepEqual(r.split, { lp: 9_000_000n, reserve: 800_000n, community: 200_000n });
});

test("USDC: decimals conversion is exact", () => {
  for (const [input, atomic] of [["2.5", 2_500_000n], ["1.000001", 1_000_001n], ["29.9", 29_900_000n]] as const) {
    const r = checkDeposit(input, ctx());
    assert.ok(r.ok, input);
    assert.equal(r.amount, atomic);
  }
});

test("USDC: invalid amounts, below minimum, insufficient balance", () => {
  for (const bad of ["", "0", "-1", "abc", "1e3", "1,5", "1.0000001"]) assert.match(String(problems(bad)), /positive amount/, bad);
  assert.match(String(problems("0.5")), /Minimum deposit is 1 USDC/);
  assert.match(String(problems("30")), /exceeds your USDC balance/);
});

test("USDC: wrong token contract and wrong recipient are refused", () => {
  assert.match(String(problems("10", { tokenId: "wnear.tidepool-sandbox.testnet" })), /accepts only usdc\.tidepool-sandbox\.testnet/);
  assert.match(String(problems("10", { cfg: { ...CFG, config: { ...CFG.config, usdc_token: "other.testnet" } } })), /accepts only other\.testnet/);
  assert.match(String(problems("10", { treasuryId: "attacker.testnet" })), /Unexpected recipient/);
});

test("USDC: missing storage registrations are reported", () => {
  assert.match(String(problems("10", { senderRegistered: false })), /not registered on the USDC contract/);
  assert.match(String(problems("10", { treasuryRegistered: false })), /Treasury has no storage/);
  assert.match(String(problems("10", { cfg: { ...CFG, ready: false } })), /not ready/);
});

// ---------- Treasury ----------

test("Treasury: split preview equals ledger::split (same cases as contracts/treasury/src/ledger.rs)", () => {
  assert.deepEqual(previewSplit(20_000_000n, CFG), { lp: 18_000_000n, reserve: 1_600_000n, community: 400_000n });
  assert.deepEqual(previewSplit(1n, CFG), { lp: 0n, reserve: 0n, community: 1n });
  assert.deepEqual(previewSplit(7n, CFG), { lp: 6n, reserve: 0n, community: 1n });
  assert.deepEqual(previewSplit(13n, CFG), { lp: 11n, reserve: 1n, community: 1n });
  for (const a of [0n, 999_999n, 1_000_001n, 123_456_789_012n]) {
    const s = previewSplit(a, CFG);
    assert.equal(s.lp + s.reserve + s.community, a);
  }
});

test("Treasury: REAL C1 outcome -> deposit #0 counted, 20 USDC used, 18 / 1.6 / 0.4", () => {
  const p = parseOutcome(fx("c1_deposit"));
  assert.equal(p.returnValue, "20000000");
  const v = analyzeDeposit(fx("c1_deposit"), { sender: DEV, amount: 20_000_000n });
  assert.deepEqual(v, { kind: "counted", depositId: "0", used: "20000000", refunded: "0", lp: "18000000", reserve: "1600000", community: "400000" });
});

test("Treasury: SYNTHETIC refusal (deposit_refused, used 0) -> refunded with reason", () => {
  const o = clone(fx("c1_deposit"));
  o.status = { SuccessValue: b64("0") };
  for (const r of o.receipts_outcome)
    r.outcome.logs = r.outcome.logs.map((l) => l.includes("deposit_allocated")
      ? 'EVENT_JSON:{"standard":"sol2near","version":"1.0.0","event":"deposit_refused","data":[{"token":"usdc.tidepool-sandbox.testnet","sender_id":"sol2near-dev.testnet","amount":"20000000","reason":"below_min_deposit"}]}'
      : l);
  assert.deepEqual(analyzeDeposit(o, { sender: DEV, amount: 20_000_000n }), { kind: "refused", reason: "below_min_deposit", refunded: "20000000" });
});

test("Treasury: SYNTHETIC callback failure (ft_on_transfer panicked) -> refunded, never counted", () => {
  const o = clone(fx("c1_deposit"));
  o.status = { SuccessValue: b64("0") };
  for (const r of o.receipts_outcome) {
    r.outcome.logs = r.outcome.logs.filter((l) => !l.includes("deposit_allocated"));
    if (r.outcome.executor_id === TREASURY_ACCOUNT_ID) r.outcome.status = { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: boom" } } } } };
  }
  const v = analyzeDeposit(o, { sender: DEV, amount: 20_000_000n });
  assert.equal(v.kind, "refunded");
  assert.match((v as { detail: string }).detail, /boom/);
});

test("Treasury: SYNTHETIC ft_transfer_call failure (e.g. balance) -> failed", () => {
  const o = clone(fx("c1_deposit"));
  o.status = { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: The account doesn't have enough balance" } } } } };
  assert.deepEqual(analyzeDeposit(o, { sender: DEV, amount: 20_000_000n }), { kind: "failed", detail: "The account doesn't have enough balance" });
});

test("Treasury: SYNTHETIC spoofed event from another contract is ignored", () => {
  const o = clone(fx("c1_deposit"));
  o.status = { SuccessValue: b64("0") };
  for (const r of o.receipts_outcome) if (r.outcome.logs.some((l) => l.includes("deposit_allocated"))) r.outcome.executor_id = "attacker.testnet";
  assert.equal(analyzeDeposit(o, { sender: DEV, amount: 20_000_000n }).kind, "refunded");
});

test("Treasury: wrong signer or partial use is a mismatch, not a success", () => {
  assert.equal(analyzeDeposit(fx("c1_deposit"), { sender: "someone.testnet", amount: 20_000_000n }).kind, "mismatch");
  assert.equal(analyzeDeposit(fx("c1_deposit"), { sender: DEV, amount: 25_000_000n }).kind, "mismatch"); // used 20 of 25 without a 25 event
});

test("Treasury: contribution confirmed against get_deposit; pending tx stays pending", async () => {
  const rpc = (dep: unknown, tx: TxOutcome | null = null): NearRpc => ({ view: async () => dep as never, nearBalance: async () => 0n, codeHash: async () => null, txStatus: async () => tx });
  assert.deepEqual(await confirmInTreasury(rpc({ creator: DEV, amount: "20000000", status: "LpConfirmed" }), "0", DEV, "20000000"), { ok: true, status: "LpConfirmed" });
  assert.equal((await confirmInTreasury(rpc(null), "9", DEV, "1")).ok, false);
  assert.equal((await confirmInTreasury(rpc({ creator: "x.testnet", amount: "20000000" }), "0", DEV, "20000000")).ok, false);
  assert.equal(await rpc(null).txStatus("H", DEV), null);
});

test("Treasury: double submission blocked while a deposit is unresolved", () => {
  const h = txHistory(null);
  const r = h.add({ kind: "deposit", accountId: DEV, amount: "10000000" });
  assert.ok(h.blocking(DEV, "deposit"));
  h.update(r.id, { status: "submitted", txHash: "H" });
  assert.ok(h.blocking(DEV, "deposit"), "still blocked until verified");
  h.update(r.id, { status: "confirmed" });
  assert.equal(h.blocking(DEV, "deposit"), undefined);
  const r2 = h.add({ kind: "deposit", accountId: DEV, amount: "1" });
  h.update(r2.id, { status: "dismissed" });
  assert.equal(h.blocking(DEV, "deposit"), undefined);
});

test("RPC failover: provider trouble -> next provider; chain answers are not retried", async () => {
  const seen: string[] = [];
  const f = (byHost: Record<string, () => Response | Promise<Response>>) => async (u: string) => { const h = new URL(u).host; seen.push(h); return byHost[h]!(); };
  const ok = new Response(JSON.stringify({ result: { result: Array.from(new TextEncoder().encode('"42"')) } }));
  // drpc free-plan timeout (seen in G2) -> fastnear answers
  const r1 = nearRpc(["https://a.example", "https://b.example"], f({ "a.example": () => new Response(JSON.stringify({ error: { message: "Request timeout on the free plan, please upgrade", code: 30 } })), "b.example": () => ok.clone() }));
  assert.equal(await r1.view("c", "m"), "42");
  // network failure and HTTP 503 -> next provider
  assert.equal(await nearRpc(["https://a.example", "https://b.example"], f({ "a.example": () => { throw new TypeError("fetch failed"); }, "b.example": () => ok.clone() })).view("c", "m"), "42");
  assert.equal(await nearRpc(["https://a.example", "https://b.example"], f({ "a.example": () => new Response("", { status: 503 }), "b.example": () => ok.clone() })).view("c", "m"), "42");
  // every provider down -> one clear error
  await assert.rejects(nearRpc(["https://a.example", "https://b.example"], async () => { throw new TypeError("fetch failed"); }).view("c", "m"), /every provider failed/);
  // a real chain error (contract panic) is NOT retried elsewhere
  seen.length = 0;
  await assert.rejects(nearRpc(["https://a.example", "https://b.example"], f({ "a.example": () => new Response(JSON.stringify({ result: { error: "wasm execution failed: ERR_X" } })), "b.example": () => ok.clone() })).view("c", "m"), /ERR_X/);
  assert.deepEqual(seen, ["a.example"]);
});

test("RPC: unknown tx -> null (pending), other errors throw, unknown account -> null", async () => {
  const fake = (body: unknown) => async () => new Response(JSON.stringify(body));
  assert.equal(await nearRpc("http://x", fake({ error: { cause: { name: "UNKNOWN_TRANSACTION" } } })).txStatus("H", DEV), null);
  await assert.rejects(nearRpc("http://x", fake({ error: { cause: { name: "INTERNAL_ERROR" } } })).txStatus("H", DEV), /INTERNAL_ERROR/);
  await assert.rejects(nearRpc("http://x", async () => { throw new TypeError("fetch failed"); }).view("a", "b"), /every provider failed.*fetch failed/);
  assert.equal(await nearRpc("http://x", fake({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } })).nearBalance("nobody.testnet"), null);
});

// ---------- After the deposit ----------

test("LP plan reproduces the REAL C2 plan from the pool state at that time", () => {
  // Pool 2951 after A10 (docs/G2_EXECUTION.md §2): 50.1 USDC / 14.011… wNEAR, 30 bps; C2 budget 18 USDC
  const pool = { token_account_ids: ["usdc.tidepool-sandbox.testnet", "wnear.tidepool-sandbox.testnet"] as [string, string],
    amounts: ["50100000", "14011261544480306269299018"] as [string, string], total_fee: 30 };
  const { plan } = planFromPool(pool, 18_000_000n, 100);
  assert.equal(plan.swap_amount_in, "8323187");
  assert.equal(plan.min_swap_out, "1971050059226938558048313");
  assert.deepEqual(executeLpCall("0", plan), { receiverId: TREASURY_ACCOUNT_ID, methodName: "execute_lp", args: { deposit_id: "0", plan }, gas: GAS.execute_lp, deposit: 0n });
});

test("REAL outcomes: execute_lp, register_position, claim succeed; double claim fails", () => {
  assert.deepEqual(analyzeAction("execute_lp", fx("c2_execute_lp"), DEV), { ok: true, detail: "LP confirmed: 165640253516145704019022 shares (MFT, 24 decimals)" });
  assert.equal(analyzeAction("register_position", fx("c4_register"), DEV).ok, true);
  assert.deepEqual(analyzeAction("claim", fx("c6_claim"), DEV), { ok: true, detail: "claimed 7741449600000000000 (FUEL atomic, 18 decimals)" });
  assert.deepEqual(analyzeAction("claim", fx("c7_double_claim"), DEV), { ok: false, detail: "ERR_ALREADY_CLAIMED" });
  assert.equal(analyzeAction("claim", fx("c6_claim"), "other.testnet").ok, false);
});

test("FUEL calls use the proven gas and exact args", () => {
  assert.deepEqual(registerPositionCall("3"), { receiverId: "fuel.sol2near-dev.testnet", methodName: "register_position", args: { position_id: "3" }, gas: 100n * 10n ** 12n, deposit: 0n });
  assert.deepEqual(claimCall("3").args, { position_id: "3" });
  assert.deepEqual(fuelStorageCall(DEV, "1250000000000000000000"), { receiverId: "fuel.sol2near-dev.testnet", methodName: "storage_deposit", args: { account_id: DEV, registration_only: true }, gas: 30n * 10n ** 12n, deposit: 1250000000000000000000n });
  assert.deepEqual(depositCall(1n).args.receiver_id, TREASURY_ACCOUNT_ID);
});

test("close_season: exact call; REAL C5 outcome -> season 0 SUCCESS", () => {
  assert.deepEqual(closeSeasonCall(67), { receiverId: "fuel.sol2near-dev.testnet", methodName: "close_season", args: { season_id: 67 }, gas: 50n * 10n ** 12n, deposit: 0n });
  const v = analyzeAction("close_season", fx("c5_close_season"), DEV);
  assert.equal(v.ok, true);
  assert.match(v.detail, /season 0 closed: Success \(progress 9676812 \/ 5000000, burned 0, level 1\)/);
});

test("disconnect fallback forgets only Wallet Selector keys (G6: Meteor signOut never settled)", async () => {
  const { forgetSelectorSession } = await import("./session.ts");
  const m = new Map<string, string>([
    ["near-wallet-selector:selectedWalletId", '"meteor-wallet"'], ["near-wallet-selector:recentlySignedInWallets", "[]"],
    ["sol2near.near-tx", "[]"], ["meteor-wallet:something", "x"], ["sol2near.transfers", "{}"],
  ]);
  const storage = { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => void m.delete(k) };
  assert.deepEqual(forgetSelectorSession(storage).sort(), ["near-wallet-selector:recentlySignedInWallets", "near-wallet-selector:selectedWalletId"]);
  assert.deepEqual([...m.keys()].sort(), ["meteor-wallet:something", "sol2near.near-tx", "sol2near.transfers"]);
});

test("bridge amount guard: REAL dry quotes 2026-11-13 - 1 USDC is not depositable, 2 USDC is", async () => {
  const { bridgeCoversTreasuryMin } = await import("./deposit.ts");
  // 1 USDC -> 997400 (min 987426), correlationId d735e82b-…; 2 USDC -> 1994800 (min 1974852), 8dd6ecf1-…
  assert.equal(bridgeCoversTreasuryMin("987426", "1000000"), false);
  assert.equal(bridgeCoversTreasuryMin("1974852", "1000000"), true);
  assert.equal(bridgeCoversTreasuryMin("1000000", "1000000"), true);
});
