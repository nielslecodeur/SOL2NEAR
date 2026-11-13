use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

/// The ONE Ref Classic pool this TreasuryV4 can fund. Fixed in `new()`; no setter exists.
/// Token ids, decimals and the pool kind are re-checked on-chain in `setup` (get_pool + ft_metadata).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PoolConfig {
    /// Ref/Rhea exchange (testnet: ref-finance-101.testnet).
    pub dex: AccountId,
    pub pool_id: u64,
    /// Only NEP-141 accepted as deposit (Tidepool test USDC, 6 decimals).
    pub usdc_token: AccountId,
    /// The memecoin side of the pool, bought from the LP budget inside the same pool.
    pub base_token: AccountId,
    pub usdc_decimals: u8,
    pub base_decimals: u8,
}

/// On-chain execution guards. A plan that does not respect them is refused by the contract,
/// whatever the frontend computed.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Guards {
    /// Max distance between Ref's own `get_return` (read at execution) and the plan's `min_swap_out`,
    /// and between the provided amounts and `min_amounts` of add_liquidity (x2, see lib.rs).
    pub max_slippage_bps: u16,
    /// Max price impact of the zap swap vs the pool's spot price, pool fee included, read at execution.
    pub max_price_impact_bps: u16,
    /// A plan's `deadline_ns` must be within this delay of the call that submits it.
    pub max_plan_ttl_ns: U64,
}

/// Immutable parameters fixed in `new()`. There is no method to change them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    /// "testnet" (accounts `*.testnet`) or "sandbox" (local near-workspaces, `*.test.near`). Never mainnet.
    pub network: String,
    pub pool: PoolConfig,
    /// Deposits below this (atomic units) are refunded.
    pub min_deposit: U128,
    /// LP lock duration after confirmation, in nanoseconds.
    pub lp_lock_duration_ns: U64,
    pub guards: Guards,
}

/// Lifecycle of one creator deposit. Every intermediate state is persisted so a failed
/// async step never marks funds as LP and can be resumed, aborted or reconciled.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum DepositStatus {
    /// USDC credited to Treasury and split 90/8/2; LP budget still held by Treasury.
    BudgetAllocated,
    /// ft_transfer_call(Ref) in flight.
    AmmDepositPending,
    /// LP budget sits in Treasury's internal deposit on Ref.
    InRef { usdc: U128 },
    /// get_pool + get_return in flight: on-chain price-impact and slippage check before the swap.
    PreSwapCheckPending { usdc: U128 },
    /// Partial swap USDC -> base in flight.
    SwapPending { usdc: U128 },
    /// Both legs sit in Treasury's Ref deposit, ready for add_liquidity.
    Swapped { usdc: U128, base: U128 },
    AddLiquidityPending { usdc: U128, base: U128 },
    VerifyPending { usdc: U128, base: U128, shares: U128 },
    /// LP shares confirmed and held by Treasury for the creator (locked until `unlock_at`).
    LpConfirmed,
    LpWithdrawPending,
    /// Shares transferred to the creator (mft_transfer on Ref).
    LpWithdrawn,
    /// Creator stopped the LP before it was added: the funds became leftovers / reserve.
    Aborted,
}

/// Execution parameters chosen by the creator (computed off-chain from Ref views). The contract
/// re-checks them against Ref at execution time (see Guards).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LpPlan {
    pub swap_amount_in: U128,
    pub min_swap_out: U128,
    /// add_liquidity guard, in the pool's token order. Length 2, both > 0.
    pub min_amounts: Vec<U128>,
    /// The plan is refused (or parked) after this block time.
    pub deadline_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StageMark {
    pub stage: String,
    pub block: U64,
    pub at: U64,
}

/// A creator position. Field names on the USDC side are the ones the FUEL contract reads today,
/// so a future, separately approved FUEL version could read V4 positions without a translation.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Deposit {
    pub id: U64,
    pub creator: AccountId,
    pub amount: U128,
    pub lp_budget: U128,
    pub reserve: U128,
    pub community: U128,
    pub status: DepositStatus,
    pub plan: Option<LpPlan>,
    pub lp_shares: U128,
    pub lp_verified: bool,
    /// USDC actually swapped to base (set when the swap is confirmed).
    pub usdc_swapped: U128,
    pub usdc_in_lp: U128,
    pub base_in_lp: U128,
    /// Leftovers of this deposit in Treasury's Ref deposit (recoverable with `withdraw_leftover`).
    pub dust_usdc: U128,
    pub dust_base: U128,
    /// Part of the LP budget returned to the creator's USDC reserve (partial Ref acceptance or abort).
    pub usdc_returned_to_reserve: U128,
    /// Leftovers already moved out of Ref to the creator's balances in this contract.
    pub usdc_recovered: U128,
    pub base_recovered: U128,
    pub unlock_at: Option<U64>,
    pub dex: AccountId,
    pub pool_id: Option<u64>,
    pub base_token: AccountId,
    pub lp_confirmed_at: Option<U64>,
    pub lp_confirmed_block: Option<U64>,
    pub last_error: Option<String>,
    /// Block of each stage change (tx hashes are not visible to a contract; an indexer pairs them).
    pub marks: Vec<StageMark>,
    pub created_at: U64,
    pub updated_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Job {
    Lp,
    Leftover { token: AccountId, amount: U128 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct InFlight {
    pub deposit_id: U64,
    pub since: U64,
    pub job: Job,
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

pub const FUEL_NOT_ELIGIBLE: &str = "FUEL_NOT_ELIGIBLE";
pub const FUEL_REASON: &str = "The deployed FUEL contract reads positions only from treasury.sol2near-dev.testnet and pool 2951 (immutable config). TreasuryV4 positions earn no FUEL until a separately approved FUEL version accepts them.";

#[near(serializers = [json])]
pub struct ConfigView {
    pub config: Config,
    pub lp_bps: u16,
    pub reserve_bps: u16,
    pub community_bps: u16,
    pub ready: bool,
    pub usdc_pool_index: u8,
    pub fuel: String,
}

#[near(serializers = [json])]
pub struct PositionView {
    pub deposit: Deposit,
    pub locked: bool,
    pub lp_withdrawable: bool,
    pub leftovers_recoverable: bool,
    pub fuel_status: String,
    pub fuel_reason: String,
}

#[near(serializers = [json])]
pub struct Accounting {
    pub total_received: U128,
    pub reserve_total: U128,
    pub community_total: U128,
    pub pending_budget_total: U128,
    pub ref_expected_usdc: U128,
    pub ref_expected_base: U128,
    /// Base token recovered from Ref and owed to creators (withdraw_base).
    pub base_balance_total: U128,
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

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SwapAction {
    pub pool_id: u64,
    pub token_in: AccountId,
    pub amount_in: Option<U128>,
    pub token_out: AccountId,
    pub min_amount_out: U128,
}

#[near(serializers = [json])]
pub struct DepositMsg {
    pub action: String,
}
