//! SOL2NEAR Treasury (NEAR testnet).
//!
//! Flow: creator `ft_transfer_call(Treasury, msg={"action":"deposit"})` with Tidepool test USDC
//! -> 90/8/2 split -> `execute_lp` (creator-signed) -> Ref: deposit, partial swap, add_liquidity
//! -> shares measured on-chain and held by Treasury for the creator, locked until `unlock_at`
//! -> `withdraw_lp` (mft_transfer to the creator) after the lock.
//!
//! Async safety: one LP job at a time (`in_flight`), every stage persisted, callbacks are
//! `#[private]` and check the expected status (replays are no-ops), failures never mark funds
//! as LP, and `reconcile` re-derives a stuck stage from on-chain Ref balances.

mod events;
mod external;
mod ledger;
mod types;

#[cfg(test)]
mod tests;

use external::{ext_ft, ext_ref};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};
use std::collections::HashMap;
pub use types::*;

// ---------- gas budget (Tgas), every chain stays far below 300 Tgas ----------
const T_FT_TRANSFER: u64 = 15;
const T_FT_TRANSFER_CALL: u64 = 50;
const T_STORAGE: u64 = 10;
const T_REF_REGISTER: u64 = 10;
const T_REF_SWAP: u64 = 20;
const T_REF_ADD_LIQ: u64 = 25;
const T_REF_MFT_TRANSFER: u64 = 15;
const T_VIEW: u64 = 5;
const T_CB: u64 = 10;
const T_VERIFY_TOTAL: u64 = 2 * T_VIEW + T_CB;
const T_ADD_TOTAL: u64 = T_REF_ADD_LIQ + T_CB + T_VERIFY_TOTAL;
const T_SWAP_TOTAL: u64 = T_REF_SWAP + T_CB + T_ADD_TOTAL;
const T_DEPOSIT_TOTAL: u64 = T_FT_TRANSFER_CALL + T_CB + T_SWAP_TOTAL;
const T_SETUP_DONE: u64 = T_CB;
const T_SETUP_STORAGE_CB: u64 = T_CB + T_REF_REGISTER + T_VIEW + T_SETUP_DONE;
/// Margin for the calling method's own execution.
const T_SELF: u64 = 15;

const fn tgas(t: u64) -> Gas {
    Gas::from_tgas(t)
}

// ---------- deposits attached by Treasury (testnet values, see FEASIBILITY H3/H4) ----------
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// NEP-145 registration on Tidepool tokens (storage_balance_bounds min = max = 0.00125 NEAR, verified).
const FT_STORAGE: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
/// Treasury's storage on Ref (min 0.00102 NEAR verified; extra covers registered tokens and shares).
const REF_STORAGE: NearToken = NearToken::from_millinear(100);
/// Attached to add_liquidity (>= 1 yocto required; amount for LP storage is hypothesis H4).
const ADD_LIQ_DEPOSIT: NearToken = NearToken::from_millinear(5);
const SETUP_DEPOSIT: NearToken =
    NearToken::from_yoctonear(REF_STORAGE.as_yoctonear() + 4 * FT_STORAGE.as_yoctonear());

/// A stage with no callback after this delay can be reconciled from on-chain balances.
pub const RECONCILE_TIMEOUT_NS: u64 = 10 * 60 * 1_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Deposits,
    CreatorDeposits,
    Reserves,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Treasury {
    config: Config,
    ready: bool,
    usdc_pool_index: u8,
    next_deposit_id: u64,
    deposits: LookupMap<u64, Deposit>,
    creator_deposits: LookupMap<AccountId, Vec<u64>>,
    reserves: LookupMap<AccountId, u128>,
    total_received: u128,
    reserve_total: u128,
    community_total: u128,
    pending_budget_total: u128,
    ref_expected_usdc: u128,
    ref_expected_wnear: u128,
    recorded_shares: u128,
    in_flight: Option<InFlight>,
    last_proof: Option<Proof>,
}

#[near]
impl Treasury {
    #[init]
    pub fn new(
        usdc_token: AccountId,
        wnear_token: AccountId,
        ref_exchange: AccountId,
        pool_id: u64,
        min_deposit: U128,
        lp_lock_duration_ns: U64,
    ) -> Self {
        require!(usdc_token != wnear_token, "ERR_SAME_TOKENS");
        require!(min_deposit.0 > 0, "ERR_MIN_DEPOSIT_ZERO");
        Self {
            config: Config {
                usdc_token,
                wnear_token,
                ref_exchange,
                pool_id,
                min_deposit,
                lp_lock_duration_ns,
            },
            ready: false,
            usdc_pool_index: 0,
            next_deposit_id: 0,
            deposits: LookupMap::new(StorageKey::Deposits),
            creator_deposits: LookupMap::new(StorageKey::CreatorDeposits),
            reserves: LookupMap::new(StorageKey::Reserves),
            total_received: 0,
            reserve_total: 0,
            community_total: 0,
            pending_budget_total: 0,
            ref_expected_usdc: 0,
            ref_expected_wnear: 0,
            recorded_shares: 0,
            in_flight: None,
            last_proof: None,
        }
    }

    // ======================= setup (permissionless, idempotent) =======================

    /// Registers storage (Treasury on Ref and on both tokens, Ref on both tokens), then
    /// `register_tokens` and validates the pool. Caller attaches SETUP_DEPOSIT.
    #[payable]
    pub fn setup(&mut self) -> Promise {
        require!(
            env::attached_deposit() >= SETUP_DEPOSIT,
            format!("ERR_SETUP_DEPOSIT: attach {} yocto", SETUP_DEPOSIT.as_yoctonear())
        );
        let me = env::current_account_id();
        let c = &self.config;
        ext_ref::ext(c.ref_exchange.clone())
            .with_attached_deposit(REF_STORAGE)
            .with_static_gas(tgas(T_STORAGE))
            .storage_deposit(Some(me.clone()), Some(false))
            .and(ft_storage(&c.usdc_token, &me))
            .and(ft_storage(&c.wnear_token, &me))
            .and(ft_storage(&c.usdc_token, &c.ref_exchange))
            .and(ft_storage(&c.wnear_token, &c.ref_exchange))
            .then(
                Self::ext(me)
                    .with_static_gas(tgas(T_SETUP_STORAGE_CB))
                    .on_setup_storage(),
            )
    }

    #[private]
    pub fn on_setup_storage(&mut self) -> PromiseOrValue<bool> {
        let n = env::promise_results_count();
        let failed: Vec<u64> = (0..n).filter(|i| promise_bytes(*i).is_none()).collect();
        if !failed.is_empty() {
            events::emit("setup_failed", json!({ "stage": "storage", "failed_indexes": failed }));
            return PromiseOrValue::Value(false);
        }
        let c = &self.config;
        PromiseOrValue::Promise(
            ext_ref::ext(c.ref_exchange.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(T_REF_REGISTER))
                .register_tokens(vec![c.usdc_token.clone(), c.wnear_token.clone()])
                .and(
                    ext_ref::ext(c.ref_exchange.clone())
                        .with_static_gas(tgas(T_VIEW))
                        .get_pool(c.pool_id),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(tgas(T_SETUP_DONE))
                        .on_setup_done(),
                ),
        )
    }

    #[private]
    pub fn on_setup_done(&mut self) -> bool {
        if promise_bytes(0).is_none() {
            events::emit("setup_failed", json!({ "stage": "register_tokens" }));
            return false;
        }
        let pool: Option<PoolInfo> = promise_bytes(1).and_then(|b| serde_json::from_slice(&b).ok());
        let Some(pool) = pool else {
            events::emit("setup_failed", json!({ "stage": "get_pool" }));
            return false;
        };
        match self.validate_pool(&pool) {
            Ok(idx) => {
                self.usdc_pool_index = idx;
                self.ready = true;
                events::emit(
                    "setup_done",
                    json!({ "pool_id": self.config.pool_id, "usdc_pool_index": idx }),
                );
                true
            }
            Err(e) => {
                events::emit("setup_failed", json!({ "stage": "pool_validation", "error": e }));
                false
            }
        }
    }

    // ======================= deposit intake (NEP-141 receiver) =======================

    /// Only the configured USDC contract can credit a deposit; everything else is refunded
    /// by returning the full amount (ft_resolve_transfer gives it back to the sender).
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let refuse = |reason: &str| {
            events::emit(
                "deposit_refused",
                json!({ "token": token, "sender_id": sender_id, "amount": amount, "reason": reason }),
            );
            PromiseOrValue::Value(amount)
        };
        if token != self.config.usdc_token {
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
        let deposit = Deposit {
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
            wnear_in_lp: U128(0),
            dust_usdc: U128(0),
            dust_wnear: U128(0),
            unlock_at: None,
            pool_id: None,
            lp_confirmed_at: None,
            lp_confirmed_block: None,
            last_error: None,
            created_at: now,
            updated_at: now,
        };
        self.deposits.insert(id, deposit);
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

    /// Starts or resumes the LP pipeline of `deposit_id` from its current persisted stage.
    /// Attach >= 200 Tgas (300 recommended).
    pub fn execute_lp(&mut self, deposit_id: U64, plan: Option<LpPlan>) -> Promise {
        require!(self.ready, "ERR_NOT_READY");
        require!(self.in_flight.is_none(), "ERR_LP_JOB_IN_FLIGHT");
        let id = deposit_id.0;
        let mut d = self.get_deposit_or_panic(id);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        if let Some(p) = plan {
            validate_plan(&p);
            d.plan = Some(p);
        }
        require!(d.plan.is_some(), "ERR_NO_PLAN");

        let needed = match &d.status {
            DepositStatus::BudgetAllocated => T_DEPOSIT_TOTAL,
            DepositStatus::InRef { .. } => T_SWAP_TOTAL,
            DepositStatus::Swapped { .. } => T_ADD_TOTAL,
            _ => env::panic_str("ERR_NOT_RESUMABLE"),
        };
        require!(env::prepaid_gas() >= tgas(needed + T_SELF), "ERR_NOT_ENOUGH_GAS");

        d.last_error = None;
        let promise = match d.status.clone() {
            DepositStatus::BudgetAllocated => self.launch_amm_deposit(&mut d),
            DepositStatus::InRef { usdc } => self.launch_swap(&mut d, usdc.0),
            DepositStatus::Swapped { usdc, wnear } => self.launch_add_liquidity(&mut d, usdc.0, wnear.0),
            _ => unreachable!(),
        };
        self.save(d);
        promise
    }

    #[private]
    pub fn on_amm_deposit(
        &mut self,
        deposit_id: U64,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> PromiseOrValue<bool> {
        let id = deposit_id.0;
        let Some(mut d) = self.expect_stage(id, |s| matches!(s, DepositStatus::AmmDepositPending)) else {
            return PromiseOrValue::Value(false);
        };
        match used {
            Ok(U128(used)) if used > 0 => {
                let budget = d.lp_budget.0;
                self.pending_budget_total -= budget;
                if used < budget {
                    // Partial acceptance (not expected from Ref): the refunded part returns to the creator's reserve.
                    let back = budget - used;
                    *self.reserves.entry(d.creator.clone()).or_insert(0) += back;
                    self.reserve_total += back;
                }
                self.ref_expected_usdc += used;
                d.status = DepositStatus::InRef { usdc: U128(used) };
                self.emit_stage(&d, "amm_deposit_confirmed");
                let p = self.launch_swap(&mut d, used);
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

    #[private]
    pub fn on_swap(
        &mut self,
        deposit_id: U64,
        #[callback_result] out: Result<U128, PromiseError>,
    ) -> PromiseOrValue<bool> {
        let id = deposit_id.0;
        let Some(mut d) = self.expect_stage(id, |s| matches!(s, DepositStatus::SwapPending { .. })) else {
            return PromiseOrValue::Value(false);
        };
        let DepositStatus::SwapPending { usdc } = d.status.clone() else { unreachable!() };
        match out {
            Ok(U128(wnear)) if wnear > 0 => {
                let swap_in = d.plan.as_ref().expect("plan").swap_amount_in.0;
                self.ref_expected_usdc -= swap_in;
                self.ref_expected_wnear += wnear;
                d.usdc_swapped = U128(swap_in);
                let usdc_left = usdc.0 - swap_in;
                d.status = DepositStatus::Swapped { usdc: U128(usdc_left), wnear: U128(wnear) };
                self.emit_stage(&d, "swap_confirmed");
                let p = self.launch_add_liquidity(&mut d, usdc_left, wnear);
                self.save(d);
                PromiseOrValue::Promise(p)
            }
            _ => {
                d.status = DepositStatus::InRef { usdc };
                self.fail(d, "swap_failed");
                PromiseOrValue::Value(false)
            }
        }
    }

    #[private]
    pub fn on_add_liquidity(
        &mut self,
        deposit_id: U64,
        #[callback_result] shares: Result<U128, PromiseError>,
    ) -> PromiseOrValue<bool> {
        let id = deposit_id.0;
        let Some(mut d) =
            self.expect_stage(id, |s| matches!(s, DepositStatus::AddLiquidityPending { .. }))
        else {
            return PromiseOrValue::Value(false);
        };
        let DepositStatus::AddLiquidityPending { usdc, wnear } = d.status.clone() else { unreachable!() };
        match shares {
            Ok(U128(minted)) if minted > 0 => {
                d.status = DepositStatus::VerifyPending { usdc, wnear, shares: U128(minted) };
                let p = self.verify_promise().then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(tgas(T_CB))
                        .on_verified(deposit_id),
                );
                self.touch_in_flight();
                self.save(d);
                PromiseOrValue::Promise(p)
            }
            _ => {
                d.status = DepositStatus::Swapped { usdc, wnear };
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
        let id = deposit_id.0;
        let Some(d) = self.expect_stage(id, |s| matches!(s, DepositStatus::VerifyPending { .. })) else {
            return false;
        };
        self.finalize_lp(d, shares_now.ok().map(|s| s.0), ref_deposits.ok());
        true
    }

    // ======================= recovery =======================

    /// Re-derives the stage of a stuck in-flight job from Treasury's real Ref balances.
    /// Callable by anyone, only after RECONCILE_TIMEOUT_NS without stage progress.
    pub fn reconcile(&mut self) -> Promise {
        let f = self.in_flight.clone().unwrap_or_else(|| env::panic_str("ERR_NOTHING_IN_FLIGHT"));
        require!(
            env::block_timestamp() >= f.since.0 + RECONCILE_TIMEOUT_NS,
            "ERR_RECONCILE_TOO_EARLY"
        );
        self.verify_promise().then(
            Self::ext(env::current_account_id())
                .with_static_gas(tgas(T_CB))
                .on_reconcile(f.deposit_id, f.since),
        )
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
            _ => return false, // job progressed meanwhile: nothing to reconcile
        }
        let (Ok(U128(shares_now)), Ok(deps)) = (shares_now, ref_deposits) else {
            events::emit("reconcile_failed", json!({ "deposit_id": deposit_id, "reason": "views_failed" }));
            return false;
        };
        let actual_usdc = deps.get(&self.config.usdc_token).map_or(0, |v| v.0);
        let actual_wnear = deps.get(&self.config.wnear_token).map_or(0, |v| v.0);
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
            DepositStatus::SwapPending { usdc } => {
                if actual_wnear > self.ref_expected_wnear {
                    let swap_in = d.plan.as_ref().expect("plan").swap_amount_in.0;
                    let out = actual_wnear - self.ref_expected_wnear;
                    self.ref_expected_usdc -= swap_in;
                    self.ref_expected_wnear = actual_wnear;
                    d.usdc_swapped = U128(swap_in);
                    d.status = DepositStatus::Swapped { usdc: U128(usdc.0 - swap_in), wnear: U128(out) };
                } else {
                    d.status = DepositStatus::InRef { usdc };
                }
            }
            DepositStatus::AddLiquidityPending { usdc, wnear } => {
                if shares_now > self.recorded_shares {
                    d.status = DepositStatus::VerifyPending {
                        usdc,
                        wnear,
                        shares: U128(shares_now - self.recorded_shares),
                    };
                    self.finalize_lp(d, Some(shares_now), Some(deps));
                    return true;
                }
                d.status = DepositStatus::Swapped { usdc, wnear };
            }
            DepositStatus::VerifyPending { .. } => {
                self.finalize_lp(d, Some(shares_now), Some(deps));
                return true;
            }
            _ => {}
        }
        self.emit_stage(&d, "reconciled");
        d.last_error = Some("reconciled_after_timeout".into());
        self.in_flight = None;
        self.save(d);
        true
    }

    // ======================= creator withdrawals =======================

    /// Transfers the creator's 8 % reserve (USDC) back to the creator. 1 yocto.
    #[payable]
    pub fn withdraw_reserve(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let creator = env::predecessor_account_id();
        let bal = self.reserves.get(&creator).copied().unwrap_or(0);
        require!(amount.0 > 0 && amount.0 <= bal, "ERR_INSUFFICIENT_RESERVE");
        self.reserves.insert(creator.clone(), bal - amount.0);
        self.reserve_total -= amount.0;
        ext_ft::ext(self.config.usdc_token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_FT_TRANSFER))
            .ft_transfer(creator.clone(), amount, Some("SOL2NEAR reserve withdrawal".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(T_CB))
                    .on_reserve_withdraw(creator, amount),
            )
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

    /// After the lock, transfers the deposit's LP shares to the creator (Ref MFT ":<pool_id>").
    /// The creator must be registered for the pool shares on Ref (`mft_register`). 1 yocto.
    #[payable]
    pub fn withdraw_lp(&mut self, deposit_id: U64) -> Promise {
        assert_one_yocto();
        require!(self.in_flight.is_none(), "ERR_LP_JOB_IN_FLIGHT");
        let mut d = self.get_deposit_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        require!(d.status == DepositStatus::LpConfirmed, "ERR_NO_CONFIRMED_LP");
        let unlock_at = d.unlock_at.expect("unlock_at").0;
        require!(env::block_timestamp() >= unlock_at, "ERR_LP_LOCKED");
        d.status = DepositStatus::LpWithdrawPending;
        let p = ext_ref::ext(self.config.ref_exchange.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_REF_MFT_TRANSFER))
            .mft_transfer(
                format!(":{}", self.config.pool_id),
                d.creator.clone(),
                d.lp_shares,
                Some("SOL2NEAR LP withdrawal".into()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(T_CB))
                    .on_lp_withdraw(deposit_id),
            );
        self.save(d);
        p
    }

    #[private]
    pub fn on_lp_withdraw(&mut self, deposit_id: U64) -> bool {
        let mut d = self.get_deposit_or_panic(deposit_id.0);
        if d.status != DepositStatus::LpWithdrawPending {
            return false;
        }
        let ok = promise_bytes(0).is_some();
        if ok {
            self.recorded_shares -= d.lp_shares.0;
            d.status = DepositStatus::LpWithdrawn;
            self.emit_stage(&d, "lp_withdrawn");
        } else {
            d.status = DepositStatus::LpConfirmed;
            d.last_error = Some("lp_withdraw_failed".into());
            self.emit_stage(&d, "lp_withdraw_failed");
        }
        self.save(d);
        ok
    }

    // ======================= Proof of Liquidity =======================

    /// Reads Treasury's LP share balance on Ref and records whether it covers all shares
    /// recorded for creators. Anyone can call; the result is an on-chain event + snapshot.
    pub fn verify_liquidity(&mut self) -> Promise {
        ext_ref::ext(self.config.ref_exchange.clone())
            .with_static_gas(tgas(T_VIEW))
            .get_pool_shares(self.config.pool_id, env::current_account_id())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(T_CB))
                    .on_proof(),
            )
    }

    #[private]
    pub fn on_proof(&mut self, #[callback_result] shares: Result<U128, PromiseError>) -> Option<Proof> {
        let U128(onchain) = shares.ok()?;
        let proof = self.record_proof(onchain);
        Some(proof)
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
        }
    }

    pub fn get_deposit(&self, deposit_id: U64) -> Option<Deposit> {
        self.deposits.get(&deposit_id.0).cloned()
    }

    pub fn get_creator_deposits(
        &self,
        creator: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<Deposit> {
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

    pub fn get_accounting(&self) -> Accounting {
        Accounting {
            total_received: U128(self.total_received),
            reserve_total: U128(self.reserve_total),
            community_total: U128(self.community_total),
            pending_budget_total: U128(self.pending_budget_total),
            ref_expected_usdc: U128(self.ref_expected_usdc),
            ref_expected_wnear: U128(self.ref_expected_wnear),
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

impl Treasury {
    fn get_deposit_or_panic(&self, id: u64) -> Deposit {
        self.deposits
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_DEPOSIT"))
    }

    fn save(&mut self, mut d: Deposit) {
        d.updated_at = U64(env::block_timestamp());
        self.deposits.insert(d.id.0, d);
    }

    /// Returns the deposit only if it is the in-flight job and in the expected stage.
    /// Any mismatch (replay, late callback after reconcile) is logged and ignored.
    fn expect_stage(&self, id: u64, ok: impl Fn(&DepositStatus) -> bool) -> Option<Deposit> {
        let in_flight_matches = self.in_flight.as_ref().is_some_and(|f| f.deposit_id.0 == id);
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
        self.in_flight = Some(InFlight { deposit_id: U64(id), since: U64(env::block_timestamp()) });
    }

    fn fail(&mut self, mut d: Deposit, reason: &str) {
        d.last_error = Some(reason.to_string());
        self.in_flight = None;
        self.emit_stage(&d, reason);
        self.save(d);
    }

    fn emit_stage(&self, d: &Deposit, event: &str) {
        events::emit(
            event,
            json!({ "deposit_id": d.id, "creator": d.creator, "status": d.status, "lp_shares": d.lp_shares }),
        );
    }

    fn launch_amm_deposit(&mut self, d: &mut Deposit) -> Promise {
        self.start_or_touch(d.id.0);
        d.status = DepositStatus::AmmDepositPending;
        ext_ft::ext(self.config.usdc_token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_FT_TRANSFER_CALL))
            .ft_transfer_call(self.config.ref_exchange.clone(), d.lp_budget, None, String::new())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(T_CB + T_SWAP_TOTAL))
                    .on_amm_deposit(d.id),
            )
    }

    fn launch_swap(&mut self, d: &mut Deposit, usdc_in_ref: u128) -> Promise {
        let plan = d.plan.clone().expect("plan");
        require!(plan.swap_amount_in.0 < usdc_in_ref, "ERR_SWAP_AMOUNT_TOO_LARGE");
        self.start_or_touch(d.id.0);
        d.status = DepositStatus::SwapPending { usdc: U128(usdc_in_ref) };
        let c = &self.config;
        ext_ref::ext(c.ref_exchange.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_REF_SWAP))
            .swap(
                vec![SwapAction {
                    pool_id: c.pool_id,
                    token_in: c.usdc_token.clone(),
                    amount_in: Some(plan.swap_amount_in),
                    token_out: c.wnear_token.clone(),
                    min_amount_out: plan.min_swap_out,
                }],
                None,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(T_CB + T_ADD_TOTAL))
                    .on_swap(d.id),
            )
    }

    fn launch_add_liquidity(&mut self, d: &mut Deposit, usdc: u128, wnear: u128) -> Promise {
        let plan = d.plan.clone().expect("plan");
        self.start_or_touch(d.id.0);
        d.status = DepositStatus::AddLiquidityPending { usdc: U128(usdc), wnear: U128(wnear) };
        ext_ref::ext(self.config.ref_exchange.clone())
            .with_attached_deposit(ADD_LIQ_DEPOSIT)
            .with_static_gas(tgas(T_REF_ADD_LIQ))
            .add_liquidity(self.config.pool_id, self.pool_order(usdc, wnear), Some(plan.min_amounts))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(tgas(T_CB + T_VERIFY_TOTAL))
                    .on_add_liquidity(d.id),
            )
    }

    fn verify_promise(&self) -> Promise {
        let me = env::current_account_id();
        ext_ref::ext(self.config.ref_exchange.clone())
            .with_static_gas(tgas(T_VIEW))
            .get_pool_shares(self.config.pool_id, me.clone())
            .and(
                ext_ref::ext(self.config.ref_exchange.clone())
                    .with_static_gas(tgas(T_VIEW))
                    .get_deposits(me),
            )
    }

    fn pool_order(&self, usdc: u128, wnear: u128) -> Vec<U128> {
        if self.usdc_pool_index == 0 {
            vec![U128(usdc), U128(wnear)]
        } else {
            vec![U128(wnear), U128(usdc)]
        }
    }

    fn validate_pool(&self, pool: &PoolInfo) -> Result<u8, String> {
        if pool.pool_kind != "SIMPLE_POOL" {
            return Err(format!("pool_kind {}", pool.pool_kind));
        }
        let t = &pool.token_account_ids;
        let (u, w) = (&self.config.usdc_token, &self.config.wnear_token);
        match t.as_slice() {
            [a, b] if a == u && b == w => Ok(0),
            [a, b] if a == w && b == u => Ok(1),
            _ => Err("pool tokens do not match config".into()),
        }
    }

    /// Terminal step of a successful add_liquidity: records shares, dust and the lock.
    /// `shares_now` / `ref_deposits` are the on-chain truth; when a view failed the deposit
    /// is still confirmed from the add_liquidity return value but flagged unverified.
    fn finalize_lp(
        &mut self,
        mut d: Deposit,
        shares_now: Option<u128>,
        ref_deposits: Option<HashMap<AccountId, U128>>,
    ) {
        let DepositStatus::VerifyPending { usdc, wnear, shares } = d.status.clone() else {
            env::panic_str("ERR_BAD_STAGE")
        };
        let minted = shares.0;
        // Verified only if Ref confirmed both the shares AND the amounts consumed (deposit deltas);
        // without the deposits view, usdc_in_lp is an upper bound and must not earn FUEL.
        let verified = ref_deposits.is_some() && shares_now.is_some_and(|s| s >= self.recorded_shares + minted);

        let (used_usdc, used_wnear) = match &ref_deposits {
            Some(deps) => {
                let actual_usdc = deps.get(&self.config.usdc_token).map_or(0, |v| v.0);
                let actual_wnear = deps.get(&self.config.wnear_token).map_or(0, |v| v.0);
                let used_usdc = self.ref_expected_usdc.saturating_sub(actual_usdc).min(usdc.0);
                let used_wnear = self.ref_expected_wnear.saturating_sub(actual_wnear).min(wnear.0);
                (used_usdc, used_wnear)
            }
            // Unknown: assume the whole plan entered the pool (upper bound, no dust claimed).
            None => (usdc.0, wnear.0),
        };
        self.ref_expected_usdc -= used_usdc;
        self.ref_expected_wnear -= used_wnear;

        self.recorded_shares += minted;
        d.lp_shares = shares;
        d.lp_verified = verified;
        d.usdc_in_lp = U128(used_usdc);
        d.wnear_in_lp = U128(used_wnear);
        d.dust_usdc = U128(usdc.0 - used_usdc);
        d.dust_wnear = U128(wnear.0 - used_wnear);
        d.unlock_at = Some(U64(env::block_timestamp() + self.config.lp_lock_duration_ns.0));
        d.pool_id = Some(self.config.pool_id);
        d.lp_confirmed_at = Some(U64(env::block_timestamp()));
        d.lp_confirmed_block = Some(U64(env::block_height()));
        d.status = DepositStatus::LpConfirmed;
        self.in_flight = None;
        if let Some(s) = shares_now {
            self.record_proof(s);
        }
        events::emit(
            "lp_confirmed",
            json!({
                "deposit_id": d.id, "creator": d.creator, "pool_id": self.config.pool_id,
                "shares": d.lp_shares, "verified": verified,
                "usdc_in_lp": d.usdc_in_lp, "wnear_in_lp": d.wnear_in_lp,
                "dust_usdc": d.dust_usdc, "dust_wnear": d.dust_wnear, "unlock_at": d.unlock_at,
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
                "pool_id": self.config.pool_id, "onchain_shares": proof.onchain_shares,
                "recorded_shares": proof.recorded_shares, "ok": proof.ok,
                "block_height": proof.block_height,
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

fn validate_plan(p: &LpPlan) {
    require!(p.swap_amount_in.0 > 0, "ERR_PLAN_SWAP_ZERO");
    require!(p.min_swap_out.0 > 0, "ERR_PLAN_NO_SLIPPAGE_GUARD");
    require!(p.min_amounts.len() == 2, "ERR_PLAN_MIN_AMOUNTS_LEN");
}

/// Bytes of a successful promise result, None if it failed.
fn promise_bytes(index: u64) -> Option<Vec<u8>> {
    #[allow(deprecated)]
    match env::promise_result(index) {
        near_sdk::PromiseResult::Successful(b) => Some(b),
        _ => None,
    }
}
