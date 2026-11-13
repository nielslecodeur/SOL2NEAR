/**
 * Calls after the deposit, all signed by the user's wallet, all with the gas proven in G2:
 * - Treasury.execute_lp(deposit_id, plan): creator-only; the plan comes from the LIVE Ref pool (near-client);
 * - FUEL.register_position(position_id): permissionless, rewards always go to the Treasury-recorded creator;
 * - FUEL.claim(position_id): after season close + LP unlock; needs the creator registered on FUEL storage.
 */
import {
  addAmountsInPoolOrder,
  minAmountsFromPredict,
  previewSwap,
  toTreasuryPlan,
  type PoolSnapshot,
} from "../../../../packages/near-client/src/lpPlan.ts";
import { FUEL_ACCOUNT_ID, GAS, REF_EXCHANGE_ID, TREASURY_ACCOUNT_ID, USDC_TOKEN_ID } from "./config.ts";
import type { TxCall } from "./deposit.ts";
import { eventsFrom, parseOutcome, type TxOutcome } from "./outcome.ts";
import type { NearRpc } from "./rpc.ts";

export const DEFAULT_SLIPPAGE_BPS = 100;

/** Same computation as scripts/plan-lp.ts (used for G2 C2), from a fresh get_pool. */
export async function planLp(rpc: NearRpc, poolId: number, lpBudget: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const pool = await rpc.view<PoolSnapshot>(REF_EXCHANGE_ID, "get_pool", { pool_id: poolId });
  return planFromPool(pool, lpBudget, slippageBps);
}

export function planFromPool(pool: PoolSnapshot, lpBudget: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const p = previewSwap(lpBudget, pool, USDC_TOKEN_ID, slippageBps);
  const provided = addAmountsInPoolOrder(pool, USDC_TOKEN_ID, p.usdcLeft, p.expectedOut);
  const plan = toTreasuryPlan(p, minAmountsFromPredict([provided[0].toString(), provided[1].toString()], slippageBps));
  return { plan, preview: { swapUsdcIn: p.swapAmountIn, expectedWnearOut: p.expectedOut, usdcLeftForLp: p.usdcLeft, poolFeeUsdc: p.poolFeeIn } };
}

export const executeLpCall = (depositId: string, plan: unknown): TxCall => ({
  receiverId: TREASURY_ACCOUNT_ID, methodName: "execute_lp", args: { deposit_id: depositId, plan }, gas: GAS.execute_lp, deposit: 0n,
});
export const registerPositionCall = (positionId: string): TxCall => ({
  receiverId: FUEL_ACCOUNT_ID, methodName: "register_position", args: { position_id: positionId }, gas: GAS.register_position, deposit: 0n,
});
export const claimCall = (positionId: string): TxCall => ({
  receiverId: FUEL_ACCOUNT_ID, methodName: "claim", args: { position_id: positionId }, gas: GAS.claim, deposit: 0n,
});
/** Permissionless; allowed from season end + grace + 60 s (contracts/fuel). 50 Tgas as in G2 C5. */
export const closeSeasonCall = (seasonId: number): TxCall => ({
  receiverId: FUEL_ACCOUNT_ID, methodName: "close_season", args: { season_id: seasonId }, gas: GAS.claim, deposit: 0n,
});
/** NEP-145 registration on FUEL, paying exactly storage_balance_bounds.min (read from the contract). */
export const fuelStorageCall = (accountId: string, minYocto: string): TxCall => ({
  receiverId: FUEL_ACCOUNT_ID, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true },
  gas: GAS.storage_deposit, deposit: BigInt(minYocto),
});

export type ActionKind = "execute_lp" | "register_position" | "claim" | "fuel_storage" | "close_season";
export type ActionVerdict = { ok: true; detail: string } | { ok: false; detail: string };

/** Success is decided by the event the contract emits, not by the wallet having signed. */
export function analyzeAction(kind: ActionKind, o: TxOutcome, sender: string): ActionVerdict {
  const p = parseOutcome(o);
  if (p.signer !== sender) return { ok: false, detail: `signed by ${p.signer}, expected ${sender}` };
  const firstFailure = p.failures[0]?.message;
  switch (kind) {
    case "execute_lp": {
      const lp = eventsFrom(p, TREASURY_ACCOUNT_ID, "lp_confirmed");
      if (lp.length) return { ok: true, detail: `LP confirmed: ${String(lp[0]!.shares)} shares (MFT, 24 decimals)` };
      return { ok: false, detail: firstFailure ? `stopped: ${firstFailure} (the deposit stays resumable)` : "no lp_confirmed event: check the deposit status" };
    }
    case "register_position": {
      const ok = eventsFrom(p, FUEL_ACCOUNT_ID, "position_admitted");
      if (ok.length) return { ok: true, detail: "position admitted into its season" };
      const rejected = eventsFrom(p, FUEL_ACCOUNT_ID, "position_rejected");
      return { ok: false, detail: rejected.length ? `rejected: ${String(rejected[0]!.reason)}` : firstFailure ?? "no position_admitted event" };
    }
    case "claim": {
      const c = eventsFrom(p, FUEL_ACCOUNT_ID, "reward_claimed");
      return c.length ? { ok: true, detail: `claimed ${String(c[0]!.amount)} (FUEL atomic, 18 decimals)` } : { ok: false, detail: firstFailure ?? "no reward_claimed event" };
    }
    case "close_season": {
      const c = eventsFrom(p, FUEL_ACCOUNT_ID, "season_closed");
      return c.length
        ? { ok: true, detail: `season ${String(c[0]!.season_id)} closed: ${String(c[0]!.status)} (progress ${String(c[0]!.progress_usdc)} / ${String(c[0]!.target_usdc)}, burned ${String(c[0]!.burned)}, level ${String(c[0]!.level)})` }
        : { ok: false, detail: firstFailure ?? "no season_closed event" };
    }
    case "fuel_storage":
      return p.ok && !firstFailure ? { ok: true, detail: "registered on FUEL" } : { ok: false, detail: firstFailure ?? "storage_deposit failed" };
  }
}
