//! FUEL — fixed-supply NEP-141 memecoin + "Reactor" seasons, driven by Proof of Liquidity.
//!
//! - Supply: 1 000 000 FUEL minted once in `new()`; there is no mint method.
//! - A Treasury LP position earns FUEL only if, in one async round-trip, the Treasury says it is
//!   `LpConfirmed` + `lp_verified` on the configured pool with a long-enough lock, AND Ref itself
//!   reports that the Treasury holds at least all the shares it records (`get_pool_shares`).
//!   No caller-supplied amount, value or tx id is ever trusted.
//! - Seasons are calendar slots from `genesis_ns`. A position counts only for the season in which
//!   it was confirmed, once. Anyone can close an ended season: SUCCESS (target reached) makes the
//!   season's rewards claimable and levels the reactor up; FAILED releases them back to the
//!   reserve, levels down and burns at most `season_burn` (<= 10 FUEL) from the prefunded burn
//!   reserve — real `total_supply` reduction, never users' FUEL, LP, USDC or reserves.
//! - Payouts are internal ledger transfers inside this contract: synchronous, no failed-transfer
//!   state to reconcile; a claim either fully happens or reverts.

#[cfg(test)]
mod tests;

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};

pub const ONE_FUEL: u128 = 1_000_000_000_000_000_000; // 18 decimals
pub const TOTAL_SUPPLY: u128 = 1_000_000 * ONE_FUEL;
pub const POL_RESERVE: u128 = 600_000 * ONE_FUEL;
/// The 200 000 ecosystem allocation is split: 199 000 to the ecosystem account, 1 000 kept by
/// this contract as the reactor burn reserve (the only FUEL that can ever be burned by the protocol).
pub const ECOSYSTEM: u128 = 199_000 * ONE_FUEL;
pub const BURN_RESERVE: u128 = 1_000 * ONE_FUEL;
pub const LIQUIDITY: u128 = 150_000 * ONE_FUEL;
pub const TEAM: u128 = 50_000 * ONE_FUEL;
const _: () = assert!(POL_RESERVE + ECOSYSTEM + BURN_RESERVE + LIQUIDITY + TEAM == TOTAL_SUPPLY);

pub const MAX_BURN_PER_SEASON: u128 = 10 * ONE_FUEL;
pub const MAX_VAULT_CAP: u128 = 2_000 * ONE_FUEL;
pub const CAP_WINDOW_NS: u64 = 30 * 24 * 3600 * 1_000_000_000;
/// USDC (6 decimals) -> FUEL (18): 1 USDC of stablecoin actually in the LP = at most 1 FUEL.
const USDC_TO_FUEL: u128 = 1_000_000_000_000;
const CREATOR_SHARE_BPS: u128 = 8_000;
const BPS: u128 = 10_000;

/// After the registration window closes, in-flight proof callbacks (1-3 blocks) get this long to
/// land before `close_season` is allowed.
pub const SETTLE_NS: u64 = 60 * 1_000_000_000;
const TREASURY_LP_BPS: u128 = 9_000;
const TREASURY_RESERVE_BPS: u128 = 800;

const GAS_VIEW: Gas = Gas::from_tgas(5);
const GAS_PROOF_CB: Gas = Gas::from_tgas(30);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Positions,
    Seasons,
    VaultAwards,
}

/// Immutable launch parameters (no setter exists).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct ReactorConfig {
    pub treasury_id: AccountId,
    pub ref_exchange: AccountId,
    pub pool_id: u64,
    pub ecosystem_id: AccountId,
    pub liquidity_id: AccountId,
    pub team_id: AccountId,
    /// Start of season 0 (ns). Seasons are [genesis + k*duration, genesis + (k+1)*duration).
    pub genesis_ns: U64,
    pub season_duration_ns: U64,
    /// A position confirmed in season k may be *requested* for registration until end_k + grace.
    /// close_season(k) is allowed from end_k + grace + SETTLE_NS.
    pub registration_grace_ns: U64,
    /// USDC (atomic, 6 decimals) of newly confirmed LP needed for SUCCESS.
    pub season_target_usdc: U128,
    /// Max FUEL committed as rewards per season.
    pub season_reward_budget: U128,
    /// FUEL burned from the burn reserve when an activated season fails (<= 10 FUEL).
    pub season_burn: U128,
    /// Minimum Treasury lock (unlock_at - confirmed_at) for a position to be admissible.
    pub min_lock_ns: U64,
    /// Max FUEL per vault (creator) over any rolling 30 days (<= 2 000 FUEL).
    pub vault_cap: U128,
    /// Team allocation: nothing before genesis + cliff, linear from genesis to genesis + vesting.
    pub team_cliff_ns: U64,
    pub team_vesting_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum SeasonStatus {
    Open,
    Success,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Season {
    pub id: u64,
    pub start: U64,
    pub end: U64,
    pub target_usdc: U128,
    pub progress_usdc: U128,
    pub positions: u32,
    pub committed_creator: U128,
    pub committed_community: U128,
    pub status: SeasonStatus,
    pub burned: U128,
    pub level_after: Option<u32>,
    pub closed_at: Option<U64>,
}

/// Snapshot of a Treasury LP position taken when it was admitted.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Position {
    /// = Treasury deposit id.
    pub position_id: U64,
    pub creator_id: AccountId,
    /// One vault per creator in the Treasury.
    pub vault_id: AccountId,
    pub pool_id: u64,
    pub usdc_in_lp: U128,
    pub wnear_in_lp: U128,
    pub lp_shares: U128,
    pub confirmed_at: U64,
    pub confirmed_block: U64,
    pub unlock_at: U64,
    pub season_id: u64,
    pub reward_total: U128,
    pub creator_reward: U128,
    pub community_reward: U128,
    pub claimed: bool,
    pub registered_at: U64,
    /// Proof read from Ref / Treasury at admission.
    pub ref_treasury_shares: U128,
    pub treasury_recorded_shares: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub enum RewardStatus {
    /// Season still open: reward committed, not yet earned.
    Pending,
    /// Season succeeded but the LP lock is still running.
    Locked,
    Claimable,
    Claimed,
    /// Season failed: commitment returned to the reserve.
    Forfeited,
    /// Admitted for progress, but cap / budget / reserve left nothing to reward.
    NoReward,
}

#[near(serializers = [json])]
pub struct PositionView {
    pub position: Position,
    pub reward_status: RewardStatus,
}

#[near(serializers = [json])]
pub struct Buckets {
    pub total_supply: U128,
    pub contract_balance: U128,
    pub pol_available: U128,
    pub pol_committed: U128,
    pub pol_distributed: U128,
    pub community_reserve: U128,
    pub burn_reserve: U128,
    pub burned_total: U128,
    pub team_locked: U128,
    pub team_released: U128,
}

#[near(serializers = [json])]
pub struct ReactorView {
    pub level: u32,
    pub now: U64,
    pub current_season_id: u64,
    /// Stored record, or an empty open season if nobody contributed yet.
    pub current_season: Season,
    pub seasons_touched: Vec<u64>,
    pub buckets: Buckets,
    pub config: ReactorConfig,
}

/// Subset of the Treasury `get_deposit` JSON.
#[near(serializers = [json])]
pub struct TreasuryDeposit {
    pub id: U64,
    pub creator: AccountId,
    /// USDC credited by the token contract, and its 90/8/2 split (re-checked here).
    pub amount: U128,
    pub lp_budget: U128,
    pub reserve: U128,
    pub community: U128,
    pub usdc_swapped: U128,
    pub dust_usdc: U128,
    pub status: Value,
    pub lp_shares: U128,
    pub lp_verified: bool,
    pub usdc_in_lp: U128,
    pub wnear_in_lp: U128,
    pub unlock_at: Option<U64>,
    pub pool_id: Option<u64>,
    pub lp_confirmed_at: Option<U64>,
    pub lp_confirmed_block: Option<U64>,
}

/// Subset of the Treasury `get_accounting` JSON.
#[near(serializers = [json])]
pub struct TreasuryAccounting {
    pub recorded_shares: U128,
}

#[allow(dead_code)]
#[ext_contract(ext_treasury)]
trait Treasury {
    fn get_deposit(&self, deposit_id: U64) -> Option<TreasuryDeposit>;
    fn get_accounting(&self) -> TreasuryAccounting;
}

#[allow(dead_code)]
#[ext_contract(ext_ref)]
trait RefExchange {
    fn get_pool_shares(&self, pool_id: u64, account_id: AccountId) -> U128;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Fuel {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
    config: ReactorConfig,
    positions: LookupMap<u64, Position>,
    seasons: LookupMap<u64, Season>,
    seasons_touched: Vec<u64>,
    vault_awards: LookupMap<AccountId, Vec<(u64, u128)>>,
    level: u32,
    pol_available: u128,
    pol_committed: u128,
    pol_distributed: u128,
    community_reserve: u128,
    burn_reserve: u128,
    burned_total: u128,
    team_released: u128,
}

#[near]
impl Fuel {
    #[init]
    pub fn new(config: ReactorConfig) -> Self {
        let me = env::current_account_id();
        let c = &config;
        require!(c.season_duration_ns.0 >= 60_000_000_000, "ERR_SEASON_TOO_SHORT");
        require!(c.registration_grace_ns.0 <= c.season_duration_ns.0, "ERR_GRACE_GT_SEASON");
        require!(c.season_target_usdc.0 > 0, "ERR_TARGET_ZERO");
        require!(c.season_reward_budget.0 <= POL_RESERVE, "ERR_BUDGET_GT_RESERVE");
        require!(c.season_burn.0 <= MAX_BURN_PER_SEASON, "ERR_BURN_GT_10_FUEL");
        require!(c.vault_cap.0 > 0 && c.vault_cap.0 <= MAX_VAULT_CAP, "ERR_VAULT_CAP");
        require!(
            c.team_vesting_ns.0 > 0 && c.team_vesting_ns.0 >= c.team_cliff_ns.0,
            "ERR_VESTING"
        );
        for a in [&c.ecosystem_id, &c.liquidity_id, &c.team_id, &c.treasury_id] {
            require!(*a != me, "ERR_ALLOCATION_TO_SELF");
        }

        let mut token = FungibleToken::new(StorageKey::Token);
        let allocations = [
            (me.clone(), POL_RESERVE + BURN_RESERVE + TEAM, "pol_reserve+burn_reserve+team_vesting"),
            (c.ecosystem_id.clone(), ECOSYSTEM, "ecosystem"),
            (c.liquidity_id.clone(), LIQUIDITY, "liquidity_provisioning"),
        ];
        for (account, amount, memo) in &allocations {
            if !token.accounts.contains_key(account) {
                token.internal_register_account(account);
            }
            token.internal_deposit(account, *amount);
            FtMint { owner_id: account, amount: U128(*amount), memo: Some(memo) }.emit();
        }
        if !token.accounts.contains_key(&c.team_id) {
            token.internal_register_account(&c.team_id);
        }
        require!(token.ft_total_supply().0 == TOTAL_SUPPLY, "ERR_SUPPLY");

        Self {
            token,
            metadata: FungibleTokenMetadata {
                spec: FT_METADATA_SPEC.to_string(),
                name: "FUEL (SOL2NEAR testnet)".to_string(),
                symbol: "FUEL".to_string(),
                icon: None,
                reference: None,
                reference_hash: None,
                decimals: 18,
            },
            config,
            positions: LookupMap::new(StorageKey::Positions),
            seasons: LookupMap::new(StorageKey::Seasons),
            seasons_touched: Vec::new(),
            vault_awards: LookupMap::new(StorageKey::VaultAwards),
            level: 0,
            pol_available: POL_RESERVE,
            pol_committed: 0,
            pol_distributed: 0,
            community_reserve: 0,
            burn_reserve: BURN_RESERVE,
            burned_total: 0,
            team_released: 0,
        }
    }

    // ======================= Proof of Liquidity =======================

    /// Permissionless: reads the position from the Treasury and Treasury's real share balance
    /// from Ref, then admits it into the season of its confirmation. Rewards always go to the
    /// Treasury-recorded creator, never to the caller. Attach >= 60 Tgas.
    pub fn register_position(&mut self, position_id: U64) -> Promise {
        require!(!self.positions.contains_key(&position_id.0), "ERR_ALREADY_REGISTERED");
        let c = &self.config;
        ext_treasury::ext(c.treasury_id.clone())
            .with_static_gas(GAS_VIEW)
            .get_deposit(position_id)
            .and(ext_treasury::ext(c.treasury_id.clone()).with_static_gas(GAS_VIEW).get_accounting())
            .and(
                ext_ref::ext(c.ref_exchange.clone())
                    .with_static_gas(GAS_VIEW)
                    .get_pool_shares(c.pool_id, c.treasury_id.clone()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_PROOF_CB)
                    .on_position_proof(position_id, U64(env::block_timestamp())),
            )
    }

    /// `requested_at` is the block time of `register_position`, set by this contract itself.
    #[private]
    pub fn on_position_proof(
        &mut self,
        position_id: U64,
        requested_at: U64,
        #[callback_result] deposit: Result<Option<TreasuryDeposit>, PromiseError>,
        #[callback_result] accounting: Result<TreasuryAccounting, PromiseError>,
        #[callback_result] ref_shares: Result<U128, PromiseError>,
    ) -> bool {
        // Same check as #[private], kept explicit because this callback is the trust boundary.
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE_CALLBACK");
        let result = match (deposit, accounting, ref_shares) {
            (Ok(d), Ok(a), Ok(s)) => self.admit(position_id.0, requested_at.0, d, a.recorded_shares.0, s.0),
            _ => Err("ERR_PROOF_VIEW_FAILED"),
        };
        match result {
            Ok(p) => {
                emit("position_admitted", json!({
                    "position_id": p.position_id, "creator_id": p.creator_id, "season_id": p.season_id,
                    "usdc_in_lp": p.usdc_in_lp, "lp_shares": p.lp_shares, "reward_total": p.reward_total,
                    "creator_reward": p.creator_reward, "community_reward": p.community_reward,
                    "ref_treasury_shares": p.ref_treasury_shares, "treasury_recorded_shares": p.treasury_recorded_shares,
                    "confirmed_block": p.confirmed_block,
                }));
                true
            }
            Err(reason) => {
                emit("position_rejected", json!({ "position_id": position_id, "reason": reason }));
                false
            }
        }
    }

    // ======================= seasons =======================

    /// Anyone, once the season has ended. Idempotent: a closed season cannot be closed again,
    /// so a burn happens at most once per season. Untouched (empty) seasons have no record and
    /// cannot be closed, so empty seasons can never trigger burns.
    pub fn close_season(&mut self, season_id: u64) -> Season {
        let mut s = self.seasons.get(&season_id).cloned().unwrap_or_else(|| env::panic_str("ERR_SEASON_EMPTY"));
        require!(s.status == SeasonStatus::Open, "ERR_ALREADY_CLOSED");
        require!(env::block_timestamp() >= s.end.0, "ERR_SEASON_NOT_ENDED");
        require!(
            env::block_timestamp() >= s.end.0 + self.config.registration_grace_ns.0 + SETTLE_NS,
            "ERR_REGISTRATION_WINDOW_NOT_SETTLED"
        );

        let committed = s.committed_creator.0 + s.committed_community.0;
        if s.progress_usdc.0 >= s.target_usdc.0 {
            s.status = SeasonStatus::Success;
            self.level += 1;
            self.pol_committed -= s.committed_community.0;
            self.community_reserve += s.committed_community.0;
        } else {
            s.status = SeasonStatus::Failed;
            self.level = self.level.saturating_sub(1);
            self.pol_committed -= committed;
            self.pol_available += committed;
            let burn = self.config.season_burn.0.min(self.burn_reserve);
            if burn > 0 {
                let me = env::current_account_id();
                self.token.internal_withdraw(&me, burn);
                self.burn_reserve -= burn;
                self.burned_total += burn;
                s.burned = U128(burn);
                FtBurn { owner_id: &me, amount: U128(burn), memo: Some("reactor season failed") }.emit();
            }
        }
        s.level_after = Some(self.level);
        s.closed_at = Some(U64(env::block_timestamp()));
        self.seasons.insert(season_id, s.clone());
        emit("season_closed", json!({
            "season_id": season_id, "status": s.status, "progress_usdc": s.progress_usdc,
            "target_usdc": s.target_usdc, "burned": s.burned, "level": self.level,
        }));
        s
    }

    /// Pays the creator's 80 % once the season succeeded and the LP lock is over. Anyone can
    /// trigger it; the FUEL always goes to the position's creator. Second call fails.
    pub fn claim(&mut self, position_id: U64) -> U128 {
        let mut p = self.positions.get(&position_id.0).cloned().unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_POSITION"));
        require!(!p.claimed, "ERR_ALREADY_CLAIMED");
        let mut s = self.seasons.get(&p.season_id).cloned().expect("season");
        match s.status {
            SeasonStatus::Open => env::panic_str("ERR_SEASON_NOT_CLOSED"),
            SeasonStatus::Failed => env::panic_str("ERR_REWARD_FORFEITED"),
            SeasonStatus::Success => {}
        }
        require!(env::block_timestamp() >= p.unlock_at.0, "ERR_LP_STILL_LOCKED");
        let amount = p.creator_reward.0;
        require!(amount > 0, "ERR_NO_REWARD");
        require!(self.token.accounts.contains_key(&p.creator_id), "ERR_CREATOR_NOT_REGISTERED");

        p.claimed = true;
        s.committed_creator = U128(s.committed_creator.0 - amount);
        self.pol_committed -= amount;
        self.pol_distributed += amount;
        self.token.internal_transfer(&env::current_account_id(), &p.creator_id, amount, Some("FUEL proof-of-liquidity reward".into()));
        emit("reward_claimed", json!({ "position_id": position_id, "creator_id": p.creator_id, "amount": U128(amount) }));
        self.positions.insert(position_id.0, p);
        self.seasons.insert(s.id, s);
        U128(amount)
    }

    /// Releases the vested part of the 50 000 team FUEL to `team_id`. Anyone can trigger it.
    pub fn release_team(&mut self) -> U128 {
        let amount = self.team_vested(env::block_timestamp()) - self.team_released;
        require!(amount > 0, "ERR_NOTHING_VESTED");
        self.team_released += amount;
        self.token.internal_transfer(&env::current_account_id(), &self.config.team_id.clone(), amount, Some("team vesting".into()));
        emit("team_released", json!({ "amount": U128(amount), "total_released": U128(self.team_released) }));
        U128(amount)
    }

    // ======================= views =======================

    pub fn get_reactor(&self) -> ReactorView {
        let now = env::block_timestamp();
        let id = self.season_of(now).unwrap_or(0);
        ReactorView {
            level: self.level,
            now: U64(now),
            current_season_id: id,
            current_season: self.seasons.get(&id).cloned().unwrap_or_else(|| self.empty_season(id)),
            seasons_touched: self.seasons_touched.clone(),
            buckets: self.get_buckets(),
            config: self.config.clone(),
        }
    }

    pub fn get_season(&self, season_id: u64) -> Option<Season> {
        self.seasons.get(&season_id).cloned()
    }

    pub fn get_position(&self, position_id: U64) -> Option<PositionView> {
        let p = self.positions.get(&position_id.0)?.clone();
        let s = self.seasons.get(&p.season_id).expect("season");
        let reward_status = if p.claimed {
            RewardStatus::Claimed
        } else if p.reward_total.0 == 0 {
            RewardStatus::NoReward
        } else {
            match s.status {
                SeasonStatus::Open => RewardStatus::Pending,
                SeasonStatus::Failed => RewardStatus::Forfeited,
                SeasonStatus::Success if env::block_timestamp() < p.unlock_at.0 => RewardStatus::Locked,
                SeasonStatus::Success => RewardStatus::Claimable,
            }
        };
        Some(PositionView { position: p, reward_status })
    }

    pub fn get_buckets(&self) -> Buckets {
        Buckets {
            total_supply: self.token.ft_total_supply(),
            contract_balance: self.token.ft_balance_of(env::current_account_id()),
            pol_available: U128(self.pol_available),
            pol_committed: U128(self.pol_committed),
            pol_distributed: U128(self.pol_distributed),
            community_reserve: U128(self.community_reserve),
            burn_reserve: U128(self.burn_reserve),
            burned_total: U128(self.burned_total),
            team_locked: U128(TEAM - self.team_released),
            team_released: U128(self.team_released),
        }
    }

    /// FUEL a vault can still receive right now under the rolling 30-day cap.
    pub fn get_vault_cap_left(&self, vault_id: AccountId) -> U128 {
        U128(self.vault_cap_left(&vault_id, env::block_timestamp()))
    }
}

// ======================= internals =======================

impl Fuel {
    fn admit(
        &mut self,
        id: u64,
        requested_at: u64,
        deposit: Option<TreasuryDeposit>,
        treasury_recorded_shares: u128,
        ref_treasury_shares: u128,
    ) -> Result<Position, &'static str> {
        let d = deposit.ok_or("ERR_UNKNOWN_POSITION")?;
        if self.positions.contains_key(&id) {
            return Err("ERR_ALREADY_REGISTERED");
        }
        if d.id.0 != id {
            return Err("ERR_ID_MISMATCH");
        }
        if d.status != Value::String("LpConfirmed".into()) {
            return Err("ERR_LP_NOT_CONFIRMED");
        }
        if !d.lp_verified {
            return Err("ERR_LP_UNVERIFIED");
        }
        if d.pool_id != Some(self.config.pool_id) {
            return Err("ERR_WRONG_POOL");
        }
        if d.lp_shares.0 == 0 || d.usdc_in_lp.0 == 0 {
            return Err("ERR_EMPTY_POSITION");
        }
        // Re-check the Treasury's books instead of trusting them: 90/8/2 of the credited amount,
        // then every USDC of the LP budget accounted for (swapped + in the pool + dust left on Ref).
        let a = d.amount.0;
        if d.lp_budget.0 != a * TREASURY_LP_BPS / BPS
            || d.reserve.0 != a * TREASURY_RESERVE_BPS / BPS
            || d.lp_budget.0 + d.reserve.0 + d.community.0 != a
        {
            return Err("ERR_SPLIT_MISMATCH");
        }
        if d.usdc_swapped.0 + d.usdc_in_lp.0 + d.dust_usdc.0 != d.lp_budget.0 {
            return Err("ERR_USDC_RECONCILIATION");
        }
        // Proof from the DEX itself: Treasury really holds every share it claims to hold.
        if ref_treasury_shares < treasury_recorded_shares || ref_treasury_shares < d.lp_shares.0 {
            return Err("ERR_SHARES_NOT_BACKED_ON_REF");
        }
        let (confirmed_at, unlock_at, block) = match (d.lp_confirmed_at, d.unlock_at, d.lp_confirmed_block) {
            (Some(c), Some(u), Some(b)) => (c.0, u.0, b.0),
            _ => return Err("ERR_MISSING_PROOF_FIELDS"),
        };
        if unlock_at.saturating_sub(confirmed_at) < self.config.min_lock_ns.0 {
            return Err("ERR_LOCK_TOO_SHORT");
        }
        let season_id = self.season_of(confirmed_at).ok_or("ERR_BEFORE_GENESIS")?;
        let mut season = self.seasons.get(&season_id).cloned().unwrap_or_else(|| self.empty_season(season_id));
        if requested_at >= season.end.0 + self.config.registration_grace_ns.0 {
            return Err("ERR_REGISTRATION_WINDOW_CLOSED");
        }
        // Only reachable if a callback took longer than SETTLE_NS: refused, never retroactive.
        if season.status != SeasonStatus::Open {
            return Err("ERR_SEASON_CLOSED");
        }

        let now = env::block_timestamp();
        let budget_left = self.config.season_reward_budget.0
            - (season.committed_creator.0 + season.committed_community.0);
        let reward = (d.usdc_in_lp.0 * USDC_TO_FUEL)
            .min(self.vault_cap_left(&d.creator, now))
            .min(budget_left)
            .min(self.pol_available);
        let creator_reward = reward * CREATOR_SHARE_BPS / BPS;
        let community_reward = reward - creator_reward;

        self.pol_available -= reward;
        self.pol_committed += reward;
        season.progress_usdc = U128(season.progress_usdc.0 + d.usdc_in_lp.0);
        season.positions += 1;
        season.committed_creator = U128(season.committed_creator.0 + creator_reward);
        season.committed_community = U128(season.committed_community.0 + community_reward);
        if !self.seasons.contains_key(&season_id) {
            self.seasons_touched.push(season_id);
        }
        self.seasons.insert(season_id, season);
        if reward > 0 {
            // shortcut: per-vault Vec pruned on write, fine for a demo; index by time if a vault gets thousands of awards
            let awards = self.vault_awards.entry(d.creator.clone()).or_default();
            awards.retain(|(t, _)| t + CAP_WINDOW_NS > now);
            awards.push((now, reward));
        }

        let p = Position {
            position_id: U64(id),
            creator_id: d.creator.clone(),
            vault_id: d.creator,
            pool_id: self.config.pool_id,
            usdc_in_lp: d.usdc_in_lp,
            wnear_in_lp: d.wnear_in_lp,
            lp_shares: d.lp_shares,
            confirmed_at: U64(confirmed_at),
            confirmed_block: U64(block),
            unlock_at: U64(unlock_at),
            season_id,
            reward_total: U128(reward),
            creator_reward: U128(creator_reward),
            community_reward: U128(community_reward),
            claimed: false,
            registered_at: U64(now),
            ref_treasury_shares: U128(ref_treasury_shares),
            treasury_recorded_shares: U128(treasury_recorded_shares),
        };
        self.positions.insert(id, p.clone());
        Ok(p)
    }

    fn season_of(&self, t: u64) -> Option<u64> {
        let g = self.config.genesis_ns.0;
        (t >= g).then(|| (t - g) / self.config.season_duration_ns.0)
    }

    fn empty_season(&self, id: u64) -> Season {
        let start = self.config.genesis_ns.0 + id * self.config.season_duration_ns.0;
        Season {
            id,
            start: U64(start),
            end: U64(start + self.config.season_duration_ns.0),
            target_usdc: self.config.season_target_usdc,
            progress_usdc: U128(0),
            positions: 0,
            committed_creator: U128(0),
            committed_community: U128(0),
            status: SeasonStatus::Open,
            burned: U128(0),
            level_after: None,
            closed_at: None,
        }
    }

    fn vault_cap_left(&self, vault: &AccountId, now: u64) -> u128 {
        let used: u128 = self
            .vault_awards
            .get(vault)
            .map(|v| v.iter().filter(|(t, _)| t + CAP_WINDOW_NS > now).map(|(_, a)| a).sum())
            .unwrap_or(0);
        self.config.vault_cap.0.saturating_sub(used)
    }

    fn team_vested(&self, now: u64) -> u128 {
        let g = self.config.genesis_ns.0;
        if now < g + self.config.team_cliff_ns.0 {
            return 0;
        }
        let elapsed = (now - g).min(self.config.team_vesting_ns.0) as u128;
        TEAM * elapsed / self.config.team_vesting_ns.0 as u128
    }
}

fn emit(event: &str, data: Value) {
    let payload = json!({ "standard": "sol2near", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

// ======================= NEP-141 / NEP-145 / metadata =======================

#[near]
impl FungibleTokenCore for Fuel {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Fuel {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Fuel {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// `force` is ignored: unregistering never burns a holder's FUEL (the standard's force
    /// path would). An account with a balance must transfer it out first.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let _ = force;
        self.token.internal_storage_unregister(Some(false)).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Fuel {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}
