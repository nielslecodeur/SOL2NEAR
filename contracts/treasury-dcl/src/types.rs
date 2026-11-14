use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

/// The ONE Rhea DCL pool this TreasuryDCL can fund, and the only DCL routes it may use to buy the two
/// pool assets with USDC. Fixed in `new()`; no setter exists. Every field is re-checked on-chain in
/// `setup` (get_pool of the target and of every route pool, ft_metadata decimals, token tax views).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DclPoolConfig {
    /// Rhea DCL exchange (mainnet `dclv2.ref-labs.near`; this contract accepts testnet / local sandbox ids only).
    pub dex: AccountId,
    /// DCL pool id `token_x|token_y|fee`.
    pub pool_id: String,
    pub token_x: AccountId,
    pub token_y: AccountId,
    pub x_decimals: u8,
    pub y_decimals: u8,
    /// Fee tier in DCL units (10000 = 1 %).
    pub fee: u32,
    /// Point spacing of that fee tier (DCL `point_delta`, 200 for the 1 % tier).
    pub point_delta: i32,
    /// The only accepted deposit token (Tidepool test USDC on testnet).
    pub usdc_token: AccountId,
    pub usdc_decimals: u8,
    /// DCL pool ids from USDC to token_x / token_y (1..=3 hops each). The route is fixed: the frontend
    /// can choose amounts, never pools.
    pub route_x: Vec<String>,
    pub route_y: Vec<String>,
}

/// On-chain guards. A plan that does not respect them is refused by the contract, whatever the frontend computed.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DclGuards {
    /// Max distance between DCL's own `quote` (read at execution) and the plan's `min_*_out`, and between
    /// the planned and minimum liquidity amounts (x2).
    pub max_slippage_bps: u16,
    /// Max price impact of each acquisition swap, measured on-chain from two DCL quotes.
    pub max_price_impact_bps: u16,
    /// A plan's `deadline_ns` must be within this delay of the call that submits it.
    pub max_plan_ttl_ns: U64,
    /// Allowed width of the price range, in points (multiples of point_delta are enforced separately).
    pub min_range_width: i32,
    pub max_range_width: i32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    /// "testnet" (accounts `*.testnet`) or "sandbox" (local near-workspaces, `*.test.near`). Never mainnet.
    pub network: String,
    pub pool: DclPoolConfig,
    pub min_deposit: U128,
    /// Position lock after confirmation, in nanoseconds.
    pub lock_duration_ns: U64,
    pub guards: DclGuards,
}

/// One acquisition + position plan, prepared off-chain from live DCL views and re-checked on-chain.
/// A single USDC `ft_transfer_call` to the DCL carries a `HotZap`: two swaps (USDC→X, USDC→Y along the
/// fixed routes) then ONE `add_liquidity` from the swap outputs. Leftovers stay in Treasury's DCL account.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DclPlan {
    pub usdc_to_x: U128,
    pub usdc_to_y: U128,
    pub min_x_out: U128,
    pub min_y_out: U128,
    pub left_point: i32,
    pub right_point: i32,
    /// Amounts offered to add_liquidity. Must not exceed the swap minimums, so the zap can always pay them.
    pub amount_x: U128,
    pub amount_y: U128,
    pub min_amount_x: U128,
    pub min_amount_y: U128,
    pub deadline_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum DclStatus {
    /// USDC split 90/8/2; LP budget still in Treasury's USDC balance.
    BudgetAllocated,
    /// DCL get_pool + quotes in flight (nothing sent yet).
    PreflightPending,
    /// The HotZap `ft_transfer_call` is in flight. `sent` USDC left Treasury.
    ZapPending { sent: U128 },
    /// The zap used USDC; looking for the new position in DCL `list_liquidities`.
    LookupPending { used: U128 },
    /// Position found; reading its amounts and Treasury's DCL balances.
    ConfirmPending { used: U128 },
    /// The position exists, is owned by Treasury and is recorded for the creator.
    PositionConfirmed,
    /// remove_liquidity(amount 0) in flight (fee claim).
    FeeClaimPending,
    /// nft_transfer of the position to the creator in flight.
    TransferPending,
    /// The position NFT now belongs to the creator (verified with DCL get_liquidity).
    PositionWithdrawn,
    /// Aborted before any position existed. Funds went back to the reserve or are recoverable leftovers.
    Aborted,
}

/// Lifecycle bookkeeping of one deposit and its DCL position. Never reuses Classic `lp_shares`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DclDeposit {
    pub id: U64,
    pub creator: AccountId,
    pub amount: U128,
    pub lp_budget: U128,
    pub reserve: U128,
    pub community: U128,
    pub status: DclStatus,
    pub plan: Option<DclPlan>,
    pub dex: AccountId,
    pub pool_id: String,
    pub token_x: AccountId,
    pub token_y: AccountId,
    /// USDC actually consumed by the zap (DCL's ft_transfer_call result).
    pub usdc_used: U128,
    /// Budget that the plan did not use, returned to the creator's USDC reserve.
    pub usdc_unused_to_reserve: U128,
    /// The DCL position (NEP-171 token id = DCL lpt_id), recorded only after it was read back on-chain.
    pub lpt_id: Option<String>,
    pub left_point: Option<i32>,
    pub right_point: Option<i32>,
    /// DCL liquidity units of the position (`get_liquidity.amount`), as read at confirmation.
    pub liquidity: U128,
    /// Token amounts inside the position at confirmation (`get_liquidity_view.token_x/token_y`).
    pub position_x: U128,
    pub position_y: U128,
    /// Balances of THIS deposit inside Treasury's DCL account: zap leftovers + claimed fees.
    pub dex_x: U128,
    pub dex_y: U128,
    pub dex_usdc: U128,
    /// Fees actually claimed (remove_liquidity amount 0 return values), per asset. Never estimated.
    pub fees_claimed_x: U128,
    pub fees_claimed_y: U128,
    /// Moved from the DCL account to the creator's Treasury balance (verified by DCL get_user_asset).
    pub recovered_x: U128,
    pub recovered_y: U128,
    pub recovered_usdc: U128,
    pub unlock_at: Option<U64>,
    pub confirmed_block: Option<U64>,
    pub last_error: Option<String>,
    pub marks: Vec<StageMark>,
    pub created_at: U64,
    pub updated_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StageMark {
    pub stage: String,
    pub block: U64,
    pub at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Job {
    Lp,
    FeeClaim,
    Transfer,
    DexWithdraw { token: AccountId, amount: U128 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct InFlight {
    pub deposit_id: U64,
    pub job: Job,
    pub started_at: U64,
    pub updated_at: U64,
}

#[near(serializers = [json])]
pub struct DepositMsg {
    pub action: String,
}

/// DCL `get_pool` (fields used here).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DclPoolView {
    pub pool_id: String,
    pub token_x: AccountId,
    pub token_y: AccountId,
    pub fee: u32,
    pub point_delta: i32,
    pub current_point: i32,
    pub state: String,
    pub tax: Option<near_sdk::serde_json::Value>,
    pub liquidity: U128,
}

/// DCL `list_liquidities` / `get_liquidity` row.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DclLiquidityRow {
    pub lpt_id: String,
    pub owner_id: AccountId,
    pub pool_id: String,
    pub left_point: i32,
    pub right_point: i32,
    pub amount: U128,
    pub unclaimed_fee_x: Option<U128>,
    pub unclaimed_fee_y: Option<U128>,
}

/// DCL `get_liquidity_view` (fields used here).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DclLiquidityView {
    pub lpt_id: String,
    pub owner_id: AccountId,
    pub amount: U128,
    pub token_x: U128,
    pub token_y: U128,
}

/// DCL `quote`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DclQuote {
    pub amount: U128,
}
