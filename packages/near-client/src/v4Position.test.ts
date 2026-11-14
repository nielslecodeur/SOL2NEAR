// V4.1B position manager logic. Inputs are REAL TreasuryV4 / Ref views captured from the real wasm in the LOCAL
// sandbox (fixtures/v4_sandbox_views.json, accounts *.test.near — not testnet). Variants marked SYNTHETIC are derived
// from them to reach states a synchronous sandbox cannot freeze (in-flight jobs, a testnet creator id).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  estimateDeposit, journeyState, positionState, recoveryActions, RECONCILE_TIMEOUT_NS, signingGate, usdcReconciles, V4_SIGNING_ENABLED,
  valueChange, withdrawGate, type V4InFlight, type V4PositionView,
} from "./v4Position.ts";
import { pilotDeployment, V41_PILOT } from "./treasuryV4.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/v4_sandbox_views.json", import.meta.url), "utf8"));
type Snap = { now_ns: string; position: V4PositionView; in_flight: V4InFlight | null; ref_treasury_shares: string; creator_mft_registered: boolean; predict_remove_liquidity: [string, string] | null };
const S = (k: string) => fx[k] as Snap;
const now = (k: string) => BigInt(S(k).now_ns);
const st = (k: string) => positionState(S(k).position, S(k).in_flight, now(k));
/** SYNTHETIC: same real view, creator renamed to a testnet id so the network rules can pass. */
const asTestnet = (v: V4PositionView): V4PositionView => ({ ...v, deposit: { ...v.deposit, creator: "alice.testnet" } });
const USDC = "usdc.test.near";
const MEME = "s2nmeme.test.near";
const SNAPS = ["budget_allocated", "parked_guard_slippage", "lp_confirmed_locked", "parked_price_impact", "aborted_with_leftovers", "aborted_recovered", "lp_unlocked_not_registered", "lp_unlocked_registered", "lp_withdrawn"];

test("reading positions: every real contract view maps to one UI state, and its USDC side reconciles", () => {
  const want: Record<string, string> = {
    budget_allocated: "DEPOSIT_CONFIRMED", parked_guard_slippage: "RECOVERY_REQUIRED", lp_confirmed_locked: "LOCKED",
    parked_price_impact: "RECOVERY_REQUIRED", aborted_with_leftovers: "ABORTED", aborted_recovered: "ABORTED",
    lp_unlocked_not_registered: "WITHDRAWABLE", lp_unlocked_registered: "WITHDRAWABLE", lp_withdrawn: "WITHDRAWN",
  };
  for (const k of SNAPS) {
    assert.equal(st(k).state, want[k], k);
    assert.ok(usdcReconciles(S(k).position.deposit), `USDC reconciles in ${k}`);
    assert.equal(S(k).position.fuel_status, "FUEL_NOT_ELIGIBLE", `FUEL in ${k}`);
  }
  assert.match(st("parked_guard_slippage").detail, /guard_slippage/);
  assert.match(st("parked_price_impact").detail, /guard_price_impact/);
});

test("LP really confirmed: Ref's share count for TreasuryV4 equals the position, verified, locked until unlock_at", () => {
  const s = S("lp_confirmed_locked");
  assert.equal(s.ref_treasury_shares, s.position.deposit.lp_shares);
  assert.equal(s.position.deposit.lp_verified, true);
  assert.equal(s.position.locked, true);
  assert.match(st("lp_confirmed_locked").detail, /locked until/);
});

test("LP not confirmed: pending stages and an UNVERIFIED LP are never shown as a plain confirmed LP (SYNTHETIC)", () => {
  const v = S("lp_confirmed_locked").position;
  const pending = { ...v, deposit: { ...v.deposit, status: { AddLiquidityPending: { usdc: "9026680", base: "1" } } } } as V4PositionView;
  const job: V4InFlight = { deposit_id: "0", since: S("lp_confirmed_locked").now_ns, job: "Lp" };
  assert.equal(positionState(pending, job, now("lp_confirmed_locked")).state, "LP_PENDING");
  const unverified = { ...v, deposit: { ...v.deposit, lp_verified: false } };
  assert.match(positionState(unverified, null, now("lp_confirmed_locked")).detail, /UNVERIFIED/);
});

test("failed callback / lost callback: a fresh job is SWAP_PENDING (do not resend); after the timeout it is RECOVERY_REQUIRED with reconcile (SYNTHETIC in-flight)", () => {
  const v = S("budget_allocated").position;
  const swapping = { ...v, deposit: { ...v.deposit, status: { SwapPending: { usdc: "18000000" } } } } as V4PositionView;
  const t0 = now("budget_allocated");
  const job: V4InFlight = { deposit_id: "0", since: t0.toString(), job: "Lp" };
  const fresh = positionState(swapping, job, t0 + 5n * 10n ** 9n);
  assert.equal(fresh.state, "SWAP_PENDING");
  assert.match(fresh.detail, /do not resend/);
  // reload during the operation: nothing local is needed, the same views give the same state
  assert.deepEqual(positionState(swapping, job, t0 + 5n * 10n ** 9n), fresh);
  const late = positionState(swapping, job, t0 + RECONCILE_TIMEOUT_NS);
  assert.equal(late.state, "RECOVERY_REQUIRED");
  const actions = recoveryActions({ view: swapping, inFlight: job, nowNs: t0 + 5n * 10n ** 9n, wallet: v.deposit.creator, reserve: 0n, baseBalance: 0n, usdcToken: USDC, baseToken: MEME });
  assert.deepEqual(actions.map((a) => a.id), ["reconcile"], "no resume / abort while the job is in flight");
  assert.match(actions[0]!.blockedBy[0]!, /Too early/);
  assert.deepEqual(recoveryActions({ view: swapping, inFlight: job, nowNs: t0 + RECONCILE_TIMEOUT_NS, wallet: null, reserve: 0n, baseBalance: 0n, usdcToken: USDC, baseToken: MEME })[0]!.blockedBy, []);
});

test("withdraw before the lock ends: refused with the unlock time", () => {
  const g = withdrawGate({ network: "testnet", wallet: "alice.testnet", view: asTestnet(S("lp_confirmed_locked").position), inFlight: null, nowNs: now("lp_confirmed_locked"), creatorMftRegistered: true, refTreasuryShares: BigInt(S("lp_confirmed_locked").ref_treasury_shares) });
  assert.equal(g.ok, false);
  assert.match(g.reasons.join(" "), /Locked until/);
  assert.equal(g.call, null);
});

test("withdraw after the lock: allowed for the creator on testnet, with mft_register as a prerequisite until it is done", () => {
  const base = (k: string) => ({ network: "testnet", wallet: "alice.testnet", view: asTestnet(S(k).position), inFlight: null, nowNs: now(k), creatorMftRegistered: S(k).creator_mft_registered, refTreasuryShares: BigInt(S(k).ref_treasury_shares) });
  const before = withdrawGate(base("lp_unlocked_not_registered"));
  assert.equal(before.ok, true);
  assert.match(before.prerequisites[0]!, /mft_register/);
  const after = withdrawGate(base("lp_unlocked_registered"));
  assert.deepEqual([after.ok, after.prerequisites.length, after.call?.methodName, after.call?.deposit], [true, 0, "withdraw_lp", 1n]);
});

test("withdraw is impossible: wrong wallet, wrong network, sandbox account, job in flight, shares missing on Ref", () => {
  const k = "lp_unlocked_registered";
  const v = asTestnet(S(k).position);
  const g = (o: object) => withdrawGate({ network: "testnet", wallet: "alice.testnet", view: v, inFlight: null, nowNs: now(k), creatorMftRegistered: true, refTreasuryShares: BigInt(S(k).ref_treasury_shares), ...o });
  assert.match(g({ wallet: "bob.testnet" }).reasons.join(), /Only the creator/);
  assert.match(g({ wallet: null }).reasons.join(), /Connect/);
  assert.match(g({ network: "mainnet" }).reasons.join(), /Wrong network/);
  assert.match(withdrawGate({ ...{ network: "testnet", wallet: "alice.test.near", view: S(k).position, inFlight: null, nowNs: now(k), creatorMftRegistered: true, refTreasuryShares: 10n ** 30n } }).reasons.join(), /not a NEAR testnet account/);
  assert.match(g({ inFlight: { deposit_id: "1", since: "0", job: "Lp" } }).reasons.join(), /another job/);
  assert.match(g({ refTreasuryShares: 0n }).reasons.join(), /fewer shares/);
});

test("double withdraw: in progress and already withdrawn are both refused", () => {
  const w = S("lp_withdrawn");
  assert.match(withdrawGate({ network: "testnet", wallet: "alice.testnet", view: asTestnet(w.position), inFlight: null, nowNs: now("lp_withdrawn"), creatorMftRegistered: true, refTreasuryShares: 0n }).reasons.join(), /already withdrawn/);
  const pending = { ...asTestnet(w.position), deposit: { ...asTestnet(w.position).deposit, status: "LpWithdrawPending" as const } };
  assert.match(withdrawGate({ network: "testnet", wallet: "alice.testnet", view: pending, inFlight: null, nowNs: now("lp_withdrawn"), creatorMftRegistered: true, refTreasuryShares: 0n }).reasons.join(), /already in progress/);
  assert.equal(positionState(pending, null, now("lp_withdrawn")).state, "WITHDRAW_PENDING");
});

test("recovery: only actions the contract supports, each with funds, preconditions, recipient and risks", () => {
  const ctx = (k: string, reserve = 0n) => ({ view: S(k).position, inFlight: S(k).in_flight, nowNs: now(k), wallet: S(k).position.deposit.creator, reserve, baseBalance: 0n, usdcToken: USDC, baseToken: MEME });
  // parked by a guard: resume or abort, nothing else
  assert.deepEqual(recoveryActions(ctx("parked_price_impact")).map((a) => a.id), ["resume_lp", "abort_lp"]);
  // aborted with the 810 USDC in Ref: recover the USDC leftover (to the reserve), no resume
  const ab = recoveryActions(ctx("aborted_with_leftovers"));
  assert.deepEqual(ab.map((a) => a.id), ["withdraw_leftover_usdc"]);
  assert.match(ab[0]!.funds, /810000000/);
  assert.match(ab[0]!.recipient, /reserve/);
  for (const a of ab) assert.ok(a.objective && a.preconditions.length && a.recipient && a.risks && a.call);
  // recovered: nothing left in Ref; the reserve is withdrawable
  assert.deepEqual(recoveryActions(ctx("aborted_recovered", 883_600_000n)).map((a) => a.id), ["withdraw_reserve"]);
  // LP confirmed with 1 + 1 atomic of dust: both leftovers, never an abort
  assert.deepEqual(recoveryActions(ctx("lp_confirmed_locked")).map((a) => a.id), ["withdraw_leftover_usdc", "withdraw_leftover_base"]);
  // someone else's wallet: every action blocked
  assert.ok(recoveryActions({ ...ctx("parked_price_impact"), wallet: "bob.test.near" }).every((a) => a.blockedBy.some((b) => /Only the creator/.test(b))));
});

test("estimator on the real sandbox pool: 20 USDC gives the same plan, quote and shares as the contract produced", () => {
  const pool = fx.pool_before_lp;
  const real = S("lp_confirmed_locked").position.deposit;
  const e = estimateDeposit({
    amountAtomic: 20_000_000n, minDeposit: 1_000_000n, usdcBalance: 1_000_000_000n, creatorUsdcRegistered: true,
    pool, usdcToken: USDC, quotedOut: BigInt(real.base_in_lp) + BigInt(real.dust_base), adminFeeBps: fx.ref_metadata.admin_fee_bps,
    guards: V41_PILOT.guards, nowNs: now("budget_allocated"), slippageBps: 50,
  });
  assert.deepEqual(e.problems, []);
  assert.deepEqual(e.split, { lp: 18_000_000n, reserve: 1_600_000n, community: 400_000n });
  assert.equal(e.plan!.swapUsdcIn.toString(), real.usdc_swapped);
  assert.equal(e.quoteMatches, true, "Ref get_return of the sandbox run = local plan");
  const minted = BigInt(real.lp_shares);
  const diff = e.estimatedShares! > minted ? e.estimatedShares! - minted : minted - e.estimatedShares!;
  assert.ok(diff * 1_000_000n <= minted, `estimated shares ${e.estimatedShares} vs minted ${minted} (≤ 1 ppm)`);
  assert.equal(e.lpFeeShareBps, 30, "sandbox Ref has admin_fee_bps 0: the whole 30 bps fee stays with LPs");
});

test("estimator refusals: expired / too-far quote, excessive slippage, excessive impact, low balance, missing storage, no pool", () => {
  const pool = fx.pool_before_lp;
  const base = { amountAtomic: 20_000_000n, minDeposit: 1_000_000n, usdcBalance: 1_000_000_000n, creatorUsdcRegistered: true, pool, usdcToken: USDC, quotedOut: null, adminFeeBps: 2000, guards: V41_PILOT.guards, nowNs: 10n ** 18n, slippageBps: 50 };
  assert.match(estimateDeposit({ ...base, amountAtomic: 900_000_000n }).problems.join(), /price impact/);
  assert.match(estimateDeposit({ ...base, slippageBps: 300 }).problems.join(), /min_swap_out/);
  assert.match(estimateDeposit({ ...base, guards: { ...V41_PILOT.guards, maxPlanTtlNs: 0n } }).problems.join(), /plan valid until/);
  assert.match(estimateDeposit({ ...base, usdcBalance: 1n }).problems.join(), /exceeds/);
  assert.match(estimateDeposit({ ...base, creatorUsdcRegistered: false }).problems.join(), /storage missing/);
  assert.match(estimateDeposit({ ...base, amountAtomic: 999_999n }).problems.join(), /minimum deposit/);
  assert.match(estimateDeposit({ ...base, pool: null }).problems.join(), /not deployed/);
  assert.equal(estimateDeposit({ ...base, adminFeeBps: 2000 }).lpFeeShareBps, 24, "testnet Ref admin_fee_bps 2000: LPs keep 24 of 30 bps");
});

test("value change of a Classic position mixes fees and price moves: real predict_remove_liquidity right after the LP", () => {
  const s = S("lp_confirmed_locked");
  const v = valueChange(s.position.deposit, s.predict_remove_liquidity, 0)!;
  assert.deepEqual(v.delta, [-1n, -1n], "rounding only: no trade happened in the sandbox between add and read");
});

test("journey: NOT_DEPLOYED, READY, DEPOSIT_PENDING, refused / failed transactions; the chain stays authoritative", () => {
  const latest = S("budget_allocated").position;
  const n = now("budget_allocated");
  assert.equal(journeyState({ deploymentReady: false, latest, inFlight: null, nowNs: n }).state, "NOT_DEPLOYED");
  assert.equal(journeyState({ deploymentReady: true, latest: null, inFlight: null, nowNs: n }).state, "READY");
  assert.equal(journeyState({ deploymentReady: true, latest: null, inFlight: null, nowNs: n, depositCount: 0, pendingTx: { kind: "deposit", status: "submitted", afterDepositCount: 0 } }).state, "DEPOSIT_PENDING");
  assert.equal(journeyState({ deploymentReady: true, latest, inFlight: null, nowNs: n, depositCount: 1, pendingTx: { kind: "deposit", status: "submitted", afterDepositCount: 0 } }).state, "DEPOSIT_CONFIRMED");
  assert.equal(journeyState({ deploymentReady: true, latest, inFlight: null, nowNs: n, pendingTx: { kind: "execute_lp", status: "rejected" } }).state, "DEPOSIT_CONFIRMED", "a wallet rejection sent nothing");
  assert.equal(journeyState({ deploymentReady: true, latest, inFlight: null, nowNs: n, pendingTx: { kind: "execute_lp", status: "failed", detail: "Exceeded the prepaid gas" } }).state, "FAILED");
});

test("signing is locked in V4.1B whatever the inputs; wrong network and missing wallet are reported too", () => {
  assert.equal(V4_SIGNING_ENABLED, false);
  const g = signingGate({ deploymentReady: true, network: "testnet", wallet: "alice.testnet" });
  assert.equal(g.allowed, false);
  assert.match(g.reasons.join(), /disabled in V4\.1B/);
  assert.match(signingGate({ deploymentReady: false, network: "mainnet", wallet: null }).reasons.join(" | "), /not deployed.*Wrong network.*No NEAR wallet/);
});

test("wrong configuration: the real sandbox config (network sandbox, *.test.near tokens) is NOT accepted as the testnet pilot", async () => {
  const both: Record<string, string> = { [V41_PILOT.treasuryId]: "h1", [V41_PILOT.baseTokenId]: "h2" };
  const d = await pilotDeployment({ async codeHash(id) { return both[id] ?? null; }, async view<T>() { return fx.config as T; } });
  assert.equal(d.state, "DEPLOYED_NOT_READY");
});

test("a stuck leftover withdrawal can be reconciled after the timeout (contract fix of V4.1B), never before", () => {
  const v = S("lp_confirmed_locked").position;
  const t0 = now("lp_confirmed_locked");
  const job: V4InFlight = { deposit_id: "0", since: t0.toString(), job: { Leftover: { token: MEME, amount: "1" } } };
  const early = recoveryActions({ view: v, inFlight: job, nowNs: t0 + 1n, wallet: v.deposit.creator, reserve: 0n, baseBalance: 0n, usdcToken: USDC, baseToken: MEME });
  const rec = early.find((a) => a.id === "reconcile")!;
  assert.match(rec.funds, /leftover of deposit #0/);
  assert.match(rec.blockedBy.join(), /Too early/);
  assert.ok(early.filter((a) => a.id.startsWith("withdraw_leftover")).every((a) => a.blockedBy.some((b) => /runs a job/.test(b))), "no second leftover job while one is in flight");
  const late = recoveryActions({ view: v, inFlight: job, nowNs: t0 + RECONCILE_TIMEOUT_NS, wallet: v.deposit.creator, reserve: 0n, baseBalance: 0n, usdcToken: USDC, baseToken: MEME });
  assert.deepEqual(late.find((a) => a.id === "reconcile")!.blockedBy, []);
});
