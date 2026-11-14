/**
 * V4.1 Classic pilot — client side of `contracts/treasury-v4`. NOTHING HERE IS DEPLOYED.
 *
 * - V41_PILOT: the PLANNED testnet accounts and parameters. The accounts do not exist (checked 2026-11-14:
 *   view_account → UNKNOWN_ACCOUNT); `pilotDeployment` reads them live and stays NOT_DEPLOYED until they do.
 * - planV4: the execute_lp plan (same zap code as V3 / execute_lp), with the deadline and the add_liquidity guard
 *   TreasuryV4 requires; checkPlanGuards mirrors the contract's own checks so the review can show them before a
 *   signature. The contract re-checks everything against Ref at execution: this mirror is a convenience, not a guard.
 * - Call builders: the exact calls a creator would sign (each one needs a separate approval).
 * - fuelEligibility: read from the DEPLOYED FUEL config; V4 positions are FUEL_NOT_ELIGIBLE.
 */
import { addAmountsInPoolOrder, applySlippage, previewSwap, priceImpactBps, type PoolSnapshot } from "./lpPlan.ts";

const TGAS = 10n ** 12n;
const BPS = 10_000n;

export interface V4Guards { maxSlippageBps: number; maxPriceImpactBps: number; maxPlanTtlNs: bigint }

/** Planned, NOT deployed. Every value here must be re-read on-chain (get_config) once deployed. */
export const V41_PILOT = {
  network: "testnet",
  treasuryId: "treasury-v4.sol2near-dev.testnet",
  baseTokenId: "s2nmeme.sol2near-dev.testnet",
  baseSymbol: "S2NMEME",
  baseDecimals: 18,
  usdcTokenId: "usdc.tidepool-sandbox.testnet",
  usdcDecimals: 6,
  dex: "ref-finance-101.testnet",
  /** Unknown until `add_simple_pool` runs (needs approval). */
  poolId: null as number | null,
  feeBps: 30,
  minDepositAtomic: 1_000_000n,
  /** 600 s: equal to the deployed FUEL min_lock_ns, so a future FUEL version would not need a different lock. */
  lockNs: 600n * 10n ** 9n,
  guards: { maxSlippageBps: 100, maxPriceImpactBps: 1_000, maxPlanTtlNs: 600n * 10n ** 9n } satisfies V4Guards,
  label: "SANDBOX PILOT — test token S2NMEME (no value), not a real memecoin",
} as const;

// ---------- deployment status (live reads) ----------

export type PilotDeployment =
  | { state: "NOT_DEPLOYED"; missing: string[] }
  | { state: "DEPLOYED_NOT_READY"; detail: string }
  | { state: "READY"; poolId: number };

export interface PilotReads {
  /** view_account code hash, null when the account does not exist or has no contract. */
  codeHash(accountId: string): Promise<string | null>;
  view<T>(contract: string, method: string, args?: object): Promise<T>;
}

export async function pilotDeployment(r: PilotReads): Promise<PilotDeployment> {
  const [t, b] = await Promise.all([r.codeHash(V41_PILOT.treasuryId), r.codeHash(V41_PILOT.baseTokenId)]);
  const missing = [...(t ? [] : [V41_PILOT.treasuryId]), ...(b ? [] : [V41_PILOT.baseTokenId])];
  if (missing.length) return { state: "NOT_DEPLOYED", missing };
  const cfg = await r.view<{ ready: boolean; config: { pool: { pool_id: number; base_token: string; usdc_token: string; dex: string } } }>(V41_PILOT.treasuryId, "get_config");
  const p = cfg.config.pool;
  if (p.base_token !== V41_PILOT.baseTokenId || p.usdc_token !== V41_PILOT.usdcTokenId || p.dex !== V41_PILOT.dex)
    return { state: "DEPLOYED_NOT_READY", detail: `config ${JSON.stringify(p)} differs from the planned pilot` };
  if (!cfg.ready) return { state: "DEPLOYED_NOT_READY", detail: "setup not done (or it failed its on-chain pool / decimals checks)" };
  return { state: "READY", poolId: p.pool_id };
}

// ---------- FUEL ----------

export interface FuelConfig { treasury_id: string; pool_id: number; min_lock_ns: string }
export type FuelEligibility = { status: "FUEL_NOT_ELIGIBLE"; reason: string } | { status: "FUEL_COMPATIBLE_CONFIG" };

/** The deployed FUEL contract only reads positions from its own `treasury_id` and `pool_id` (no setter). */
export function fuelEligibility(fuel: FuelConfig, treasuryId: string, poolId: number | null): FuelEligibility {
  if (fuel.treasury_id !== treasuryId)
    return { status: "FUEL_NOT_ELIGIBLE", reason: `the deployed FUEL reads positions only from ${fuel.treasury_id} (immutable config), not ${treasuryId}` };
  if (poolId === null || fuel.pool_id !== poolId)
    return { status: "FUEL_NOT_ELIGIBLE", reason: `the deployed FUEL accepts pool ${fuel.pool_id} only` };
  return { status: "FUEL_COMPATIBLE_CONFIG" };
}

// ---------- plan ----------

export interface V4Plan {
  swap_amount_in: string;
  min_swap_out: string;
  min_amounts: [string, string];
  deadline_ns: string;
}

export interface V4PlanPreview {
  plan: V4Plan;
  swapUsdcIn: bigint;
  expectedBaseOut: bigint;
  usdcLeft: bigint;
  poolFeeUsdc: bigint;
  priceImpactBps: number;
  provided: [bigint, bigint];
}

/**
 * Plan for TreasuryV4.execute_lp from a fresh get_pool. `slippageBps` must be <= the contract's max_slippage_bps
 * (min_swap_out is checked against Ref's get_return at execution, min_amounts against the provided amounts).
 */
export function planV4(pool: PoolSnapshot, usdcToken: string, lpBudget: bigint, nowNs: bigint, opts: { slippageBps: number; ttlNs: bigint }): V4PlanPreview {
  const p = previewSwap(lpBudget, pool, usdcToken, opts.slippageBps);
  const provided = addAmountsInPoolOrder(pool, usdcToken, p.usdcLeft, p.expectedOut);
  return {
    plan: {
      swap_amount_in: p.swapAmountIn.toString(),
      min_swap_out: p.minSwapOut.toString(),
      min_amounts: [applySlippage(provided[0], opts.slippageBps).toString(), applySlippage(provided[1], opts.slippageBps).toString()],
      deadline_ns: (nowNs + opts.ttlNs).toString(),
    },
    swapUsdcIn: p.swapAmountIn,
    expectedBaseOut: p.expectedOut,
    usdcLeft: p.usdcLeft,
    poolFeeUsdc: p.poolFeeIn,
    priceImpactBps: priceImpactBps(pool, usdcToken, p.swapAmountIn, p.expectedOut),
    provided,
  };
}

export interface GuardCheck { id: "deadline" | "ttl" | "swap_guard" | "add_guard" | "price_impact" | "nonzero"; ok: boolean; detail: string }

/** Same rules as contracts/treasury-v4 (validate_plan, check_swap, launch_add_liquidity). For the review only. */
export function checkPlanGuards(pv: V4PlanPreview, quotedOut: bigint, nowNs: bigint, g: V4Guards): GuardCheck[] {
  const p = pv.plan;
  const deadline = BigInt(p.deadline_ns);
  const minOut = BigInt(p.min_swap_out);
  const floorSwap = (quotedOut * (BPS - BigInt(g.maxSlippageBps))) / BPS;
  const floorAdd = BPS - 2n * BigInt(g.maxSlippageBps);
  const addOk = p.min_amounts.every((m, i) => BigInt(m) <= pv.provided[i]! && BigInt(m) >= (pv.provided[i]! * floorAdd) / BPS);
  return [
    { id: "nonzero", ok: BigInt(p.swap_amount_in) > 0n && minOut > 0n && p.min_amounts.every((m) => BigInt(m) > 0n), detail: "swap amount, swap guard and both add guards are > 0" },
    { id: "deadline", ok: deadline > nowNs, detail: `plan valid until ${new Date(Number(deadline / 1_000_000n)).toISOString()}` },
    { id: "ttl", ok: deadline <= nowNs + g.maxPlanTtlNs, detail: `deadline within ${g.maxPlanTtlNs / 1_000_000_000n} s of submission` },
    { id: "swap_guard", ok: minOut >= floorSwap, detail: `min_swap_out ${minOut} >= Ref quote ${quotedOut} − ${g.maxSlippageBps} bps (${floorSwap})` },
    { id: "add_guard", ok: addOk, detail: `add_liquidity guards within ${2 * g.maxSlippageBps} bps of the provided amounts` },
    { id: "price_impact", ok: pv.priceImpactBps <= g.maxPriceImpactBps, detail: `price impact ${(pv.priceImpactBps / 100).toFixed(2)} % (contract limit ${(g.maxPriceImpactBps / 100).toFixed(2)} %)` },
  ];
}

// ---------- calls (each one is a separate signature, never sent from here) ----------

export interface V4Call { receiverId: string; methodName: string; args: Record<string, unknown>; gas: bigint; deposit: bigint }

/** Accounts the calls are built for: the planned testnet pilot by default, or the accounts a source reports. */
export interface V4CallIds { treasury: string; usdc: string; dex: string }

export function v4CallsFor(ids: V4CallIds) {
  return {
    deposit: (amount: bigint): V4Call => ({
      receiverId: ids.usdc, methodName: "ft_transfer_call",
      args: { receiver_id: ids.treasury, amount: amount.toString(), msg: JSON.stringify({ action: "deposit" }) }, gas: 100n * TGAS, deposit: 1n,
    }),
    executeLp: (depositId: string, plan: V4Plan | null): V4Call => ({ receiverId: ids.treasury, methodName: "execute_lp", args: { deposit_id: depositId, plan }, gas: 300n * TGAS, deposit: 0n }),
    abortLp: (depositId: string): V4Call => ({ receiverId: ids.treasury, methodName: "abort_lp", args: { deposit_id: depositId }, gas: 30n * TGAS, deposit: 0n }),
    withdrawLeftover: (depositId: string, tokenId: string): V4Call => ({
      receiverId: ids.treasury, methodName: "withdraw_leftover", args: { deposit_id: depositId, token_id: tokenId }, gas: 150n * TGAS, deposit: 1n,
    }),
    withdrawReserve: (amount: bigint): V4Call => ({ receiverId: ids.treasury, methodName: "withdraw_reserve", args: { amount: amount.toString() }, gas: 100n * TGAS, deposit: 1n }),
    withdrawBase: (amount: bigint): V4Call => ({ receiverId: ids.treasury, methodName: "withdraw_base", args: { amount: amount.toString() }, gas: 100n * TGAS, deposit: 1n }),
    /** Needed once before withdraw_lp: the creator registers for the pool shares on Ref. */
    mftRegister: (poolId: number, accountId: string): V4Call => ({
      receiverId: ids.dex, methodName: "mft_register", args: { token_id: `:${poolId}`, account_id: accountId }, gas: 30n * TGAS, deposit: 10n ** 22n,
    }),
    withdrawLp: (depositId: string): V4Call => ({ receiverId: ids.treasury, methodName: "withdraw_lp", args: { deposit_id: depositId }, gas: 100n * TGAS, deposit: 1n }),
    reconcile: (): V4Call => ({ receiverId: ids.treasury, methodName: "reconcile", args: {}, gas: 50n * TGAS, deposit: 0n }),
  };
}
export type V4Calls = ReturnType<typeof v4CallsFor>;
export const v4Calls: V4Calls = v4CallsFor({ treasury: V41_PILOT.treasuryId, usdc: V41_PILOT.usdcTokenId, dex: V41_PILOT.dex });

/** Ordered creator journey (spec §8): what is signed at each step, by whom. */
export const V41_JOURNEY = [
  { step: "Pool selected", signs: null, detail: "Allowlisted pool, re-validated from live reads (V4.0 checks)" },
  { step: "Quote", signs: null, detail: "Fresh get_pool + Ref get_return; read only" },
  { step: "Review", signs: null, detail: "Exact calls, amounts, guards, risks; nothing is sent" },
  { step: "Deposit", signs: "creator (NEAR wallet)", detail: "usdc.ft_transfer_call → TreasuryV4, split 90/8/2 on-chain" },
  { step: "Swap", signs: "creator (NEAR wallet), execute_lp", detail: "Treasury → Ref; on-chain impact / slippage / deadline guards before the swap" },
  { step: "LP", signs: "same execute_lp transaction", detail: "add_liquidity, then shares and consumed amounts verified from Ref views" },
  { step: "Position", signs: null, detail: "Locked LP held by TreasuryV4 for the creator; leftovers recoverable; FUEL not eligible" },
] as const;
