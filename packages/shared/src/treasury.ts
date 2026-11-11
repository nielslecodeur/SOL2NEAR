/** JSON shapes returned by the Treasury contract views (contracts/treasury). */

export type DepositStatus =
  | "BudgetAllocated"
  | "AmmDepositPending"
  | { InRef: { usdc: string } }
  | { SwapPending: { usdc: string } }
  | { Swapped: { usdc: string; wnear: string } }
  | { AddLiquidityPending: { usdc: string; wnear: string } }
  | { VerifyPending: { usdc: string; wnear: string; shares: string } }
  | "LpConfirmed"
  | "LpWithdrawPending"
  | "LpWithdrawn";

export interface LpPlan {
  swap_amount_in: string;
  min_swap_out: string;
  /** In the pool's token order. */
  min_amounts: [string, string];
}

export interface TreasuryDeposit {
  id: string;
  creator: string;
  amount: string;
  lp_budget: string;
  reserve: string;
  community: string;
  status: DepositStatus;
  plan: LpPlan | null;
  lp_shares: string;
  lp_verified: boolean;
  usdc_swapped: string;
  usdc_in_lp: string;
  wnear_in_lp: string;
  dust_usdc: string;
  dust_wnear: string;
  unlock_at: string | null;
  pool_id: number | null;
  lp_confirmed_at: string | null;
  lp_confirmed_block: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TreasuryAccounting {
  total_received: string;
  reserve_total: string;
  community_total: string;
  pending_budget_total: string;
  ref_expected_usdc: string;
  ref_expected_wnear: string;
  recorded_shares: string;
  deposits_count: string;
}

export interface TreasuryProof {
  block_height: string;
  timestamp: string;
  onchain_shares: string;
  recorded_shares: string;
  ok: boolean;
}

/** msg of ft_transfer_call(Treasury) — the only accepted form. */
export const TREASURY_DEPOSIT_MSG = JSON.stringify({ action: "deposit" });
