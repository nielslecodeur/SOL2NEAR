/**
 * LP plan for Treasury.execute_lp — computed off-chain from LIVE Ref views, never from hard-coded fees.
 *
 * - Swap leg: Ref simple-pool formula, verified on 2026-11-11 to reproduce `get_return` exactly on
 *   ref-finance-101.testnet pool 0 (9418312462 for 1 wNEAR, total_fee 40 bps).
 * - Add-liquidity leg: Ref rounds shares internally (our closed form was 0.01 % off), so min_amounts
 *   MUST come from the live view `predict_add_simple_liquidity`, not from a local formula.
 *
 * All amounts are bigint atomic units. No floats.
 */

const BPS = 10_000n;

export interface PoolSnapshot {
  /** From get_pool(pool_id). */
  token_account_ids: [string, string];
  amounts: [string, string];
  /** Total swap fee in bps, from get_pool (never assumed). */
  total_fee: number;
}

export interface SwapPreview {
  swapAmountIn: bigint;
  expectedOut: bigint;
  minSwapOut: bigint;
  /** Token-in left for add_liquidity after the swap. */
  usdcLeft: bigint;
  /** Effective swap fee taken by the pool, in token-in units (for display). */
  poolFeeIn: bigint;
}

/** Ref simple pool: out = in*(BPS-fee)*Rout / (Rin*BPS + in*(BPS-fee)). */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) throw new Error("ERR_EMPTY_INPUT_OR_POOL");
  const fee = BigInt(feeBps);
  if (fee < 0n || fee >= BPS) throw new Error("ERR_BAD_FEE");
  const inWithFee = amountIn * (BPS - fee);
  return (inWithFee * reserveOut) / (reserveIn * BPS + inWithFee);
}

export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("ERR_NEGATIVE_SQRT");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Amount of token-in to swap so that what is left and what is received match the post-swap pool
 * ratio (single-sided "zap"). Closed form for x*y=k with fee g = (BPS-fee)/BPS:
 *   s = (sqrt(Rin * (Rin*(BPS+G)^2 + 4*G*BPS*A)) - Rin*(BPS+G)) / (2*G)
 */
export function optimalZapIn(amount: bigint, reserveIn: bigint, feeBps: number): bigint {
  if (amount <= 0n || reserveIn <= 0n) throw new Error("ERR_EMPTY_INPUT_OR_POOL");
  const G = BPS - BigInt(feeBps);
  const a = BPS + G;
  const root = isqrt(reserveIn * (reserveIn * a * a + 4n * G * BPS * amount));
  return (root - reserveIn * a) / (2n * G);
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  const s = BigInt(slippageBps);
  if (s < 0n || s >= BPS) throw new Error("ERR_BAD_SLIPPAGE");
  return (amount * (BPS - s)) / BPS;
}

/** Index (0/1) of a token in the pool, or throws. */
export function tokenIndex(pool: PoolSnapshot, tokenId: string): 0 | 1 {
  const i = pool.token_account_ids.indexOf(tokenId);
  if (i !== 0 && i !== 1) throw new Error(`ERR_TOKEN_NOT_IN_POOL: ${tokenId}`);
  return i;
}

/** Swap leg of the plan for an LP budget held in USDC. */
export function previewSwap(
  lpBudgetUsdc: bigint,
  pool: PoolSnapshot,
  usdcToken: string,
  slippageBps: number,
): SwapPreview {
  const iu = tokenIndex(pool, usdcToken);
  const rin = BigInt(pool.amounts[iu]);
  const rout = BigInt(pool.amounts[1 - iu]);
  const swapAmountIn = optimalZapIn(lpBudgetUsdc, rin, pool.total_fee);
  if (swapAmountIn <= 0n || swapAmountIn >= lpBudgetUsdc) throw new Error("ERR_ZAP_OUT_OF_RANGE");
  const expectedOut = getAmountOut(swapAmountIn, rin, rout, pool.total_fee);
  if (expectedOut <= 0n) throw new Error("ERR_SWAP_OUTPUT_ZERO");
  return {
    swapAmountIn,
    expectedOut,
    minSwapOut: applySlippage(expectedOut, slippageBps),
    usdcLeft: lpBudgetUsdc - swapAmountIn,
    poolFeeIn: (swapAmountIn * BigInt(pool.total_fee)) / BPS,
  };
}

/**
 * Price impact of the zap swap in basis points: how much less than the pool's spot price (before fee) we get.
 * The pool fee is included, since it is a real cost. Slippage guards only cover the pool *moving* after the plan;
 * this number is the cost already inside the plan (G7: deposit #3's 79 USDC budget in an ~80 USDC pool).
 */
export function priceImpactBps(pool: PoolSnapshot, usdcToken: string, swapAmountIn: bigint, expectedOut: bigint): number {
  const iu = tokenIndex(pool, usdcToken);
  const ideal = (swapAmountIn * BigInt(pool.amounts[1 - iu])) / BigInt(pool.amounts[iu]);
  if (ideal <= 0n) return 10_000;
  return Number(((ideal - expectedOut) * BPS) / ideal);
}

/** Pool reserves after our own swap (input for predict_add_simple_liquidity). */
export function reservesAfterSwap(pool: PoolSnapshot, usdcToken: string, p: SwapPreview): [bigint, bigint] {
  const iu = tokenIndex(pool, usdcToken);
  const r: [bigint, bigint] = [BigInt(pool.amounts[0]), BigInt(pool.amounts[1])];
  r[iu] += p.swapAmountIn;
  r[1 - iu] -= p.expectedOut;
  return r;
}

/** add_liquidity amounts in pool order. */
export function addAmountsInPoolOrder(pool: PoolSnapshot, usdcToken: string, usdc: bigint, other: bigint): [bigint, bigint] {
  return tokenIndex(pool, usdcToken) === 0 ? [usdc, other] : [other, usdc];
}

/** min_amounts from the LIVE `predict_add_simple_liquidity(...).need_amounts`. */
export function minAmountsFromPredict(needAmounts: [string, string], slippageBps: number): [bigint, bigint] {
  return [applySlippage(BigInt(needAmounts[0]), slippageBps), applySlippage(BigInt(needAmounts[1]), slippageBps)];
}

/** Treasury LpPlan JSON (strings), ready for execute_lp. */
export function toTreasuryPlan(p: SwapPreview, minAmounts: [bigint, bigint]) {
  return {
    swap_amount_in: p.swapAmountIn.toString(),
    min_swap_out: p.minSwapOut.toString(),
    min_amounts: [minAmounts[0].toString(), minAmounts[1].toString()] as [string, string],
  };
}
