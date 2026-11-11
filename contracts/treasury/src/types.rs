use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

/// Immutable parameters fixed in `new()`. There is no method to change them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    /// Only NEP-141 accepted as deposit (Tidepool test USDC, 6 decimals).
    pub usdc_token: AccountId,
    /// Second asset of the pool (Tidepool test wNEAR, 24 decimals).
    pub wnear_token: AccountId,
    /// Ref/Rhea exchange (testnet: ref-finance-101.testnet).
    pub ref_exchange: AccountId,
    /// Simple pool USDC/wNEAR created beforehand on the exchange.
    pub pool_id: u64,
    /// Deposits below this (atomic units) are refunded.
    pub min_deposit: U128,
    /// LP lock duration after confirmation, in nanoseconds (test value is short and declared as such).
    pub lp_lock_duration_ns: U64,
}

/// Lifecycle of one creator deposit. Every intermediate state is persisted so a failed
/// async step never marks funds as LP and can be resumed (`execute_lp`) or reconciled.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum DepositStatus {
    /// USDC credited to Treasury and split 90/8/2; LP budget still held by Treasury.
    BudgetAllocated,
    /// ft_transfer_call(Ref) in flight.
    AmmDepositPending,
    /// LP budget sits in Treasury's internal deposit on Ref.
    InRef { usdc: U128 },
    /// Partial swap USDC -> wNEAR in flight.
    SwapPending { usdc: U128 },
    /// Both legs sit in Treasury's Ref deposit, ready for add_liquidity.
    Swapped { usdc: U128, wnear: U128 },
    /// add_liquidity in flight.
    AddLiquidityPending { usdc: U128, wnear: U128 },
    /// add_liquidity returned `shares`; on-chain verification in flight.
    VerifyPending { usdc: U128, wnear: U128, shares: U128 },
    /// LP shares confirmed and held by Treasury on behalf of the creator (locked until `unlock_at`).
    LpConfirmed,
    /// mft_transfer of the shares to the creator in flight.
    LpWithdrawPending,
    /// Shares transferred to the creator.
    LpWithdrawn,
}

/// Execution parameters chosen by the creator (computed off-chain from Ref views:
/// get_pool / get_return / predict_add_simple_liquidity).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LpPlan {
    /// USDC (atomic) swapped to wNEAR before adding liquidity. Must be < USDC in Ref.
    pub swap_amount_in: U128,
    /// Slippage guard for the swap (wNEAR atomic). Must be > 0.
    pub min_swap_out: U128,
    /// Slippage guard for add_liquidity, in the pool's token order. Length 2.
    pub min_amounts: Vec<U128>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Deposit {
    pub id: U64,
    pub creator: AccountId,
    /// USDC actually credited by the token contract (atomic).
    pub amount: U128,
    pub lp_budget: U128,
    pub reserve: U128,
    pub community: U128,
    pub status: DepositStatus,
    pub plan: Option<LpPlan>,
    /// LP shares minted for this deposit, as returned by Ref add_liquidity.
    pub lp_shares: U128,
    /// true when Treasury's on-chain share balance covered the recorded shares after minting.
    pub lp_verified: bool,
    pub usdc_in_lp: U128,
    pub wnear_in_lp: U128,
    /// Leftovers of this deposit kept in Treasury's Ref deposit after add_liquidity.
    pub dust_usdc: U128,
    pub dust_wnear: U128,
    pub unlock_at: Option<U64>,
    /// Proof fields set once when the LP is confirmed (read by the FUEL contract).
    pub pool_id: Option<u64>,
    pub lp_confirmed_at: Option<U64>,
    pub lp_confirmed_block: Option<U64>,
    pub last_error: Option<String>,
    pub created_at: U64,
    pub updated_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct InFlight {
    pub deposit_id: U64,
    /// Timestamp of the last stage launch; also used as a nonce by `reconcile`.
    pub since: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Proof {
    pub block_height: U64,
    pub timestamp: U64,
    pub onchain_shares: U128,
    pub recorded_shares: U128,
    pub ok: bool,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub config: Config,
    pub lp_bps: u16,
    pub reserve_bps: u16,
    pub community_bps: u16,
    pub ready: bool,
    pub usdc_pool_index: u8,
}

#[near(serializers = [json])]
pub struct Accounting {
    pub total_received: U128,
    pub reserve_total: U128,
    pub community_total: U128,
    /// LP budgets still held by Treasury (BudgetAllocated / AmmDepositPending).
    pub pending_budget_total: U128,
    /// What Treasury expects in its Ref internal deposit (parked plans + dust).
    pub ref_expected_usdc: U128,
    pub ref_expected_wnear: U128,
    /// LP shares held for creators (LpConfirmed + LpWithdrawPending).
    pub recorded_shares: U128,
    pub deposits_count: U64,
}

/// Subset of Ref `get_pool` output.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PoolInfo {
    pub pool_kind: String,
    pub token_account_ids: Vec<AccountId>,
    pub amounts: Vec<U128>,
    pub total_fee: u32,
    pub shares_total_supply: U128,
}

/// Ref `swap` action.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SwapAction {
    pub pool_id: u64,
    pub token_in: AccountId,
    pub amount_in: Option<U128>,
    pub token_out: AccountId,
    pub min_amount_out: U128,
}

/// Expected `msg` of ft_transfer_call into Treasury: `{"action":"deposit"}`.
#[near(serializers = [json])]
pub struct DepositMsg {
    pub action: String,
}
