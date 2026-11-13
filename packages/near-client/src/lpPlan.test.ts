import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addAmountsInPoolOrder,
  applySlippage,
  getAmountOut,
  isqrt,
  minAmountsFromPredict,
  optimalZapIn,
  previewSwap,
  reservesAfterSwap,
  toTreasuryPlan,
  type PoolSnapshot,
} from "./lpPlan.ts";

const USDC = "usdc.tidepool-sandbox.testnet";
const WNEAR = "wnear.tidepool-sandbox.testnet";

test("swap formula reproduces live Ref get_return (pool 0, 2026-11-11)", () => {
  // get_pool(0): amounts [wrap.testnet, rft], total_fee 40; get_return(1 wNEAR) = 9418312462
  const out = getAmountOut(10n ** 24n, 1496887320520486836637619914n, 14164189905291n, 40);
  assert.equal(out, 9418312462n);
});

test("isqrt is exact floor sqrt", () => {
  for (const n of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 10n ** 40n, 10n ** 40n + 1n, 2n ** 127n]) {
    const r = isqrt(n);
    assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n, `n=${n}`);
  }
});

test("zap leaves amounts proportional to post-swap reserves", () => {
  // Example pool: 10 USDC / 2.688 wNEAR, 30 bps (bootstrap values from scripts/testnet-bootstrap.md)
  const pool: PoolSnapshot = {
    token_account_ids: [USDC, WNEAR],
    amounts: ["10000000", "2688000000000000000000000"],
    total_fee: 30,
  };
  const budget = 18_000_000n; // 90 % of 20 USDC
  const p = previewSwap(budget, pool, USDC, 100);
  assert.ok(p.swapAmountIn > budget / 3n && p.swapAmountIn < budget, "swaps a large share on a small pool");
  const [ru, rw] = reservesAfterSwap(pool, USDC, p);
  // usdcLeft / ru must equal expectedOut / rw within 1e-4 relative error
  const lhs = p.usdcLeft * rw;
  const rhs = p.expectedOut * ru;
  const diff = lhs > rhs ? lhs - rhs : rhs - lhs;
  assert.ok(diff * 10_000n <= rhs, `ratio mismatch lhs=${lhs} rhs=${rhs}`);
  assert.equal(p.minSwapOut, (p.expectedOut * 9_900n) / 10_000n);
});

test("zap on a deep pool swaps about half", () => {
  const s = optimalZapIn(1_000_000n, 10n ** 15n, 30);
  assert.ok(s > 499_000n && s < 501_000n, `s=${s}`);
});

test("pool order is respected for add_liquidity and min_amounts", () => {
  const pool: PoolSnapshot = { token_account_ids: [WNEAR, USDC], amounts: ["1", "1"], total_fee: 30 };
  assert.deepEqual(addAmountsInPoolOrder(pool, USDC, 5n, 9n), [9n, 5n]);
  assert.deepEqual(minAmountsFromPredict(["1000", "2000"], 100), [990n, 1980n]);
  const plan = toTreasuryPlan(
    { swapAmountIn: 7n, expectedOut: 100n, minSwapOut: 99n, usdcLeft: 3n, poolFeeIn: 0n },
    [990n, 1980n],
  );
  assert.deepEqual(plan, { swap_amount_in: "7", min_swap_out: "99", min_amounts: ["990", "1980"] });
});

test("guards reject bad inputs", () => {
  assert.throws(() => getAmountOut(0n, 1n, 1n, 30), /ERR_EMPTY/);
  assert.throws(() => getAmountOut(1n, 1n, 1n, 10_000), /ERR_BAD_FEE/);
  assert.throws(() => applySlippage(1n, 10_000), /ERR_BAD_SLIPPAGE/);
  const pool: PoolSnapshot = { token_account_ids: [WNEAR, "x.testnet"], amounts: ["1", "1"], total_fee: 30 };
  assert.throws(() => previewSwap(1_000_000n, pool, USDC, 100), /ERR_TOKEN_NOT_IN_POOL/);
});

test("priceImpactBps: REAL pool states of the proven LPs and the risky deposit #3", async () => {
  const { priceImpactBps } = await import("./lpPlan.ts");
  const pool = (u: string, w: string): PoolSnapshot => ({ token_account_ids: [USDC, WNEAR], amounts: [u, w], total_fee: 30 });
  const impact = (p: PoolSnapshot, budget: bigint) => { const s = previewSwap(budget, p, USDC, 100); return priceImpactBps(p, USDC, s.swapAmountIn, s.expectedOut); };
  assert.equal(impact(pool("50100000", "14011261544480306269299018"), 18_000_000n), 1446); // G2 C2: 14.46 %
  assert.equal(impact(pool("68099999", "14011261429470853975957975"), 1_800_000n), 159); // G6 #1: 1.59 %
  assert.equal(impact(pool("69899998", "14011261394573939721611473"), 10_800_000n), 720); // G6 #2: 7.20 %
  assert.ok(impact(pool("80699997", "14011261309647048936214624"), 79_195_320n) > 2000); // #3 on the pool of 2026-11-13 21:5x
});
