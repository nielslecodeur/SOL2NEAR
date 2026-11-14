// V4.2A DCL client — on REAL reads: mainnet Nearly pools (scripts/probes/v42-dcl-audit.mjs, read-only) and the
// TreasuryDCL views captured by the local sandbox run against the real DCL wasm (sandbox-tests/tests/v42_dcl.rs).
// Variants marked SYNTHETIC are edits of those reads, to exercise each refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessDcl, buildDclPlan, checkDclPlan, dclPositionState, dclUsdcReconciles, DCL_FUEL_STATUS, estimateDcl, impactBps, NEARLY_DCL_CANDIDATES,
  parsePredictHotzap, pointToPrice, rangeAround, rangeStatus, type DclLive, type DclPositionView, type HotzapPrediction,
} from "./dcl.ts";

const main = JSON.parse(readFileSync(new URL("./fixtures/v42_dcl_mainnet_2026-11-14.json", import.meta.url), "utf8"));
const sbx = JSON.parse(readFileSync(new URL("./fixtures/v42_dcl_sandbox_views.json", import.meta.url), "utf8"));

function liveOf(symbol: string): DclLive {
  const p = main.pools.find((x: { symbol: string }) => x.symbol === symbol);
  const t = p.token_get_tax;
  return {
    pool: { pool_id: p.pool_id, token_x: p.token_x, token_y: p.token_y, fee: p.fee, point_delta: p.point_delta, current_point: p.current_point, liquidity: p.liquidity_active,
      total_liquidity: p.total_liquidity, total_x: p.total_x, total_y: p.total_y, state: p.state, tax: p.pool_tax },
    tokenGlobalHash: p.token_code.global,
    tax: typeof t === "string" ? { kind: "ABSENT" } : { kind: "READ", buy_bps: t.tax.buy_bps, sell_bps: t.tax.sell_bps },
    quoteRef: BigInt(p.quotes["100_usdc"].to_token), quoteSmall: BigInt(p.quotes.small_0_1_usdc_to_token), refUsdc: 100_000_000n,
    dexState: main.contracts["mainnet:dclv2.ref-labs.near"].metadata.state,
  };
}
const cand = (s: string) => NEARLY_DCL_CANDIDATES.find((c) => c.symbol === s)!;

test("real mainnet reads: NEARLY and NEARKAT feasible for a LOCAL test, DRAGON blocked by its tax; nothing executable", () => {
  for (const [s, v] of [["NEARLY", "FEASIBLE_FOR_LOCAL_DCL_TEST"], ["NEARKAT", "FEASIBLE_FOR_LOCAL_DCL_TEST"], ["DRAGON", "BLOCKED_TAX"]] as const) {
    const a = assessDcl(cand(s), liveOf(s));
    assert.equal(a.verdict, v, `${s}: ${a.reasons.join(" | ")}`);
    assert.equal(a.executable, false);
    assert.equal(a.checks.find((c) => c.id === "network")!.ok, false, "mainnet is never fundable by SOL2NEAR");
  }
  assert.match(assessDcl(cand("DRAGON"), liveOf("DRAGON")).checks.find((c) => c.id === "tax")!.detail, /tax v2: buy 100 \/ sell 100 bps/);
  const imp = assessDcl(cand("NEARLY"), liveOf("NEARLY")).impactBps!;
  assert.ok(imp < 100, `NEARLY 100 USDC impact ${imp} bps`);
});

test("registry ids equal the mainnet reads (pool, tokens, fee tier, launch position owned by the Nearly locker)", () => {
  for (const c of NEARLY_DCL_CANDIDATES) {
    const p = main.pools.find((x: { pool_id: string }) => x.pool_id === c.poolId);
    assert.ok(p, c.poolId);
    assert.equal(p.token_code.global, c.tokenCodeHash);
    assert.equal(p.locker, c.locker);
    const row = p.locker_position.rows[0];
    assert.equal(row.lpt_id, c.lockerLptId);
    assert.equal(row.owner_id, c.locker);
    assert.deepEqual([row.left_point, row.right_point], c.lockerRange);
  }
  // NEARLY: liquidity beyond the launch position exists (other, independent positions)
  const n = main.pools.find((x: { symbol: string }) => x.symbol === "NEARLY");
  assert.ok(BigInt(n.total_liquidity) > BigInt(n.locker_position.rows[0].amount) * 3n);
  assert.deepEqual(main.testnet.pools_with_tidepool_token, [], "no testnet DCL pool holds a Tidepool token");
});

test("SYNTHETIC variants: pool tax, paused, code changed, unreadable tax, no route, thin pool, read failure", () => {
  const base = liveOf("NEARLY");
  const c = cand("NEARLY");
  const v = (f: (l: DclLive) => void) => { const l = structuredClone(base); f(l); return assessDcl(c, l).verdict; };
  assert.equal(v((l) => { l.pool.tax = { rate: 100 }; }), "BLOCKED_CONTRACT");
  assert.equal(v((l) => { l.pool.state = "Paused"; }), "BLOCKED_CONTRACT");
  assert.equal(v((l) => { l.dexState = "Paused"; }), "BLOCKED_CONTRACT");
  assert.equal(v((l) => { l.pool.token_x = "imposter.near"; }), "BLOCKED_CONTRACT");
  assert.equal(v((l) => { l.tokenGlobalHash = "8GXVnFTxx1d6tYnoqNiQ5YzzQpj1uyxG7u28LeCGmsER"; }), "BLOCKED_TAX");
  assert.equal(v((l) => { l.tokenGlobalHash = "SomethingElse111"; }), "BLOCKED_TAX");
  assert.equal(v((l) => { l.tax = { kind: "UNREADABLE", error: "timeout" }; }), "BLOCKED_TAX");
  assert.equal(v((l) => { l.quoteRef = 0n; }), "BLOCKED_ROUTE");
  assert.equal(v((l) => { l.quoteRef = l.quoteSmall! * 900n; }), "BLOCKED_LIQUIDITY");
  assert.equal(assessDcl(c, new Error("rpc down")).verdict, "OBSERVE_ONLY", "a failed read concludes nothing");
});

test("price math: NEARLY point → price, ranges on the 200 grid strictly around the price", () => {
  const n = main.pools.find((x: { symbol: string }) => x.symbol === "NEARLY");
  assert.ok(Math.abs(pointToPrice(n.current_point, 18, 24) / n.price_wnear_per_token - 1) < 1e-9);
  for (const cur of [50286, 0, -1, 199, 200, -20_000, 21776]) {
    const [l, r] = rangeAround(cur, 20_000, 200);
    assert.ok(l % 200 === 0 && r % 200 === 0 && l < cur && cur < r, `${cur}: [${l}, ${r}]`);
  }
  assert.deepEqual(rangeAround(0, 20_000, 200), [-20_000, 20_200], "same range as the sandbox run (F1)");
});

test("out of range, as measured in the sandbox: above → all Y, no fees", () => {
  const p = sbx.out_of_range.deposit;
  const cur = sbx.out_of_range_dcl.pool.current_point;
  const s = rangeStatus(cur, p.left_point, p.right_point, "RAWMEME", "wNEAR");
  assert.equal(s.inRange, false);
  assert.equal(s.holds, "Y");
  assert.equal(s.earnsFees, false);
  assert.equal(sbx.out_of_range_dcl.liquidity_view.token_x, "0", "real DCL view: no X left in the position");
  assert.equal(rangeStatus(p.left_point - 1, p.left_point, p.right_point).holds, "X");
  assert.equal(rangeStatus(p.left_point, p.left_point, p.right_point).inRange, true);
});

test("plan mirror: the plan the contract accepted in the sandbox passes, and each guard has the contract's code", () => {
  const plan = sbx.position_confirmed.deposit.plan;
  const g = { maxSlippageBps: 100, maxPriceImpactBps: 1000, maxPlanTtlNs: 600_000_000_000n, minRangeWidth: 4000, maxRangeWidth: 200_000 };
  const now = BigInt(plan.deadline_ns) - 60_000_000_000n;
  assert.equal(checkDclPlan(plan, 18_000_000n, now, g, 200), null);
  const bad = (f: (p: typeof plan) => void) => { const p = structuredClone(plan); f(p); return checkDclPlan(p, 18_000_000n, now, g, 200); };
  assert.equal(bad((p) => { p.left_point += 100; }), "ERR_RANGE_NOT_ON_POINT_DELTA");
  assert.equal(bad((p) => { p.usdc_to_x = "18000000"; }), "ERR_PLAN_OVER_BUDGET");
  assert.equal(bad((p) => { p.min_amount_x = "1"; }), "ERR_PLAN_MIN_AMOUNTS_TOO_LOOSE");
  assert.equal(bad((p) => { p.amount_y = (BigInt(p.min_y_out) + 1n).toString(); }), "ERR_PLAN_AMOUNT_ABOVE_MIN_OUT");
  assert.equal(checkDclPlan(plan, 18_000_000n, BigInt(plan.deadline_ns), g, 200), "ERR_PLAN_EXPIRED");
});

test("predict_hotzap parsing (shape measured on the real DCL) and the estimator", () => {
  const raw = [[{ need_x: "999999999999990228", need_y: "1096403739090412115", liquidity_amount: "82854412346423" }], { "wrap.test.near": "1734793103835795645592770", "rawmeme.test.near": "1654797968859801599716990" }];
  const p = parsePredictHotzap(raw, "rawmeme.test.near", "wrap.test.near")!;
  assert.equal(p.outX, 1654797968859801599716990n + 999999999999990228n);
  assert.equal(parsePredictHotzap({}, "a", "b"), null);
  const e = estimateDcl(20_000_000n, 17_000_000n, p);
  assert.deepEqual([e.lpBudget, e.reserve, e.community, e.unusedToReserve], [18_000_000n, 1_600_000n, 400_000n, 1_000_000n]);
  assert.equal(e.intoPositionX, p.needX);
});

test("plan builder converges on a SYNTHETIC predictor and keeps the guards of the mirror", async () => {
  // synthetic market: X leg pays 2 X per USDC, Y leg 3 Y per USDC; the range wants X:Y = 1:2 in value units
  const predict = async (toX: bigint, toY: bigint, capX: bigint, capY: bigint): Promise<HotzapPrediction> => {
    const outX = toX * 2n, outY = toY * 3n;
    const liq = capX < capY / 2n ? capX : capY / 2n;
    return { outX, outY, needX: liq > outX ? outX : liq, needY: liq * 2n > outY ? outY : liq * 2n, liquidity: liq };
  };
  const r = await buildDclPlan({ spend: 17_000_000n, left: -20_000, right: 20_200, slippageBps: 100, deadlineNs: 2_000n, quote: async (x, y) => [x * 2n, y * 3n], predict });
  const used = (a: bigint, b: bigint) => Number(a) / Number(b);
  assert.ok(Math.abs(used(r.prediction.needX, r.prediction.outX) - used(r.prediction.needY, r.prediction.outY)) < 0.001);
  assert.equal(checkDclPlan(r.plan, 18_000_000n, 1_000n, { maxSlippageBps: 100, maxPriceImpactBps: 1000, maxPlanTtlNs: 10_000n, minRangeWidth: 4000, maxRangeWidth: 200_000 }, 200), null);
});

test("plan builder survives a new block between its two simulations (SYNTHETIC: outputs drop 3 bps, caps above outputs → E101 like mainnet)", async () => {
  let calls = 0;
  const predict = async (toX: bigint, toY: bigint, capX: bigint, capY: bigint): Promise<HotzapPrediction> => {
    const drift = calls++ % 2 === 1 ? 9_997n : 10_000n; // every second call sees a slightly worse block
    const outX = (toX * 2n * drift) / 10_000n, outY = (toY * 3n * drift) / 10_000n;
    if (capX > outX || capY > outY) throw new Error("E101: insufficient balance");
    const liq = capX < capY / 2n ? capX : capY / 2n;
    return { outX, outY, needX: liq, needY: liq * 2n, liquidity: liq };
  };
  const r = await buildDclPlan({ spend: 17_000_000n, left: -20_000, right: 20_200, slippageBps: 100, deadlineNs: 2_000n, quote: async (x, y) => [x * 2n, y * 3n], predict });
  assert.ok(r.prediction.liquidity > 0n);
});

test("TreasuryDCL position states from the real sandbox views", () => {
  const at = (k: string) => sbx[k] as DclPositionView;
  const confirmed = at("position_confirmed");
  const unlock = BigInt(confirmed.deposit.unlock_at!);
  assert.equal(dclPositionState(confirmed, unlock - 1n).state, "POSITION_LOCKED");
  assert.equal(dclPositionState(confirmed, unlock).state, "POSITION_WITHDRAWABLE");
  assert.equal(dclPositionState(at("deposit_allocated"), 0n).state, "DEPOSIT_CONFIRMED");
  assert.equal(dclPositionState(at("position_withdrawn"), unlock).state, "WITHDRAWN");
  for (const k of ["position_confirmed", "fees_claimed", "out_of_range", "position_withdrawn"]) {
    assert.ok(dclUsdcReconciles(at(k).deposit), k);
    assert.equal(at(k).fuel_status, DCL_FUEL_STATUS);
  }
  // fees: booked = what the DCL showed as unclaimed just before the claim
  assert.equal(at("fees_claimed").deposit.fees_claimed_x, sbx.fees_unclaimed_dcl.unclaimed_fee_x);
  // the recorded position equals the DCL's own row
  assert.equal(confirmed.deposit.liquidity, sbx.position_confirmed_dcl.amount);
  assert.equal(sbx.position_confirmed_dcl.owner_id, confirmed.treasury_id);
  // SYNTHETIC: a refused attempt leaves BudgetAllocated + last_error → RECOVERY_REQUIRED
  const refused = structuredClone(at("deposit_allocated"));
  refused.deposit.last_error = "guard: price out of range";
  assert.equal(dclPositionState(refused, 0n).state, "RECOVERY_REQUIRED");
});

test("impact formula", () => {
  assert.equal(impactBps(1000n, 1n), 0);
  assert.equal(impactBps(900n, 1n), 1000);
  assert.equal(impactBps(5n, 0n), 10_000);
});
