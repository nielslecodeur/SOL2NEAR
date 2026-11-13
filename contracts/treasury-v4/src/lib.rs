//! SOL2NEAR TreasuryV4 — V4.1 Classic memecoin pilot. NOT DEPLOYED.
//!
//! Separate contract, separate account. The deployed V3 Treasury (`treasury.sol2near-dev.testnet`,
//! pool 2951) and FUEL are untouched; this crate is a fork of `contracts/treasury` with:
//! - one Ref Classic pool fixed in `new()`, validated on-chain in `setup` (kind, exact token ids
//!   AND `ft_metadata` decimals of both tokens), network guard (testnet / local sandbox only);
//! - on-chain execution guards: plan deadline, price impact and slippage checked against Ref's
//!   own `get_pool` + `get_return` right before the swap, add_liquidity guards bounded;
//! - leftover recovery (`abort_lp`, `withdraw_leftover`, `withdraw_base`) verified from Ref's
//!   balances, and an exit (`withdraw_lp`) followed by a fresh Proof of Liquidity;
//! - positions marked FUEL_NOT_ELIGIBLE (the deployed FUEL reads only the V3 Treasury).
//!
//! Async safety (unchanged from V3): one job at a time (`in_flight`), every stage persisted,
//! `#[private]` callbacks that check the expected stage (replays are no-ops), failures never mark
//! funds as LP, and `reconcile` re-derives a stuck stage from Ref balances.

mod events;
mod external;
mod ledger;
mod types;

#[cfg(test)]
mod tests;

use external::{ext_ft, ext_ref};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};
use std::collections::HashMap;
pub use types::*;

// ---------- gas budget (Tgas) ----------
const T_FT_TRANSFER: u64 = 15;
const T_FT_TRANSFER_CALL: u64 = 50;
const T_STORAGE: u64 = 10;
const T_REF_REGISTER: u64 = 10;
const T_REF_SWAP: u64 = 20;
const T_REF_ADD_LIQ: u64 = 25;
const T_REF_MFT_TRANSFER: u64 = 15;
const T_REF_WITHDRAW: u64 = 40;
const T_VIEW: u64 = 5;
const T_CB: u64 = 10;
const T_VERIFY_TOTAL: u64 = 2 * T_VIEW + T_CB;
const T_ADD_TOTAL: u64 = T_REF_ADD_LIQ + T_CB + T_VERIFY_TOTAL;
const T_SWAP_TOTAL: u64 = T_REF_SWAP + T_CB + T_ADD_TOTAL;
const T_PRECHECK_TOTAL: u64 = 2 * T_VIEW + T_CB + T_SWAP_TOTAL;
const T_DEPOSIT_TOTAL: u64 = T_FT_TRANSFER_CALL + T_CB + T_PRECHECK_TOTAL;
const T_SETUP_DONE: u64 = T_CB;
const T_SETUP_STORAGE_CB: u64 = T_CB + T_REF_REGISTER + 3 * T_VIEW + T_SETUP_DONE;
const T_SELF: u64 = 15;

const fn tgas(t: u64) -> Gas {
    Gas::from_tgas(t)
}

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const FT_STORAGE: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
const REF_STORAGE: NearToken = NearToken::from_millinear(100);
const ADD_LIQ_DEPOSIT: NearToken = NearToken::from_millinear(5);
pub const SETUP_DEPOSIT: NearToken =
    NearToken::from_yoctonear(REF_STORAGE.as_yoctonear() + 4 * FT_STORAGE.as_yoctonear());

pub const RECONCILE_TIMEOUT_NS: u64 = 10 * 60 * 1_000_000_000;
/// Hard ceilings on the guards themselves, so a deployment cannot switch them off.
pub const MAX_SLIPPAGE_CEILING_BPS: u16 = 500;
pub const MAX_IMPACT_CEILING_BPS: u16 = 2_000;
pub const MAX_PLAN_TTL_CEILING_NS: u64 = 60 * 60 * 1_000_000_000;
const BPS: u128 = 10_000;
const MAX_MARKS: usize = 24;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Deposits,
    CreatorDeposits,
    Reserves,
    BaseBalances,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TreasuryV4 {
    config: Config,
    ready: bool,
    usdc_pool_index: u8,
    next_deposit_id: u64,
    deposits: LookupMap<u64, Deposit>,
    creator_deposits: LookupMap<AccountId, Vec<u64>>,
    reserves: LookupMap<AccountId, u128>,
    base_balances: LookupMap<AccountId, u128>,
    total_received: u128,
    reserve_total: u128,
    community_total: u128,
    pending_budget_total: u128,
    ref_expected_usdc: u128,
    ref_expected_base: u128,
    base_balance_total: u128,
    recorded_shares: u128,
    in_flight: Option<InFlight>,
    last_proof: Option<Proof>,
}

fn network_suffix(network: &str) -> &'static str {
    match network {
        "testnet" => ".testnet",
        "sandbox" => ".test.near",
        _ => env::panic_str("ERR_NETWORK: testnet or sandbox only"),
    }
}

#[near]
impl TreasuryV4 {
    #[init]
    pub fn new(network: String, pool: PoolConfig, min_deposit: U128, lp_lock_duration_ns: U64, guards: Guards) -> Self {
        let sfx = network_suffix(&network);
        for a in [&env::current_account_id(), &pool.dex, &pool.usdc_token, &pool.base_token] {
            require!(a.as_str().ends_with(sfx), format!("ERR_NETWORK_ACCOUNT: {a} is not a {network} account"));
        }
        require!(pool.usdc_token != pool.base_token, "ERR_SAME_TOKENS");
        require!(pool.usdc_decimals <= 24 && pool.base_decimals <= 24, "ERR_DECIMALS");
        require!(min_deposit.0 > 0, "ERR_MIN_DEPOSIT_ZERO");
        require!(guards.max_slippage_bps > 0 && guards.max_slippage_bps <= MAX_SLIPPAGE_CEILING_BPS, "ERR_GUARD_SLIPPAGE");
        require!(guards.max_price_impact_bps > 0 && guards.max_price_impact_bps <= MAX_IMPACT_CEILING_BPS, "ERR_GUARD_IMPACT");
        require!(guards.max_plan_ttl_ns.0 > 0 && guards.max_plan_ttl_ns.0 <= MAX_PLAN_TTL_CEILING_NS, "ERR_GUARD_TTL");
        Self {
            config: Config { network, pool, min_deposit, lp_lock_duration_ns, guards },
            ready: false,
            usdc_pool_index: 0,
            next_deposit_id: 0,
            deposits: LookupMap::new(StorageKey::Deposits),
            creator_deposits: LookupMap::new(StorageKey::CreatorDeposits),
            reserves: LookupMap::new(StorageKey::Reserves),
            base_balances: LookupMap::new(StorageKey::BaseBalances),
            total_received: 0,
            reserve_total: 0,
            community_total: 0,
            pending_budget_total: 0,
            ref_expected_usdc: 0,
            ref_expected_base: 0,
            base_balance_total: 0,
            recorded_shares: 0,
            in_flight: None,
            last_proof: None,
        }
    }

    // ======================= setup (permissionless, idempotent) =======================

    #[payable]
    pub fn setup(&mut self) -> Promise {
        require!(
            env::attached_deposit() >= SETUP_DEPOSIT,
            format!("ERR_SETUP_DEPOSIT: attach {} yocto", SETUP_DEPOSIT.as_yoctonear())
        );
        let me = env::current_account_id();
        let p = &self.config.pool;
        ext_ref::ext(p.dex.clone())
            .with_attached_deposit(REF_STORAGE)
            .with_static_gas(tgas(T_STORAGE))
            .storage_deposit(Some(me.clone()), Some(false))
            .and(ft_storage(&p.usdc_token, &me))
            .and(ft_storage(&p.base_token, &me))
            .and(ft_storage(&p.usdc_token, &p.dex))
            .and(ft_storage(&p.base_token, &p.dex))
            .then(Self::ext(me).with_static_gas(tgas(T_SETUP_STORAGE_CB)).on_setup_storage())
    }

    #[private]
    pub fn on_setup_storage(&mut self) -> PromiseOrValue<bool> {
        let n = env::promise_results_count();
        let failed: Vec<u64> = (0..n).filter(|i| promise_bytes(*i).is_none()).collect();
        if !failed.is_empty() {
            events::emit("setup_failed", json!({ "stage": "storage", "failed_indexes": failed }));
            return PromiseOrValue::Value(false);
        }
        let p = &self.config.pool;
        PromiseOrValue::Promise(
            ext_ref::ext(p.dex.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(T_REF_REGISTER))
                .register_tokens(vec![p.usdc_token.clone(), p.base_token.clone()])
                .and(ext_ref::ext(p.dex.clone()).with_static_gas(tgas(T_VIEW)).get_pool(p.pool_id))
                .and(ext_ft::ext(p.usdc_token.clone()).with_static_gas(tgas(T_VIEW)).ft_metadata())
                .and(ext_ft::ext(p.base_token.clone()).with_static_gas(tgas(T_VIEW)).ft_metadata())
                .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_SETUP_DONE)).on_setup_done()),
        )
    }

    /// Ready only if Ref accepted the tokens, the pool is the configured SIMPLE_POOL with exactly
    /// the configured token ids, and both tokens report the configured decimals.
    #[private]
    pub fn on_setup_done(&mut self) -> bool {
        if promise_bytes(0).is_none() {
            events::emit("setup_failed", json!({ "stage": "register_tokens" }));
            return false;
        }
        let pool: Option<PoolInfo> = promise_bytes(1).and_then(|b| serde_json::from_slice(&b).ok());
        let dec = |i: u64| -> Option<u64> {
            promise_bytes(i).and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| v["decimals"].as_u64())
        };
        let checked = match (pool, dec(2), dec(3)) {
            (Some(pool), Some(du), Some(db)) => self.validate_pool(&pool).and_then(|idx| {
                if du != self.config.pool.usdc_decimals as u64 || db != self.config.pool.base_decimals as u64 {
                    Err(format!("decimals usdc={du} base={db} differ from config"))
                } else {
                    Ok(idx)
                }
            }),
            _ => Err("get_pool or ft_metadata failed".into()),
        };
        match checked {
            Ok(idx) => {
                self.usdc_pool_index = idx;
                self.ready = true;
                events::emit("setup_done", json!({ "pool_id": self.config.pool.pool_id, "usdc_pool_index": idx }));
                true
            }
            Err(e) => {
                events::emit("setup_failed", json!({ "stage": "pool_validation", "error": e }));
                false
            }
        }
    }

    // ======================= deposit intake (NEP-141 receiver) =======================

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let refuse = |reason: &str| {
            events::emit("deposit_refused", json!({ "token": token, "sender_id": sender_id, "amount": amount, "reason": reason }));
            PromiseOrValue::Value(amount)
        };
        if token != self.config.pool.usdc_token {
            return refuse("unsupported_token");
        }
        if !self.ready {
            return refuse("treasury_not_ready");
        }
        match serde_json::from_str::<DepositMsg>(&msg) {
            Ok(m) if m.action == "deposit" => {}
            _ => return refuse("invalid_msg"),
        }
        if amount.0 < self.config.min_deposit.0 {
            return refuse("below_min_deposit");
        }
        let s = ledger::split(amount.0);
        let id = self.next_deposit_id;
        self.next_deposit_id += 1;
        let now = U64(env::block_timestamp());
        let mut d = Deposit {
            id: U64(id),
            creator: sender_id.clone(),
            amount,
            lp_budget: U128(s.lp),
            reserve: U128(s.reserve),
            community: U128(s.community),
            status: DepositStatus::BudgetAllocated,
            plan: None,
            lp_shares: U128(0),
            lp_verified: false,
            usdc_swapped: U128(0),
            usdc_in_lp: U128(0),
            base_in_lp: U128(0),
            dust_usdc: U128(0),
            dust_base: U128(0),
            usdc_returned_to_reserve: U128(0),
            usdc_recovered: U128(0),
            base_recovered: U128(0),
            unlock_at: None,
            dex: self.config.pool.dex.clone(),
            pool_id: None,
            base_token: self.config.pool.base_token.clone(),
            lp_confirmed_at: None,
            lp_confirmed_block: None,
            last_error: None,
            marks: vec![],
            created_at: now,
            updated_at: now,
        };
        mark(&mut d, "deposit_allocated");
        self.deposits.insert(id, d);
        self.creator_deposits.entry(sender_id.clone()).or_default().push(id);
        *self.reserves.entry(sender_id.clone()).or_insert(0) += s.reserve;
        self.total_received += amount.0;
        self.reserve_total += s.reserve;
        self.community_total += s.community;
        self.pending_budget_total += s.lp;
        events::emit(
            "deposit_allocated",
            json!({
                "deposit_id": U64(id), "creator": sender_id, "amount": amount,
                "lp_budget": U128(s.lp), "reserve": U128(s.reserve), "community": U128(s.community),
            }),
        );
        PromiseOrValue::Value(U128(0))
    }

    // ======================= LP execution (creator-signed) =======================

    /// Starts or resumes the LP pipeline of `deposit_id`. Attach >= 200 Tgas (300 recommended).
    pub fn execute_lp(&mut self, deposit_id: U64, plan: Option<LpPlan>) -> Promise {
        require!(self.ready, "ERR_NOT_READY");
        require!(self.in_flight.is_none(), "ERR_JOB_IN_FLIGHT");
        let id = deposit_id.0;
        let mut d = self.get_deposit_or_panic(id);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        if let Some(p) = plan {
            self.validate_plan(&p);
            d.plan = Some(p);
        }
        let p = d.plan.clone().unwrap_or_else(|| env::panic_str("ERR_NO_PLAN"));
        require!(env::block_timestamp() <= p.deadline_ns.0, "ERR_PLAN_EXPIRED");
        let needed = match &d.status {
            DepositStatus::BudgetAllocated => T_DEPOSIT_TOTAL,
            DepositStatus::InRef { .. } => T_PRECHECK_TOTAL,
            DepositStatus::Swapped { .. } => T_ADD_TOTAL,
            _ => env::panic_str("ERR_NOT_RESUMABLE"),
        };
        require!(env::prepaid_gas() >= tgas(needed + T_SELF), "ERR_NOT_ENOUGH_GAS");
        d.last_error = None;
        let promise = match d.status.clone() {
            DepositStatus::BudgetAllocated => self.launch_amm_deposit(&mut d),
            DepositStatus::InRef { usdc } => self.launch_pre_swap_check(&mut d, usdc.0),
            DepositStatus::Swapped { usdc, base } => match self.launch_add_liquidity(&mut d, usdc.0, base.0) {
                Ok(p) => p,
                Err(e) => env::panic_str(e),
            },
            _ => unreachable!(),
        };
        self.save(d);
        promise
    }

    #[private]
    pub fn on_amm_deposit(&mut self, deposit_id: U64, #[callback_result] used: Result<U128, PromiseError>) -> PromiseOrValue<bool> {
        let Some(mut d) = self.expect_stage(deposit_id.0, |s| matches!(s, DepositStatus::AmmDepositPending)) else {
            return PromiseOrValue::Value(false);
        };
        match used {
            Ok(U128(used)) if used > 0 => {
                let budget = d.lp_budget.0;
                self.pending_budget_total -= budget;
                if used < budget {
                    let back = budget - used;
                    *self.reserves.entry(d.creator.clone()).or_insert(0) += back;
                    self.reserve_total += back;
                    d.usdc_returned_to_reserve = U128(d.usdc_returned_to_reserve.0 + back);
                }
                self.ref_expected_usdc += used;
                d.status = DepositStatus::InRef { usdc: U128(used) };
                self.emit_stage(&mut d, "amm_deposit_confirmed");
                let p = self.launch_pre_swap_check(&mut d, used);
                self.save(d);
                PromiseOrValue::Promise(p)
            }
            _ => {
                d.status = DepositStatus::BudgetAllocated;
                self.fail(d, "amm_deposit_failed_or_refunded");
                PromiseOrValue::Value(false)
            }
        }
    }

    /// On-chain guard, right before the swap: the pool is still the configured one, the zap's price
    /// impact (vs spot, fee included) is within the guard, and the plan's min_swap_out is within
    /// `max_slippage_bps` of what Ref itself quotes now.
    #[private]
    pub fn on_pre_swap(
        &mut self,
        deposit_id: U64,
        #[callback_result] pool: Result<PoolInfo, PromiseError>,
        #[callback_result] quoted: Result<U128, PromiseError>,
    ) -> PromiseOrValue<bool> {
        let Some(mut d) = self.expect_stage(deposit_id.0, |s| matches!(s, DepositStatus::PreSwapCheckPending { .. })) else {
            return PromiseOrValue::Value(false);
        };
        let DepositStatus::PreSwapCheckPending { usdc } = d.status.clone() else { unreachable!() };
        d.status = DepositStatus::InRef { usdc };
        let plan = d.plan.clone().expect("plan");
        let verdict = match (pool, quoted) {
            (Ok(pool), Ok(U128(q))) => self.check_swap(&pool, plan.swap_amount_in.0, q, plan.min_swap_out.0),
            _ => Err("guard_views_failed".to_string()),
        };
        if let Err(e) = verdict {
            self.fail(d, &e);
            return PromiseOrValue::Value(false);
        }
        match self.launch_swap(&mut d, usdc.0) {
            Ok(p) => {
                self.save(d);
                PromiseOrValue::Promise(p)
            }
            Err(e) => {
                self.fail(d, e);
                PromiseOrValue::Value(false)
            }
        }
    }

    #[private]
    pub fn on_swap(&mut self, deposit_id: U64, #[callback_result] out: Result<U128, PromiseError>) -> PromiseOrValue<bool> {
        let Some(mut d) = self.expect_stage(deposit_id.0, |s| matches!(s, DepositStatus::SwapPending { .. })) else {
            return PromiseOrValue::Value(false);
        };
        let DepositStatus::SwapPending { usdc } = d.status.clone() else { unreachable!() };
        match out {
            Ok(U128(base)) if base > 0 => {
                let swap_in = d.plan.as_ref().expect("plan").swap_amount_in.0;
                self.ref_expected_usdc -= swap_in;
                self.ref_expected_base += base;
                d.usdc_swapped = U128(swap_in);
                let usdc_left = usdc.0 - swap_in;
                d.status = DepositStatus::Swapped { usdc: U128(usdc_left), base: U128(base) };
                self.emit_stage(&mut d, "swap_confirmed");
                match self.launch_add_liquidity(&mut d, usdc_left, base) {
                    Ok(p) => {
                        self.save(d);
                        PromiseOrValue::Promise(p)
                    }
                    Err(e) => {
                        self.fail(d, e);
                        PromiseOrValue::Value(false)
                    }
                }
            }
            _ => {
                d.status = DepositStatus::InRef { usdc };
                self.fail(d, "swap_failed");
                PromiseOrValue::Value(false)
            }
        }
    }

    #[private]
    pub fn on_add_liquidity(&mut self, deposit_id: U64, #[callback_result] shares: Result<U128, PromiseError>) -> PromiseOrValue<bool> {
        let Some(mut d) = self.expect_stage(deposit_id.0, |s| matches!(s, DepositStatus::AddLiquidityPending { .. })) else {
            return PromiseOrValue::Value(false);
        };
        let DepositStatus::AddLiquidityPending { usdc, base } = d.status.clone() else { unreachable!() };
        match shares {
            Ok(U128(minted)) if minted > 0 => {
                d.status = DepositStatus::VerifyPending { usdc, base, shares: U128(minted) };
                let p = self
                    .verify_promise()
                    .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_verified(deposit_id));
                self.touch_in_flight();
                self.save(d);
                PromiseOrValue::Promise(p)
            }
            _ => {
                d.status = DepositStatus::Swapped { usdc, base };
                self.fail(d, "add_liquidity_failed");
                PromiseOrValue::Value(false)
            }
        }
    }

    #[private]
    pub fn on_verified(
        &mut self,
        deposit_id: U64,
        #[callback_result] shares_now: Result<U128, PromiseError>,
        #[callback_result] ref_deposits: Result<HashMap<AccountId, U128>, PromiseError>,
    ) -> bool {
        let Some(d) = self.expect_stage(deposit_id.0, |s| matches!(s, DepositStatus::VerifyPending { .. })) else {
            return false;
        };
        self.finalize_lp(d, shares_now.ok().map(|s| s.0), ref_deposits.ok());
        true
    }

    // ======================= recovery =======================

    /// Re-derives the stage of a stuck LP job from Treasury's real Ref balances, after a timeout.
    pub fn reconcile(&mut self) -> Promise {
        let f = self.in_flight.clone().unwrap_or_else(|| env::panic_str("ERR_NOTHING_IN_FLIGHT"));
        require!(f.job == Job::Lp, "ERR_NOT_AN_LP_JOB");
        require!(env::block_timestamp() >= f.since.0 + RECONCILE_TIMEOUT_NS, "ERR_RECONCILE_TOO_EARLY");
        self.verify_promise()
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_reconcile(f.deposit_id, f.since))
    }

    #[private]
    pub fn on_reconcile(
        &mut self,
        deposit_id: U64,
        since: U64,
        #[callback_result] shares_now: Result<U128, PromiseError>,
        #[callback_result] ref_deposits: Result<HashMap<AccountId, U128>, PromiseError>,
    ) -> bool {
        match &self.in_flight {
            Some(f) if f.deposit_id == deposit_id && f.since == since => {}
            _ => return false,
        }
        let (Ok(U128(shares_now)), Ok(deps)) = (shares_now, ref_deposits) else {
            events::emit("reconcile_failed", json!({ "deposit_id": deposit_id, "reason": "views_failed" }));
            return false;
        };
        let actual_usdc = deps.get(&self.config.pool.usdc_token).map_or(0, |v| v.0);
        let actual_base = deps.get(&self.config.pool.base_token).map_or(0, |v| v.0);
        let mut d = self.get_deposit_or_panic(deposit_id.0);
        match d.status.clone() {
            DepositStatus::AmmDepositPending => {
                let budget = d.lp_budget.0;
                if actual_usdc >= self.ref_expected_usdc + budget {
                    self.pending_budget_total -= budget;
                    self.ref_expected_usdc += budget;
                    d.status = DepositStatus::InRef { usdc: U128(budget) };
                } else {
                    d.status = DepositStatus::BudgetAllocated;
                }
            }
            // Only views were in flight: nothing moved.
            DepositStatus::PreSwapCheckPending { usdc } => d.status = DepositStatus::InRef { usdc },
            DepositStatus::SwapPending { usdc } => {
                if actual_base > self.ref_expected_base {
                    let swap_in = d.plan.as_ref().expect("plan").swap_amount_in.0;
                    let out = actual_base - self.ref_expected_base;
                    self.ref_expected_usdc -= swap_in;
                    self.ref_expected_base = actual_base;
                    d.usdc_swapped = U128(swap_in);
                    d.status = DepositStatus::Swapped { usdc: U128(usdc.0 - swap_in), base: U128(out) };
                } else {
                    d.status = DepositStatus::InRef { usdc };
                }
            }
            DepositStatus::AddLiquidityPending { usdc, base } => {
                if shares_now > self.recorded_shares {
                    d.status = DepositStatus::VerifyPending { usdc, base, shares: U128(shares_now - self.recorded_shares) };
                    self.finalize_lp(d, Some(shares_now), Some(deps));
                    return true;
                }
                d.status = DepositStatus::Swapped { usdc, base };
            }
            DepositStatus::VerifyPending { .. } => {
                self.finalize_lp(d, Some(shares_now), Some(deps));
                return true;
            }
            _ => {}
        }
        d.last_error = Some("reconciled_after_timeout".into());
        self.emit_stage(&mut d, "reconciled");
        self.in_flight = None;
        self.save(d);
        true
    }

    /// Creator stops an LP that has not been added yet. Nothing is lost, nothing becomes LP:
    /// - budget not sent to Ref yet -> credited to the creator's USDC reserve (withdraw_reserve);
    /// - funds in Treasury's Ref deposit -> leftovers of this deposit (withdraw_leftover).
    pub fn abort_lp(&mut self, deposit_id: U64) {
        require!(self.in_flight.is_none(), "ERR_JOB_IN_FLIGHT");
        let mut d = self.get_deposit_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        match d.status.clone() {
            DepositStatus::BudgetAllocated => {
                let budget = d.lp_budget.0;
                self.pending_budget_total -= budget;
                *self.reserves.entry(d.creator.clone()).or_insert(0) += budget;
                self.reserve_total += budget;
                d.usdc_returned_to_reserve = U128(d.usdc_returned_to_reserve.0 + budget);
            }
            DepositStatus::InRef { usdc } => d.dust_usdc = U128(d.dust_usdc.0 + usdc.0),
            DepositStatus::Swapped { usdc, base } => {
                d.dust_usdc = U128(d.dust_usdc.0 + usdc.0);
                d.dust_base = U128(d.dust_base.0 + base.0);
            }
            _ => env::panic_str("ERR_NOT_ABORTABLE"),
        }
        d.status = DepositStatus::Aborted;
        self.emit_stage(&mut d, "lp_aborted");
        self.save(d);
    }

    /// Moves this deposit's leftover of `token` out of Treasury's Ref deposit, into the creator's
    /// balance here (USDC -> reserve, base -> base balance). Success is judged from Ref's own
    /// get_deposits after the withdraw, never from the withdraw call alone. 1 yocto.
    #[payable]
    pub fn withdraw_leftover(&mut self, deposit_id: U64, token_id: AccountId) -> Promise {
        assert_one_yocto();
        require!(self.in_flight.is_none(), "ERR_JOB_IN_FLIGHT");
        let d = self.get_deposit_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        require!(
            matches!(d.status, DepositStatus::LpConfirmed | DepositStatus::LpWithdrawn | DepositStatus::Aborted),
            "ERR_NO_LEFTOVERS_YET"
        );
        let amount = if token_id == self.config.pool.usdc_token {
            d.dust_usdc.0
        } else if token_id == self.config.pool.base_token {
            d.dust_base.0
        } else {
            env::panic_str("ERR_UNKNOWN_TOKEN")
        };
        require!(amount > 0, "ERR_NOTHING_TO_WITHDRAW");
        let me = env::current_account_id();
        self.in_flight = Some(InFlight {
            deposit_id,
            since: U64(env::block_timestamp()),
            job: Job::Leftover { token: token_id.clone(), amount: U128(amount) },
        });
        let dex = self.config.pool.dex.clone();
        ext_ref::ext(dex.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_REF_WITHDRAW))
            .withdraw(token_id.clone(), U128(amount), None, None)
            .then(ext_ref::ext(dex).with_static_gas(tgas(T_VIEW)).get_deposits(me.clone()))
            .then(Self::ext(me).with_static_gas(tgas(T_CB)).on_leftover(deposit_id, token_id, U128(amount)))
    }

    #[private]
    pub fn on_leftover(
        &mut self,
        deposit_id: U64,
        token_id: AccountId,
        amount: U128,
        #[callback_result] deps: Result<HashMap<AccountId, U128>, PromiseError>,
    ) -> bool {
        let expected_job = Job::Leftover { token: token_id.clone(), amount };
        match &self.in_flight {
            Some(f) if f.deposit_id == deposit_id && f.job == expected_job => {}
            _ => return false,
        }
        self.in_flight = None;
        let mut d = self.get_deposit_or_panic(deposit_id.0);
        let is_usdc = token_id == self.config.pool.usdc_token;
        let expected = if is_usdc { self.ref_expected_usdc } else { self.ref_expected_base };
        let actual = deps.ok().map(|m| m.get(&token_id).map_or(0, |v| v.0));
        // Withdrawn only if Ref's balance really dropped by `amount` (a failed transfer is re-credited by Ref).
        let withdrawn = actual.is_some_and(|a| a + amount.0 <= expected);
        if !withdrawn {
            d.last_error = Some("leftover_withdraw_failed".into());
            self.emit_stage(&mut d, "leftover_withdraw_failed");
            self.save(d);
            return false;
        }
        if is_usdc {
            self.ref_expected_usdc -= amount.0;
            d.dust_usdc = U128(d.dust_usdc.0 - amount.0);
            d.usdc_recovered = U128(d.usdc_recovered.0 + amount.0);
            *self.reserves.entry(d.creator.clone()).or_insert(0) += amount.0;
            self.reserve_total += amount.0;
        } else {
            self.ref_expected_base -= amount.0;
            d.dust_base = U128(d.dust_base.0 - amount.0);
            d.base_recovered = U128(d.base_recovered.0 + amount.0);
            *self.base_balances.entry(d.creator.clone()).or_insert(0) += amount.0;
            self.base_balance_total += amount.0;
        }
        d.last_error = None;
        self.emit_stage(&mut d, "leftover_recovered");
        self.save(d);
        true
    }

    // ======================= creator withdrawals =======================

    /// Creator's USDC reserve (8 % + returned budget + recovered USDC leftovers). 1 yocto.
    #[payable]
    pub fn withdraw_reserve(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let creator = env::predecessor_account_id();
        let bal = self.reserves.get(&creator).copied().unwrap_or(0);
        require!(amount.0 > 0 && amount.0 <= bal, "ERR_INSUFFICIENT_RESERVE");
        self.reserves.insert(creator.clone(), bal - amount.0);
        self.reserve_total -= amount.0;
        ext_ft::ext(self.config.pool.usdc_token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_FT_TRANSFER))
            .ft_transfer(creator.clone(), amount, Some("SOL2NEAR V4 reserve withdrawal".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_reserve_withdraw(creator, amount))
    }

    #[private]
    pub fn on_reserve_withdraw(&mut self, creator: AccountId, amount: U128) -> bool {
        if promise_bytes(0).is_some() {
            events::emit("reserve_withdrawn", json!({ "creator": creator, "amount": amount }));
            true
        } else {
            *self.reserves.entry(creator.clone()).or_insert(0) += amount.0;
            self.reserve_total += amount.0;
            events::emit("reserve_withdraw_failed", json!({ "creator": creator, "amount": amount }));
            false
        }
    }

    /// Base-token leftovers recovered from Ref. The creator must be registered on the base token. 1 yocto.
    #[payable]
    pub fn withdraw_base(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let creator = env::predecessor_account_id();
        let bal = self.base_balances.get(&creator).copied().unwrap_or(0);
        require!(amount.0 > 0 && amount.0 <= bal, "ERR_INSUFFICIENT_BASE");
        self.base_balances.insert(creator.clone(), bal - amount.0);
        self.base_balance_total -= amount.0;
        ext_ft::ext(self.config.pool.base_token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_FT_TRANSFER))
            .ft_transfer(creator.clone(), amount, Some("SOL2NEAR V4 leftover withdrawal".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_base_withdraw(creator, amount))
    }

    #[private]
    pub fn on_base_withdraw(&mut self, creator: AccountId, amount: U128) -> bool {
        if promise_bytes(0).is_some() {
            events::emit("base_withdrawn", json!({ "creator": creator, "amount": amount }));
            true
        } else {
            *self.base_balances.entry(creator.clone()).or_insert(0) += amount.0;
            self.base_balance_total += amount.0;
            events::emit("base_withdraw_failed", json!({ "creator": creator, "amount": amount }));
            false
        }
    }

    /// After the lock, transfers the deposit's LP shares to the creator (Ref MFT ":<pool_id>"), then
    /// records a fresh Proof of Liquidity. The creator must have called `mft_register` on Ref for the
    /// pool's shares first. The creator then exits the pool with Ref `remove_liquidity`. 1 yocto.
    #[payable]
    pub fn withdraw_lp(&mut self, deposit_id: U64) -> Promise {
        assert_one_yocto();
        require!(self.in_flight.is_none(), "ERR_JOB_IN_FLIGHT");
        let mut d = self.get_deposit_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        require!(d.status == DepositStatus::LpConfirmed, "ERR_NO_CONFIRMED_LP");
        let unlock_at = d.unlock_at.expect("unlock_at").0;
        require!(env::block_timestamp() >= unlock_at, "ERR_LP_LOCKED");
        d.status = DepositStatus::LpWithdrawPending;
        self.emit_stage(&mut d, "lp_withdraw_started");
        let p = ext_ref::ext(self.config.pool.dex.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_REF_MFT_TRANSFER))
            .mft_transfer(format!(":{}", self.config.pool.pool_id), d.creator.clone(), d.lp_shares, Some("SOL2NEAR V4 LP withdrawal".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB + T_VIEW + T_CB)).on_lp_withdraw(deposit_id));
        self.save(d);
        p
    }

    #[private]
    pub fn on_lp_withdraw(&mut self, deposit_id: U64) -> PromiseOrValue<bool> {
        let mut d = self.get_deposit_or_panic(deposit_id.0);
        if d.status != DepositStatus::LpWithdrawPending {
            return PromiseOrValue::Value(false);
        }
        if promise_bytes(0).is_some() {
            self.recorded_shares -= d.lp_shares.0;
            d.status = DepositStatus::LpWithdrawn;
            self.emit_stage(&mut d, "lp_withdrawn");
            self.save(d);
            // Fresh proof: the Treasury's remaining shares still cover what it records.
            PromiseOrValue::Promise(self.proof_promise())
        } else {
            d.status = DepositStatus::LpConfirmed;
            d.last_error = Some("lp_withdraw_failed".into());
            self.emit_stage(&mut d, "lp_withdraw_failed");
            self.save(d);
            PromiseOrValue::Value(false)
        }
    }

    // ======================= Proof of Liquidity =======================

    pub fn verify_liquidity(&mut self) -> Promise {
        self.proof_promise()
    }

    #[private]
    pub fn on_proof(&mut self, #[callback_result] shares: Result<U128, PromiseError>) -> Option<Proof> {
        let U128(onchain) = shares.ok()?;
        Some(self.record_proof(onchain))
    }

    // ======================= views =======================

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            config: self.config.clone(),
            lp_bps: ledger::LP_BPS as u16,
            reserve_bps: ledger::RESERVE_BPS as u16,
            community_bps: (ledger::BPS_DENOM - ledger::LP_BPS - ledger::RESERVE_BPS) as u16,
            ready: self.ready,
            usdc_pool_index: self.usdc_pool_index,
            fuel: FUEL_NOT_ELIGIBLE.into(),
        }
    }

    pub fn get_deposit(&self, deposit_id: U64) -> Option<Deposit> {
        self.deposits.get(&deposit_id.0).cloned()
    }

    pub fn get_position(&self, deposit_id: U64) -> Option<PositionView> {
        let d = self.deposits.get(&deposit_id.0).cloned()?;
        let now = env::block_timestamp();
        let locked = d.status == DepositStatus::LpConfirmed && d.unlock_at.is_some_and(|u| now < u.0);
        Some(PositionView {
            lp_withdrawable: d.status == DepositStatus::LpConfirmed && !locked,
            leftovers_recoverable: matches!(d.status, DepositStatus::LpConfirmed | DepositStatus::LpWithdrawn | DepositStatus::Aborted)
                && (d.dust_usdc.0 > 0 || d.dust_base.0 > 0),
            locked,
            fuel_status: FUEL_NOT_ELIGIBLE.into(),
            fuel_reason: FUEL_REASON.into(),
            deposit: d,
        })
    }

    pub fn get_creator_deposits(&self, creator: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Deposit> {
        let ids = self.creator_deposits.get(&creator).cloned().unwrap_or_default();
        ids.iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50) as usize)
            .filter_map(|id| self.deposits.get(id).cloned())
            .collect()
    }

    pub fn get_reserve(&self, creator: AccountId) -> U128 {
        U128(self.reserves.get(&creator).copied().unwrap_or(0))
    }

    pub fn get_base_balance(&self, creator: AccountId) -> U128 {
        U128(self.base_balances.get(&creator).copied().unwrap_or(0))
    }

    pub fn get_accounting(&self) -> Accounting {
        Accounting {
            total_received: U128(self.total_received),
            reserve_total: U128(self.reserve_total),
            community_total: U128(self.community_total),
            pending_budget_total: U128(self.pending_budget_total),
            ref_expected_usdc: U128(self.ref_expected_usdc),
            ref_expected_base: U128(self.ref_expected_base),
            base_balance_total: U128(self.base_balance_total),
            recorded_shares: U128(self.recorded_shares),
            deposits_count: U64(self.next_deposit_id),
        }
    }

    pub fn get_in_flight(&self) -> Option<InFlight> {
        self.in_flight.clone()
    }

    pub fn get_last_proof(&self) -> Option<Proof> {
        self.last_proof.clone()
    }
}

// ======================= internals =======================

fn mark(d: &mut Deposit, stage: &str) {
    if d.marks.len() >= MAX_MARKS {
        d.marks.remove(0);
    }
    d.marks.push(StageMark { stage: stage.into(), block: U64(env::block_height()), at: U64(env::block_timestamp()) });
}

impl TreasuryV4 {
    fn get_deposit_or_panic(&self, id: u64) -> Deposit {
        self.deposits.get(&id).cloned().unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_DEPOSIT"))
    }

    fn save(&mut self, mut d: Deposit) {
        d.updated_at = U64(env::block_timestamp());
        self.deposits.insert(d.id.0, d);
    }

    fn expect_stage(&self, id: u64, ok: impl Fn(&DepositStatus) -> bool) -> Option<Deposit> {
        let in_flight_matches = self.in_flight.as_ref().is_some_and(|f| f.deposit_id.0 == id && f.job == Job::Lp);
        let d = self.deposits.get(&id).cloned()?;
        if in_flight_matches && ok(&d.status) {
            Some(d)
        } else {
            events::emit("callback_ignored", json!({ "deposit_id": U64(id), "status": d.status }));
            None
        }
    }

    fn touch_in_flight(&mut self) {
        if let Some(f) = self.in_flight.as_mut() {
            f.since = U64(env::block_timestamp());
        }
    }

    fn start_or_touch(&mut self, id: u64) {
        self.in_flight = Some(InFlight { deposit_id: U64(id), since: U64(env::block_timestamp()), job: Job::Lp });
    }

    /// The job stops; funds stay in the persisted stage (resumable / abortable). Event `lp_job_failed {reason}`.
    fn fail(&mut self, mut d: Deposit, reason: &str) {
        d.last_error = Some(reason.to_string());
        self.in_flight = None;
        mark(&mut d, "lp_job_failed");
        events::emit("lp_job_failed", json!({ "deposit_id": d.id, "creator": d.creator, "status": d.status, "reason": reason }));
        self.save(d);
    }

    fn emit_stage(&self, d: &mut Deposit, event: &str) {
        mark(d, event);
        events::emit(event, json!({ "deposit_id": d.id, "creator": d.creator, "status": d.status, "lp_shares": d.lp_shares }));
    }

    fn validate_plan(&self, p: &LpPlan) {
        require!(p.swap_amount_in.0 > 0, "ERR_PLAN_SWAP_ZERO");
        require!(p.min_swap_out.0 > 0, "ERR_PLAN_NO_SLIPPAGE_GUARD");
        require!(p.min_amounts.len() == 2 && p.min_amounts.iter().all(|m| m.0 > 0), "ERR_PLAN_MIN_AMOUNTS");
        let now = env::block_timestamp();
        require!(p.deadline_ns.0 > now, "ERR_PLAN_EXPIRED");
        require!(p.deadline_ns.0 <= now + self.config.guards.max_plan_ttl_ns.0, "ERR_PLAN_DEADLINE_TOO_FAR");
    }

    fn plan_alive(d: &Deposit) -> Result<LpPlan, &'static str> {
        let plan = d.plan.clone().ok_or("no_plan")?;
        if env::block_timestamp() > plan.deadline_ns.0 {
            return Err("plan_expired");
        }
        Ok(plan)
    }

    /// Pure check of the swap leg against Ref's live state (see on_pre_swap).
    fn check_swap(&self, pool: &PoolInfo, swap_in: u128, quoted: u128, min_out: u128) -> Result<(), String> {
        let iu = self.validate_pool(pool)? as usize;
        let r_in = pool.amounts.get(iu).map_or(0, |v| v.0);
        let r_out = pool.amounts.get(1 - iu).map_or(0, |v| v.0);
        if r_in == 0 || r_out == 0 {
            return Err("guard_empty_pool".into());
        }
        let ideal = swap_in.checked_mul(r_out).ok_or("guard_overflow")? / r_in;
        if ideal == 0 || quoted == 0 {
            return Err("guard_zero_output".into());
        }
        let impact = if quoted >= ideal { 0 } else { (ideal - quoted) * BPS / ideal };
        let g = &self.config.guards;
        if impact > g.max_price_impact_bps as u128 {
            return Err(format!("guard_price_impact {impact} bps > {}", g.max_price_impact_bps));
        }
        if min_out < quoted * (BPS - g.max_slippage_bps as u128) / BPS {
            return Err(format!("guard_slippage: min_swap_out {min_out} < quote {quoted} - {} bps", g.max_slippage_bps));
        }
        Ok(())
    }

    fn launch_amm_deposit(&mut self, d: &mut Deposit) -> Promise {
        self.start_or_touch(d.id.0);
        d.status = DepositStatus::AmmDepositPending;
        let p = &self.config.pool;
        ext_ft::ext(p.usdc_token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_FT_TRANSFER_CALL))
            .ft_transfer_call(p.dex.clone(), d.lp_budget, None, String::new())
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB + T_PRECHECK_TOTAL)).on_amm_deposit(d.id))
    }

    fn launch_pre_swap_check(&mut self, d: &mut Deposit, usdc_in_ref: u128) -> Promise {
        let plan = d.plan.clone().expect("plan");
        require!(plan.swap_amount_in.0 < usdc_in_ref, "ERR_SWAP_AMOUNT_TOO_LARGE");
        self.start_or_touch(d.id.0);
        d.status = DepositStatus::PreSwapCheckPending { usdc: U128(usdc_in_ref) };
        let p = &self.config.pool;
        ext_ref::ext(p.dex.clone())
            .with_static_gas(tgas(T_VIEW))
            .get_pool(p.pool_id)
            .and(ext_ref::ext(p.dex.clone()).with_static_gas(tgas(T_VIEW)).get_return(
                p.pool_id,
                p.usdc_token.clone(),
                plan.swap_amount_in,
                p.base_token.clone(),
            ))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB + T_SWAP_TOTAL)).on_pre_swap(d.id))
    }

    fn launch_swap(&mut self, d: &mut Deposit, usdc_in_ref: u128) -> Result<Promise, &'static str> {
        let plan = Self::plan_alive(d)?;
        self.start_or_touch(d.id.0);
        d.status = DepositStatus::SwapPending { usdc: U128(usdc_in_ref) };
        let p = &self.config.pool;
        Ok(ext_ref::ext(p.dex.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_REF_SWAP))
            .swap(
                vec![SwapAction {
                    pool_id: p.pool_id,
                    token_in: p.usdc_token.clone(),
                    amount_in: Some(plan.swap_amount_in),
                    token_out: p.base_token.clone(),
                    min_amount_out: plan.min_swap_out,
                }],
                None,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB + T_ADD_TOTAL)).on_swap(d.id)))
    }

    /// add_liquidity guard: each min_amount must be <= what is provided and >= provided minus
    /// 2 x max_slippage (Ref rounds shares, so need_amounts can sit slightly below the provided amounts).
    fn launch_add_liquidity(&mut self, d: &mut Deposit, usdc: u128, base: u128) -> Result<Promise, &'static str> {
        let plan = Self::plan_alive(d)?;
        let provided = self.pool_order(usdc, base);
        let floor_bps = BPS - 2 * self.config.guards.max_slippage_bps as u128;
        for (m, p) in plan.min_amounts.iter().zip(provided.iter()) {
            if m.0 > p.0 || m.0 < p.0 * floor_bps / BPS {
                return Err("guard_add_liquidity_min_amounts");
            }
        }
        self.start_or_touch(d.id.0);
        d.status = DepositStatus::AddLiquidityPending { usdc: U128(usdc), base: U128(base) };
        Ok(ext_ref::ext(self.config.pool.dex.clone())
            .with_attached_deposit(ADD_LIQ_DEPOSIT)
            .with_static_gas(tgas(T_REF_ADD_LIQ))
            .add_liquidity(self.config.pool.pool_id, provided, Some(plan.min_amounts))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB + T_VERIFY_TOTAL)).on_add_liquidity(d.id)))
    }

    fn verify_promise(&self) -> Promise {
        let me = env::current_account_id();
        let p = &self.config.pool;
        ext_ref::ext(p.dex.clone())
            .with_static_gas(tgas(T_VIEW))
            .get_pool_shares(p.pool_id, me.clone())
            .and(ext_ref::ext(p.dex.clone()).with_static_gas(tgas(T_VIEW)).get_deposits(me))
    }

    fn proof_promise(&self) -> Promise {
        ext_ref::ext(self.config.pool.dex.clone())
            .with_static_gas(tgas(T_VIEW))
            .get_pool_shares(self.config.pool.pool_id, env::current_account_id())
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_proof())
    }

    fn pool_order(&self, usdc: u128, base: u128) -> Vec<U128> {
        if self.usdc_pool_index == 0 {
            vec![U128(usdc), U128(base)]
        } else {
            vec![U128(base), U128(usdc)]
        }
    }

    fn validate_pool(&self, pool: &PoolInfo) -> Result<u8, String> {
        if pool.pool_kind != "SIMPLE_POOL" {
            return Err(format!("pool_kind {}", pool.pool_kind));
        }
        let (u, b) = (&self.config.pool.usdc_token, &self.config.pool.base_token);
        match pool.token_account_ids.as_slice() {
            [x, y] if x == u && y == b => Ok(0),
            [x, y] if x == b && y == u => Ok(1),
            _ => Err("pool tokens do not match config".into()),
        }
    }

    fn finalize_lp(&mut self, mut d: Deposit, shares_now: Option<u128>, ref_deposits: Option<HashMap<AccountId, U128>>) {
        let DepositStatus::VerifyPending { usdc, base, shares } = d.status.clone() else {
            env::panic_str("ERR_BAD_STAGE")
        };
        let minted = shares.0;
        let verified = ref_deposits.is_some() && shares_now.is_some_and(|s| s >= self.recorded_shares + minted);
        let (used_usdc, used_base) = match &ref_deposits {
            Some(deps) => {
                let actual_usdc = deps.get(&self.config.pool.usdc_token).map_or(0, |v| v.0);
                let actual_base = deps.get(&self.config.pool.base_token).map_or(0, |v| v.0);
                (
                    self.ref_expected_usdc.saturating_sub(actual_usdc).min(usdc.0),
                    self.ref_expected_base.saturating_sub(actual_base).min(base.0),
                )
            }
            None => (usdc.0, base.0),
        };
        self.ref_expected_usdc -= used_usdc;
        self.ref_expected_base -= used_base;
        self.recorded_shares += minted;
        let now = env::block_timestamp();
        d.lp_shares = shares;
        d.lp_verified = verified;
        d.usdc_in_lp = U128(used_usdc);
        d.base_in_lp = U128(used_base);
        d.dust_usdc = U128(d.dust_usdc.0 + usdc.0 - used_usdc);
        d.dust_base = U128(d.dust_base.0 + base.0 - used_base);
        d.unlock_at = Some(U64(now + self.config.lp_lock_duration_ns.0));
        d.pool_id = Some(self.config.pool.pool_id);
        d.lp_confirmed_at = Some(U64(now));
        d.lp_confirmed_block = Some(U64(env::block_height()));
        d.status = DepositStatus::LpConfirmed;
        mark(&mut d, "lp_confirmed");
        self.in_flight = None;
        if let Some(s) = shares_now {
            self.record_proof(s);
        }
        events::emit(
            "lp_confirmed",
            json!({
                "deposit_id": d.id, "creator": d.creator, "dex": self.config.pool.dex, "pool_id": self.config.pool.pool_id,
                "shares": d.lp_shares, "verified": verified, "usdc_in_lp": d.usdc_in_lp, "base_in_lp": d.base_in_lp,
                "dust_usdc": d.dust_usdc, "dust_base": d.dust_base, "unlock_at": d.unlock_at, "fuel": FUEL_NOT_ELIGIBLE,
            }),
        );
        self.save(d);
    }

    fn record_proof(&mut self, onchain: u128) -> Proof {
        let proof = Proof {
            block_height: U64(env::block_height()),
            timestamp: U64(env::block_timestamp()),
            onchain_shares: U128(onchain),
            recorded_shares: U128(self.recorded_shares),
            ok: onchain >= self.recorded_shares,
        };
        events::emit(
            "proof_of_liquidity",
            json!({
                "dex": self.config.pool.dex, "pool_id": self.config.pool.pool_id, "onchain_shares": proof.onchain_shares,
                "recorded_shares": proof.recorded_shares, "ok": proof.ok, "block_height": proof.block_height,
            }),
        );
        self.last_proof = Some(proof.clone());
        proof
    }
}

fn ft_storage(token: &AccountId, account: &AccountId) -> Promise {
    ext_ft::ext(token.clone())
        .with_attached_deposit(FT_STORAGE)
        .with_static_gas(tgas(T_STORAGE))
        .storage_deposit(Some(account.clone()), Some(true))
}

fn promise_bytes(index: u64) -> Option<Vec<u8>> {
    #[allow(deprecated)]
    match env::promise_result(index) {
        near_sdk::PromiseResult::Successful(b) => Some(b),
        _ => None,
    }
}
