//! SOL2NEAR TreasuryDCL — V4.2A Rhea DCL adapter. LOCAL ONLY, NOT DEPLOYED.
//!
//! Separate crate and (if ever deployed) separate account. The V3 Treasury, FUEL and the V4.1 TreasuryV4
//! (Classic) are untouched. Option A of docs/V4_2A_DCL_FEASIBILITY.md §6: the DCL strategy is a module of an
//! isolated Treasury version, so the position NFT and the funds never leave the contract that books them
//! (no second custody contract, no cross-contract authorisation to trust).
//!
//! Flow (every stage persisted, `#[private]` stage-checked callbacks, one job at a time):
//! 1. USDC `ft_transfer_call` → 90/8/2 split (unchanged ledger).
//! 2. `execute_dcl_lp(plan)` (creator): DCL `get_pool` + 4 `quote`s → on-chain guards (pool identity, no pool
//!    tax, price strictly inside the range, min outs vs quotes, swap price impact) → ONE USDC
//!    `ft_transfer_call` carrying a DCL `HotZap` (USDC→X and USDC→Y along routes fixed at init, then
//!    add_liquidity) → `list_liquidities` finds the new position (owner = Treasury, pool, range) →
//!    `get_liquidity_view` + `list_user_assets` record the position amounts and this deposit's leftovers.
//! 3. `claim_fees` (remove_liquidity amount 0): fees booked from DCL's own return value.
//! 4. Exit after the lock: `withdraw_position` = NEP-171 `nft_transfer` of the position to the creator,
//!    verified with `get_liquidity.owner_id`. Leftovers / claimed fees: `withdraw_dex_balance` then `withdraw_token`.
//! 5. `reconcile` re-derives any stuck stage from DCL / token state after a timeout.
//!
//! Taxed tokens (Nearly `get_tax` with buy or sell bps > 0) and pools with a DCL pool-level tax are refused
//! in `setup`. Positions are FUEL_NOT_ELIGIBLE: the deployed FUEL reads only the V3 Treasury / pool 2951.

mod events;
mod external;
mod ledger;
pub mod plan;
mod types;

#[cfg(test)]
mod tests;

use external::{ext_dcl, ext_ft};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};
use std::collections::HashMap;
pub use types::*;

// ---------- gas budget (Tgas) ----------
const T_VIEW: u64 = 5;
/// DCL quote walks the pool points: measured above 5 Tgas for a 2-hop route in the local sandbox.
const T_QUOTE: u64 = 15;
/// DCL predict_hotzap (3 swaps + an add_liquidity simulation).
const T_PREDICT: u64 = 40;
const T_LIST: u64 = 15;
const T_LIST_WIDE: u64 = 60;
const T_CB: u64 = 10;
/// The USDC ft_transfer_call carrying the HotZap (3 swaps + add_liquidity); its own burn is measured in the sandbox.
const T_ZAP: u64 = 80;
const T_FT_TRANSFER: u64 = 15;
const T_STORAGE: u64 = 10;
const T_DCL_CALL: u64 = 40;
const T_CONFIRM_TOTAL: u64 = 2 * T_VIEW + T_CB;
const T_LOOKUP_TOTAL: u64 = T_LIST + T_CB + T_CONFIRM_TOTAL;
const T_ZAP_CB: u64 = T_CB + T_LOOKUP_TOTAL;
const T_PREFLIGHT_CB: u64 = T_CB + T_ZAP + T_ZAP_CB;
const T_EXECUTE: u64 = T_VIEW + T_PREDICT + 2 * T_QUOTE + T_PREFLIGHT_CB;
const T_SETUP_DONE: u64 = T_CB;
const T_SETUP_STORAGE_CB: u64 = T_CB + T_STORAGE + 12 * T_VIEW + T_SETUP_DONE;
const T_SELF: u64 = 15;

const fn tgas(t: u64) -> Gas {
    Gas::from_tgas(t)
}

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const FT_STORAGE: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
/// DCL v2.4.2 storage_balance_bounds.min (0.5 NEAR: 0.1 for assets + 40 position/order slots at 0.01).
const DCL_STORAGE: NearToken = NearToken::from_millinear(500);
/// DCL v2.4.2 register_tokens storage (measured: 1 yocto is refused with E104; 0.1 NEAR covers 3 tokens).
const DCL_REGISTER: NearToken = NearToken::from_millinear(100);
pub const SETUP_DEPOSIT: NearToken =
    NearToken::from_yoctonear(DCL_STORAGE.as_yoctonear() + DCL_REGISTER.as_yoctonear() + 6 * FT_STORAGE.as_yoctonear());

pub const RECONCILE_TIMEOUT_NS: u64 = 10 * 60 * 1_000_000_000;
pub const MAX_SLIPPAGE_CEILING_BPS: u16 = 500;
pub const MAX_IMPACT_CEILING_BPS: u16 = 2_000;
pub const MAX_PLAN_TTL_CEILING_NS: u64 = 60 * 60 * 1_000_000_000;
const MAX_MARKS: usize = 24;
pub const FUEL_STATUS: &str = "FUEL_NOT_ELIGIBLE";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Deposits,
    CreatorDeposits,
    Balances,
    LptIndex,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TreasuryDcl {
    config: Config,
    ready: bool,
    setup_error: Option<String>,
    next_deposit_id: u64,
    deposits: LookupMap<u64, DclDeposit>,
    creator_deposits: LookupMap<AccountId, Vec<u64>>,
    /// Owed to creators, held by Treasury on the token contract: key `creator|token`.
    balances: LookupMap<String, u128>,
    /// lpt_id → deposit id, for every position this Treasury ever recorded.
    lpt_index: LookupMap<String, u64>,
    total_received: u128,
    community_total: u128,
    /// LP budgets still in Treasury's USDC balance.
    pending_budget_total: u128,
    /// USDC sent with a zap whose outcome is not known yet.
    zap_outstanding: u128,
    /// Sum of creator balances per token (USDC reserves included).
    owed_usdc: u128,
    owed_x: u128,
    owed_y: u128,
    /// Sum of the deposits' balances inside Treasury's DCL account.
    dex_booked_usdc: u128,
    dex_booked_x: u128,
    dex_booked_y: u128,
    /// Positions currently owned by Treasury on the DCL.
    live_positions: u64,
    in_flight: Option<InFlight>,
}

fn network_suffix(network: &str) -> &'static str {
    match network {
        "testnet" => ".testnet",
        "sandbox" => ".test.near",
        _ => env::panic_str("ERR_NETWORK: testnet or sandbox only"),
    }
}

#[near]
impl TreasuryDcl {
    #[init]
    pub fn new(network: String, pool: DclPoolConfig, min_deposit: U128, lock_duration_ns: U64, guards: DclGuards) -> Self {
        let sfx = network_suffix(&network);
        for a in [&env::current_account_id(), &pool.dex, &pool.usdc_token, &pool.token_x, &pool.token_y] {
            require!(a.as_str().ends_with(sfx), format!("ERR_NETWORK_ACCOUNT: {a} is not a {network} account"));
        }
        require!(pool.token_x != pool.token_y, "ERR_SAME_TOKENS");
        require!(pool.usdc_token != pool.token_x && pool.usdc_token != pool.token_y, "ERR_USDC_IN_POOL_UNSUPPORTED");
        require!(pool.pool_id == format!("{}|{}|{}", pool.token_x, pool.token_y, pool.fee), "ERR_POOL_ID_FORMAT");
        require!(pool.point_delta > 0, "ERR_POINT_DELTA");
        require!(pool.x_decimals <= 24 && pool.y_decimals <= 24 && pool.usdc_decimals <= 24, "ERR_DECIMALS");
        for r in [&pool.route_x, &pool.route_y] {
            require!(!r.is_empty() && r.len() <= plan::MAX_ROUTE_HOPS, "ERR_ROUTE_LENGTH");
        }
        require!(min_deposit.0 > 0, "ERR_MIN_DEPOSIT_ZERO");
        require!(guards.max_slippage_bps > 0 && guards.max_slippage_bps <= MAX_SLIPPAGE_CEILING_BPS, "ERR_GUARD_SLIPPAGE");
        require!(guards.max_price_impact_bps > 0 && guards.max_price_impact_bps <= MAX_IMPACT_CEILING_BPS, "ERR_GUARD_IMPACT");
        require!(guards.max_plan_ttl_ns.0 > 0 && guards.max_plan_ttl_ns.0 <= MAX_PLAN_TTL_CEILING_NS, "ERR_GUARD_TTL");
        require!(
            guards.min_range_width >= 2 * pool.point_delta && guards.min_range_width <= guards.max_range_width,
            "ERR_GUARD_RANGE_WIDTH"
        );
        Self {
            config: Config { network, pool, min_deposit, lock_duration_ns, guards },
            ready: false,
            setup_error: None,
            next_deposit_id: 0,
            deposits: LookupMap::new(StorageKey::Deposits),
            creator_deposits: LookupMap::new(StorageKey::CreatorDeposits),
            balances: LookupMap::new(StorageKey::Balances),
            lpt_index: LookupMap::new(StorageKey::LptIndex),
            total_received: 0,
            community_total: 0,
            pending_budget_total: 0,
            zap_outstanding: 0,
            owed_usdc: 0,
            owed_x: 0,
            owed_y: 0,
            dex_booked_usdc: 0,
            dex_booked_x: 0,
            dex_booked_y: 0,
            live_positions: 0,
            in_flight: None,
        }
    }

    // ======================= setup (permissionless, idempotent) =======================

    /// Storage on the DCL and the three tokens, DCL token registration, then reads every pool and token
    /// the config names. `ready` only if all of them match (identity, fee, point_delta, Running, no pool
    /// tax, routes connect, decimals, no Nearly token tax).
    #[payable]
    pub fn setup(&mut self) -> Promise {
        require!(env::attached_deposit() >= SETUP_DEPOSIT, format!("ERR_SETUP_DEPOSIT: attach {} yocto", SETUP_DEPOSIT.as_yoctonear()));
        let me = env::current_account_id();
        let p = &self.config.pool;
        ext_dcl::ext(p.dex.clone())
            .with_attached_deposit(DCL_STORAGE)
            .with_static_gas(tgas(T_STORAGE))
            .storage_deposit(Some(me.clone()), Some(false))
            .and(ft_storage(&p.usdc_token, &me))
            .and(ft_storage(&p.token_x, &me))
            .and(ft_storage(&p.token_y, &me))
            .and(ft_storage(&p.usdc_token, &p.dex))
            .and(ft_storage(&p.token_x, &p.dex))
            .and(ft_storage(&p.token_y, &p.dex))
            .then(Self::ext(me).with_static_gas(tgas(T_SETUP_STORAGE_CB)).on_setup_storage())
    }

    #[private]
    pub fn on_setup_storage(&mut self) -> PromiseOrValue<bool> {
        let n = env::promise_results_count();
        let failed: Vec<u64> = (0..n).filter(|i| promise_bytes(*i).is_none()).collect();
        if !failed.is_empty() {
            return PromiseOrValue::Value(self.setup_fail("storage", format!("failed indexes {failed:?}")));
        }
        let p = self.config.pool.clone();
        let dex = || ext_dcl::ext(p.dex.clone()).with_static_gas(tgas(T_VIEW));
        let ft = |t: &AccountId| ext_ft::ext(t.clone()).with_static_gas(tgas(T_VIEW));
        // 0 register, 1 target pool, 2..5 metadata usdc/x/y + tax x, 6 tax y, 7.. route pools (x then y)
        let mut chain = ext_dcl::ext(p.dex.clone())
            .with_attached_deposit(DCL_REGISTER)
            .with_static_gas(tgas(T_STORAGE))
            .register_tokens(vec![p.usdc_token.clone(), p.token_x.clone(), p.token_y.clone()])
            .and(dex().get_pool(p.pool_id.clone()))
            .and(ft(&p.usdc_token).ft_metadata())
            .and(ft(&p.token_x).ft_metadata())
            .and(ft(&p.token_y).ft_metadata())
            .and(ft(&p.token_x).get_tax())
            .and(ft(&p.token_y).get_tax());
        for id in p.route_x.iter().chain(p.route_y.iter()) {
            chain = chain.and(dex().get_pool(id.clone()));
        }
        PromiseOrValue::Promise(chain.then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_SETUP_DONE)).on_setup_done()))
    }

    #[private]
    pub fn on_setup_done(&mut self) -> bool {
        if promise_bytes(0).is_none() {
            return self.setup_fail("register_tokens", "DCL register_tokens failed".into());
        }
        let json_at = |i: u64| promise_bytes(i).and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        let pool_at = |i: u64| promise_bytes(i).and_then(|b| serde_json::from_slice::<DclPoolView>(&b).ok());
        let p = self.config.pool.clone();
        let verdict = (|| -> Result<(), String> {
            let target = pool_at(1).ok_or("target get_pool failed")?;
            plan::check_target_pool(&p, &target)?;
            for (i, want, name) in [(2, p.usdc_decimals, "usdc"), (3, p.x_decimals, "x"), (4, p.y_decimals, "y")] {
                let d = json_at(i).and_then(|m| m["decimals"].as_u64()).ok_or(format!("ft_metadata {name} failed"))?;
                if d != want as u64 {
                    return Err(format!("decimals {name}={d} differ from config {want}"));
                }
            }
            // a failed get_tax promise = method absent = no Nearly-style tax; a readable tax with bps > 0 = refused
            plan::tax_verdict(json_at(5).as_ref()).map_err(|e| format!("token_x {e}"))?;
            plan::tax_verdict(json_at(6).as_ref()).map_err(|e| format!("token_y {e}"))?;
            let nx = p.route_x.len() as u64;
            let rx: Vec<DclPoolView> = (0..nx).map(|k| pool_at(7 + k)).collect::<Option<_>>().ok_or("route_x get_pool failed")?;
            let ry: Vec<DclPoolView> =
                (0..p.route_y.len() as u64).map(|k| pool_at(7 + nx + k)).collect::<Option<_>>().ok_or("route_y get_pool failed")?;
            plan::check_route(&p.route_x, &rx, p.usdc_token.as_str(), p.token_x.as_str())?;
            plan::check_route(&p.route_y, &ry, p.usdc_token.as_str(), p.token_y.as_str())?;
            Ok(())
        })();
        match verdict {
            Ok(()) => {
                self.ready = true;
                self.setup_error = None;
                events::emit("setup_done", json!({ "pool_id": p.pool_id, "route_x": p.route_x, "route_y": p.route_y }));
                true
            }
            Err(e) => self.setup_fail("validation", e),
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
        let p = &self.config.pool;
        let mut d = DclDeposit {
            id: U64(id),
            creator: sender_id.clone(),
            amount,
            lp_budget: U128(s.lp),
            reserve: U128(s.reserve),
            community: U128(s.community),
            status: DclStatus::BudgetAllocated,
            plan: None,
            dex: p.dex.clone(),
            pool_id: p.pool_id.clone(),
            token_x: p.token_x.clone(),
            token_y: p.token_y.clone(),
            usdc_used: U128(0),
            usdc_unused_to_reserve: U128(0),
            lpt_id: None,
            left_point: None,
            right_point: None,
            liquidity: U128(0),
            position_x: U128(0),
            position_y: U128(0),
            dex_x: U128(0),
            dex_y: U128(0),
            dex_usdc: U128(0),
            fees_claimed_x: U128(0),
            fees_claimed_y: U128(0),
            recovered_x: U128(0),
            recovered_y: U128(0),
            recovered_usdc: U128(0),
            unlock_at: None,
            confirmed_block: None,
            last_error: None,
            marks: vec![],
            created_at: now,
            updated_at: now,
        };
        mark(&mut d, "deposit_allocated");
        self.deposits.insert(id, d);
        self.creator_deposits.entry(sender_id.clone()).or_default().push(id);
        let usdc = self.config.pool.usdc_token.clone();
        self.credit(&sender_id, &usdc, s.reserve);
        self.total_received += amount.0;
        self.community_total += s.community;
        self.pending_budget_total += s.lp;
        events::emit(
            "deposit_allocated",
            json!({ "deposit_id": U64(id), "creator": sender_id, "amount": amount, "lp_budget": U128(s.lp), "reserve": U128(s.reserve), "community": U128(s.community) }),
        );
        PromiseOrValue::Value(U128(0))
    }

    // ======================= position creation (creator-signed) =======================

    /// Attach 300 Tgas. The plan is validated now, and again against live DCL views before anything is sent.
    pub fn execute_dcl_lp(&mut self, deposit_id: U64, plan: DclPlan) -> Promise {
        require!(self.ready, "ERR_NOT_READY");
        require!(self.in_flight.is_none(), "ERR_JOB_IN_FLIGHT");
        let mut d = self.get_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        require!(d.status == DclStatus::BudgetAllocated, "ERR_NOT_EXECUTABLE");
        if let Err(e) = plan::check_plan(&self.config, &plan, d.lp_budget.0, env::block_timestamp()) {
            env::panic_str(e);
        }
        require!(env::prepaid_gas() >= tgas(T_EXECUTE + T_SELF), "ERR_NOT_ENOUGH_GAS");
        d.plan = Some(plan.clone());
        d.last_error = None;
        d.status = DclStatus::PreflightPending;
        self.start_job(deposit_id, Job::Lp);
        self.emit_stage(&mut d, "preflight_started");
        self.save(d);
        let p = &self.config.pool;
        let q = |route: &Vec<String>, out: &AccountId, amount: u128| {
            ext_dcl::ext(p.dex.clone()).with_static_gas(tgas(T_QUOTE)).quote(route.clone(), p.usdc_token.clone(), out.clone(), U128(amount), None)
        };
        let small = |a: u128| (a / 1_000).max(1);
        let (swap_infos, add_infos) = plan::hotzap_parts(p, &plan);
        let spend = U128(plan.usdc_to_x.0 + plan.usdc_to_y.0);
        ext_dcl::ext(p.dex.clone())
            .with_static_gas(tgas(T_VIEW))
            .get_pool(p.pool_id.clone())
            .and(ext_dcl::ext(p.dex.clone()).with_static_gas(tgas(T_PREDICT)).predict_hotzap(p.usdc_token.clone(), spend, swap_infos, add_infos))
            .and(q(&p.route_x, &p.token_x, small(plan.usdc_to_x.0)))
            .and(q(&p.route_y, &p.token_y, small(plan.usdc_to_y.0)))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_PREFLIGHT_CB)).on_preflight(deposit_id))
    }

    #[private]
    pub fn on_preflight(&mut self, deposit_id: U64) -> PromiseOrValue<bool> {
        let Some(mut d) = self.expect_stage(deposit_id.0, Job::Lp, |s| matches!(s, DclStatus::PreflightPending)) else {
            return PromiseOrValue::Value(false);
        };
        let plan = d.plan.clone().expect("plan");
        let pool = promise_bytes(0).and_then(|b| serde_json::from_slice::<DclPoolView>(&b).ok());
        let qa = |i: u64| promise_bytes(i).and_then(|b| serde_json::from_slice::<DclQuote>(&b).ok()).map(|q| q.amount.0);
        let pred = promise_bytes(1).and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| plan::parse_predict(&v, &self.config.pool));
        let verdict = match (pool, pred, qa(2), qa(3)) {
            (Some(pool), Some(pr), Some(qxs), Some(qys)) => plan::check_preflight(&self.config, &plan, &pool, &pr, qxs, qys).map(|_| pool.current_point),
            // the pool read is enough to give the real reason (predict_hotzap itself panics on an out-of-range plan)
            (Some(pool), _, _, _) if plan::check_entry(&self.config, &plan, &pool).is_err() => {
                plan::check_entry(&self.config, &plan, &pool).map(|_| pool.current_point)
            }
            (Some(_), None, _, _) => Err("DCL predict_hotzap refused this plan (its own range / min_amount / slippage checks): nothing sent".into()),
            (pool, a, b, c) => Err(format!(
                "preflight views failed (get_pool {} predict_hotzap {} quote_x_small {} quote_y_small {})",
                pool.is_some(), a.is_some(), b.is_some(), c.is_some()
            )),
        };
        let current_point = match verdict {
            Ok(c) => c,
            Err(e) => {
                d.status = DclStatus::BudgetAllocated;
                self.fail(d, &format!("guard: {e}"));
                return PromiseOrValue::Value(false);
            }
        };
        if env::block_timestamp() > plan.deadline_ns.0 {
            d.status = DclStatus::BudgetAllocated;
            self.fail(d, "guard: plan expired before the zap");
            return PromiseOrValue::Value(false);
        }
        let spend = plan.usdc_to_x.0 + plan.usdc_to_y.0;
        self.pending_budget_total -= spend;
        self.zap_outstanding += spend;
        d.status = DclStatus::ZapPending { sent: U128(spend) };
        self.touch();
        mark(&mut d, "zap_sent");
        events::emit("zap_sent", json!({ "deposit_id": d.id, "usdc": U128(spend), "current_point": current_point, "left_point": plan.left_point, "right_point": plan.right_point }));
        self.save(d);
        let p = &self.config.pool;
        PromiseOrValue::Promise(
            ext_ft::ext(p.usdc_token.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(tgas(T_ZAP))
                .ft_transfer_call(p.dex.clone(), U128(spend), None, plan::hotzap_msg(p, &plan))
                .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_ZAP_CB)).on_zap(deposit_id)),
        )
    }

    #[private]
    pub fn on_zap(&mut self, deposit_id: U64, #[callback_result] used: Result<U128, PromiseError>) -> PromiseOrValue<bool> {
        let Some(mut d) = self.expect_stage(deposit_id.0, Job::Lp, |s| matches!(s, DclStatus::ZapPending { .. })) else {
            return PromiseOrValue::Value(false);
        };
        let DclStatus::ZapPending { sent } = d.status.clone() else { unreachable!() };
        match used {
            Ok(U128(u)) if u > 0 => {
                self.settle_zap_usdc(&mut d, sent.0, u);
                d.status = DclStatus::LookupPending { used: U128(u) };
                self.touch();
                self.emit_stage(&mut d, "zap_confirmed");
                self.save(d);
                PromiseOrValue::Promise(self.lookup(deposit_id, false))
            }
            Ok(_) => {
                // the DCL refused the whole HotZap (E204 slippage, range, storage...): the token refunded everything
                self.pending_budget_total += sent.0;
                self.zap_outstanding -= sent.0;
                d.status = DclStatus::BudgetAllocated;
                self.fail(d, "zap_refused_by_dcl_refunded");
                PromiseOrValue::Value(false)
            }
            Err(_) => {
                // outcome unknown (ft_resolve failed): leave the job in flight for `reconcile`
                d.last_error = Some("zap_result_unreadable: reconcile".into());
                self.save(d);
                PromiseOrValue::Value(false)
            }
        }
    }

    #[private]
    pub fn on_lookup(&mut self, deposit_id: U64, #[callback_result] rows: Result<Vec<DclLiquidityRow>, PromiseError>) -> PromiseOrValue<bool> {
        let Some(mut d) = self.expect_stage(deposit_id.0, Job::Lp, |s| matches!(s, DclStatus::LookupPending { .. })) else {
            return PromiseOrValue::Value(false);
        };
        let DclStatus::LookupPending { used } = d.status.clone() else { unreachable!() };
        let plan = d.plan.clone().expect("plan");
        let me = env::current_account_id();
        let found = rows.ok().and_then(|rows| {
            plan::find_new_position(&rows, me.as_str(), &d.pool_id, plan.left_point, plan.right_point, |id| self.lpt_index.contains_key(id))
                .cloned()
        });
        let Some(row) = found else {
            d.last_error = Some("position_not_found_yet: reconcile".into());
            self.save(d);
            return PromiseOrValue::Value(false);
        };
        self.record_position(&mut d, &row, used);
        self.emit_stage(&mut d, "position_found");
        self.save(d);
        PromiseOrValue::Promise(self.confirm_reads(deposit_id, row.lpt_id))
    }

    #[private]
    pub fn on_confirm(
        &mut self,
        deposit_id: U64,
        #[callback_result] view: Result<Option<DclLiquidityView>, PromiseError>,
        #[callback_result] assets: Result<HashMap<AccountId, U128>, PromiseError>,
    ) -> bool {
        let Some(mut d) = self.expect_stage(deposit_id.0, Job::Lp, |s| matches!(s, DclStatus::ConfirmPending { .. })) else {
            return false;
        };
        let me = env::current_account_id();
        let (Ok(Some(v)), Ok(assets)) = (view, assets) else {
            d.last_error = Some("confirm_views_failed: reconcile".into());
            self.save(d);
            return false;
        };
        if v.owner_id != me || Some(&v.lpt_id) != d.lpt_id.as_ref() || v.amount.0 == 0 {
            d.last_error = Some(format!("position check failed: owner {} amount {}", v.owner_id, v.amount.0));
            self.save(d);
            return false;
        }
        d.position_x = v.token_x;
        d.position_y = v.token_y;
        d.liquidity = v.amount;
        self.book_dex_delta(&mut d, &assets);
        let now = env::block_timestamp();
        d.unlock_at = Some(U64(now + self.config.lock_duration_ns.0));
        d.confirmed_block = Some(U64(env::block_height()));
        d.status = DclStatus::PositionConfirmed;
        d.last_error = None;
        self.in_flight = None;
        mark(&mut d, "position_confirmed");
        events::emit(
            "position_confirmed",
            json!({
                "deposit_id": d.id, "creator": d.creator, "dex": d.dex, "pool_id": d.pool_id, "lpt_id": d.lpt_id,
                "left_point": d.left_point, "right_point": d.right_point, "liquidity": d.liquidity,
                "position_x": d.position_x, "position_y": d.position_y, "usdc_used": d.usdc_used,
                "leftover_x": d.dex_x, "leftover_y": d.dex_y, "leftover_usdc": d.dex_usdc, "unlock_at": d.unlock_at, "fuel": FUEL_STATUS,
            }),
        );
        self.save(d);
        true
    }

    // ======================= fees =======================

    /// Claims the position's fees into Treasury's DCL account (DCL remove_liquidity with amount 0) and books
    /// them to this deposit from DCL's own return value. A second claim books 0. Attach 100 Tgas.
    pub fn claim_fees(&mut self, deposit_id: U64) -> Promise {
        require!(self.in_flight.is_none(), "ERR_JOB_IN_FLIGHT");
        let mut d = self.get_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        require!(d.status == DclStatus::PositionConfirmed, "ERR_NO_CONFIRMED_POSITION");
        let lpt = d.lpt_id.clone().expect("lpt");
        d.status = DclStatus::FeeClaimPending;
        self.start_job(deposit_id, Job::FeeClaim);
        mark(&mut d, "fee_claim_started");
        self.save(d);
        ext_dcl::ext(self.config.pool.dex.clone())
            .with_static_gas(tgas(T_DCL_CALL))
            .remove_liquidity(lpt, U128(0), U128(0), U128(0), Some(true))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_fees(deposit_id))
    }

    #[private]
    pub fn on_fees(&mut self, deposit_id: U64, #[callback_result] r: Result<Vec<U128>, PromiseError>) -> bool {
        let Some(mut d) = self.expect_stage(deposit_id.0, Job::FeeClaim, |s| matches!(s, DclStatus::FeeClaimPending)) else {
            return false;
        };
        d.status = DclStatus::PositionConfirmed;
        match r {
            Ok(v) if v.len() == 2 => {
                self.book_fees(&mut d, v[0].0, v[1].0);
                self.in_flight = None;
                self.save(d);
                true
            }
            _ => {
                // DCL panicked (nothing moved) — or the result was lost: reconcile also checks balances
                self.fail(d, "fee_claim_failed");
                false
            }
        }
    }

    // ======================= exit =======================

    /// After the lock: NEP-171 transfer of the position NFT to the creator, then DCL `get_liquidity` must show
    /// the creator as owner. Unclaimed fees travel with the position. Attach 1 yocto and 100 Tgas.
    #[payable]
    pub fn withdraw_position(&mut self, deposit_id: U64) -> Promise {
        assert_one_yocto();
        require!(self.in_flight.is_none(), "ERR_JOB_IN_FLIGHT");
        let mut d = self.get_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        require!(d.status == DclStatus::PositionConfirmed, "ERR_NO_CONFIRMED_POSITION");
        require!(env::block_timestamp() >= d.unlock_at.map(|u| u.0).unwrap_or(u64::MAX), "ERR_POSITION_LOCKED");
        let lpt = d.lpt_id.clone().expect("lpt");
        d.status = DclStatus::TransferPending;
        self.start_job(deposit_id, Job::Transfer);
        mark(&mut d, "position_transfer_started");
        let creator = d.creator.clone();
        self.save(d);
        let dex = self.config.pool.dex.clone();
        ext_dcl::ext(dex.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_DCL_CALL))
            .nft_transfer(creator, lpt.clone(), None, Some("SOL2NEAR TreasuryDCL exit".into()))
            .then(ext_dcl::ext(dex).with_static_gas(tgas(T_VIEW)).get_liquidity(lpt))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_transfer_checked(deposit_id))
    }

    #[private]
    pub fn on_transfer_checked(&mut self, deposit_id: U64, #[callback_result] row: Result<Option<DclLiquidityRow>, PromiseError>) -> bool {
        let Some(mut d) = self.expect_stage(deposit_id.0, Job::Transfer, |s| matches!(s, DclStatus::TransferPending)) else {
            return false;
        };
        match row {
            Ok(Some(r)) if r.owner_id == d.creator => {
                d.status = DclStatus::PositionWithdrawn;
                self.live_positions = self.live_positions.saturating_sub(1);
                self.in_flight = None;
                mark(&mut d, "position_withdrawn");
                events::emit("position_withdrawn", json!({ "deposit_id": d.id, "creator": d.creator, "lpt_id": d.lpt_id, "liquidity": r.amount }));
                self.save(d);
                true
            }
            Ok(Some(r)) if r.owner_id == env::current_account_id() => {
                d.status = DclStatus::PositionConfirmed;
                self.fail(d, "nft_transfer_failed_position_still_held");
                false
            }
            _ => {
                d.last_error = Some("transfer_check_unreadable: reconcile".into());
                self.save(d);
                false
            }
        }
    }

    /// Moves THIS deposit's balance of `token_id` (zap leftovers + claimed fees) from Treasury's DCL account to
    /// Treasury, then credits the creator only if DCL `get_user_asset` dropped by the amount. Attach 1 yocto, 150 Tgas.
    #[payable]
    pub fn withdraw_dex_balance(&mut self, deposit_id: U64, token_id: AccountId) -> Promise {
        assert_one_yocto();
        require!(self.in_flight.is_none(), "ERR_JOB_IN_FLIGHT");
        let d = self.get_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        require!(
            matches!(d.status, DclStatus::PositionConfirmed | DclStatus::PositionWithdrawn | DclStatus::Aborted),
            "ERR_NOT_RECOVERABLE_NOW"
        );
        let amount = self.dex_of(&d, &token_id);
        require!(amount > 0, "ERR_NOTHING_TO_WITHDRAW");
        self.start_job(deposit_id, Job::DexWithdraw { token: token_id.clone(), amount: U128(amount) });
        let dex = self.config.pool.dex.clone();
        ext_dcl::ext(dex.clone())
            .with_static_gas(tgas(T_DCL_CALL))
            .withdraw_asset(token_id.clone(), Some(U128(amount)), Some(true))
            .then(ext_dcl::ext(dex).with_static_gas(tgas(T_VIEW)).get_user_asset(env::current_account_id(), token_id.clone()))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_dex_withdrawn(deposit_id, token_id, U128(amount)))
    }

    #[private]
    pub fn on_dex_withdrawn(
        &mut self,
        deposit_id: U64,
        token_id: AccountId,
        amount: U128,
        #[callback_result] after: Result<Option<U128>, PromiseError>,
    ) -> bool {
        let job = Job::DexWithdraw { token: token_id.clone(), amount };
        if !self.in_flight.as_ref().is_some_and(|f| f.deposit_id == deposit_id && f.job == job) {
            events::emit("callback_ignored", json!({ "deposit_id": deposit_id, "job": "dex_withdraw" }));
            return false;
        }
        let Ok(after) = after else {
            return false; // unreadable: stays in flight for reconcile
        };
        self.settle_dex_withdraw(deposit_id, &token_id, amount.0, after.map(|a| a.0).unwrap_or(0))
    }

    /// Sends the caller's own Treasury balance of `token_id` (USDC reserve included) to the caller. Re-credited on failure.
    #[payable]
    pub fn withdraw_token(&mut self, token_id: AccountId, amount: U128) -> Promise {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let key = bal_key(&who, &token_id);
        let have = self.balances.get(&key).copied().unwrap_or(0);
        require!(amount.0 > 0 && amount.0 <= have, "ERR_INSUFFICIENT_BALANCE");
        self.debit(&who, &token_id, amount.0);
        ext_ft::ext(token_id.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(tgas(T_FT_TRANSFER))
            .ft_transfer(who.clone(), amount, Some("SOL2NEAR TreasuryDCL".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_token_sent(who, token_id, amount))
    }

    #[private]
    pub fn on_token_sent(&mut self, who: AccountId, token_id: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if r.is_ok() {
            events::emit("token_withdrawn", json!({ "account": who, "token": token_id, "amount": amount }));
            true
        } else {
            self.credit(&who, &token_id, amount.0);
            events::emit("token_withdraw_failed", json!({ "account": who, "token": token_id, "amount": amount }));
            false
        }
    }

    /// Before any zap: gives the LP budget back to the creator's USDC balance.
    pub fn abort(&mut self, deposit_id: U64) {
        require!(!self.in_flight.as_ref().is_some_and(|f| f.deposit_id == deposit_id), "ERR_JOB_IN_FLIGHT");
        let mut d = self.get_or_panic(deposit_id.0);
        require!(env::predecessor_account_id() == d.creator, "ERR_NOT_CREATOR");
        require!(d.status == DclStatus::BudgetAllocated, "ERR_NOT_ABORTABLE");
        self.pending_budget_total -= d.lp_budget.0;
        let usdc = self.config.pool.usdc_token.clone();
        self.credit(&d.creator, &usdc, d.lp_budget.0);
        d.usdc_unused_to_reserve = d.lp_budget;
        d.status = DclStatus::Aborted;
        self.emit_stage(&mut d, "lp_aborted");
        self.save(d);
    }

    // ======================= recovery =======================

    /// Anyone, once the job made no progress for RECONCILE_TIMEOUT_NS. Re-derives the stage from DCL / token state.
    pub fn reconcile(&mut self) -> PromiseOrValue<bool> {
        let f = self.in_flight.clone().unwrap_or_else(|| env::panic_str("ERR_NOTHING_IN_FLIGHT"));
        require!(env::block_timestamp() >= f.updated_at.0 + RECONCILE_TIMEOUT_NS, "ERR_RECONCILE_TOO_EARLY");
        let mut d = self.get_or_panic(f.deposit_id.0);
        let me = env::current_account_id();
        let p = self.config.pool.clone();
        let cb = || Self::ext(me.clone()).with_static_gas(tgas(T_CB + T_LOOKUP_TOTAL));
        match (f.job.clone(), d.status.clone()) {
            (Job::Lp, DclStatus::PreflightPending) => {
                // the zap is only sent by on_preflight, which never ran: nothing left Treasury
                d.status = DclStatus::BudgetAllocated;
                self.fail(d, "reconciled: preflight callback lost, nothing sent");
                PromiseOrValue::Value(true)
            }
            // decided from the DCL itself (does the position exist?), never from Treasury's USDC balance,
            // which anyone can raise with a plain ft_transfer
            (Job::Lp, DclStatus::ZapPending { .. }) => PromiseOrValue::Promise(
                ext_dcl::ext(p.dex.clone())
                    .with_static_gas(tgas(T_LIST_WIDE))
                    .list_liquidities(me.clone(), Some(0), Some(50))
                    .then(cb().on_reconcile_zap(f.deposit_id)),
            ),
            (Job::Lp, DclStatus::LookupPending { .. }) => PromiseOrValue::Promise(self.lookup(f.deposit_id, true)),
            (Job::Lp, DclStatus::ConfirmPending { .. }) => PromiseOrValue::Promise(self.confirm_reads(f.deposit_id, d.lpt_id.clone().expect("lpt"))),
            (Job::FeeClaim, DclStatus::FeeClaimPending) => PromiseOrValue::Promise(
                ext_dcl::ext(p.dex.clone())
                    .with_static_gas(tgas(T_VIEW))
                    .list_user_assets(me.clone())
                    .then(Self::ext(me.clone()).with_static_gas(tgas(T_CB)).on_reconcile_fees(f.deposit_id)),
            ),
            (Job::Transfer, DclStatus::TransferPending) => PromiseOrValue::Promise(
                ext_dcl::ext(p.dex.clone())
                    .with_static_gas(tgas(T_VIEW))
                    .get_liquidity(d.lpt_id.clone().expect("lpt"))
                    .then(Self::ext(me.clone()).with_static_gas(tgas(T_CB)).on_transfer_checked(f.deposit_id)),
            ),
            (Job::DexWithdraw { token, amount }, _) => PromiseOrValue::Promise(
                ext_dcl::ext(p.dex.clone())
                    .with_static_gas(tgas(T_VIEW))
                    .get_user_asset(me.clone(), token.clone())
                    .then(Self::ext(me.clone()).with_static_gas(tgas(T_CB)).on_dex_withdrawn(f.deposit_id, token, amount)),
            ),
            _ => env::panic_str("ERR_RECONCILE_STATE"),
        }
    }

    /// Lost zap callback. Inside the DCL's own receipt the HotZap is all-or-nothing (measured on the real wasm: a refused zap returns
    /// `used = 0` and the token refunds everything; an accepted one uses the whole amount and creates the
    /// position), so the position's existence on the DCL decides: found → used, not found → refunded.
    #[private]
    pub fn on_reconcile_zap(&mut self, deposit_id: U64, #[callback_result] rows: Result<Vec<DclLiquidityRow>, PromiseError>) -> PromiseOrValue<bool> {
        let Some(mut d) = self.expect_stage(deposit_id.0, Job::Lp, |s| matches!(s, DclStatus::ZapPending { .. })) else {
            return PromiseOrValue::Value(false);
        };
        let DclStatus::ZapPending { sent } = d.status.clone() else { unreachable!() };
        let Ok(rows) = rows else {
            return PromiseOrValue::Value(false); // unreadable: stays in flight, call reconcile again
        };
        let plan = d.plan.clone().expect("plan");
        let me = env::current_account_id();
        let found = plan::find_new_position(&rows, me.as_str(), &d.pool_id, plan.left_point, plan.right_point, |id| self.lpt_index.contains_key(id)).cloned();
        let Some(row) = found else {
            self.pending_budget_total += sent.0;
            self.zap_outstanding -= sent.0;
            d.status = DclStatus::BudgetAllocated;
            self.fail(d, "reconciled: no position on the DCL, zap refunded");
            return PromiseOrValue::Value(true);
        };
        self.settle_zap_usdc(&mut d, sent.0, sent.0);
        self.record_position(&mut d, &row, sent);
        self.emit_stage(&mut d, "reconciled_zap_used");
        self.save(d);
        PromiseOrValue::Promise(self.confirm_reads(deposit_id, row.lpt_id))
    }

    #[private]
    pub fn on_reconcile_fees(&mut self, deposit_id: U64, #[callback_result] assets: Result<HashMap<AccountId, U128>, PromiseError>) -> bool {
        let Some(mut d) = self.expect_stage(deposit_id.0, Job::FeeClaim, |s| matches!(s, DclStatus::FeeClaimPending)) else {
            return false;
        };
        let Ok(assets) = assets else { return false };
        let get = |t: &AccountId| assets.get(t).map(|v| v.0).unwrap_or(0);
        let fx = get(&d.token_x).saturating_sub(self.dex_booked_x);
        let fy = get(&d.token_y).saturating_sub(self.dex_booked_y);
        d.status = DclStatus::PositionConfirmed;
        self.book_fees(&mut d, fx, fy);
        self.in_flight = None;
        mark(&mut d, "reconciled_fees");
        self.save(d);
        true
    }

    // ======================= views =======================

    pub fn get_config(&self) -> Value {
        json!({ "config": self.config, "ready": self.ready, "setup_error": self.setup_error, "fuel": FUEL_STATUS, "setup_deposit": U128(SETUP_DEPOSIT.as_yoctonear()) })
    }
    pub fn get_deposit(&self, deposit_id: U64) -> Option<DclDeposit> {
        self.deposits.get(&deposit_id.0).cloned()
    }
    /// The DCL proof model: what the contract recorded, plus the rules that apply now.
    pub fn get_position(&self, deposit_id: U64) -> Option<Value> {
        let d = self.deposits.get(&deposit_id.0)?;
        let now = env::block_timestamp();
        let locked = d.unlock_at.is_some_and(|u| now < u.0);
        Some(json!({
            "deposit": d,
            "creator_id": d.creator,
            "treasury_id": env::current_account_id(),
            "dex_contract_id": d.dex,
            "position_id": d.lpt_id,
            "locked": locked,
            "withdrawable": d.status == DclStatus::PositionConfirmed && !locked,
            "fees_claimable": d.status == DclStatus::PositionConfirmed,
            "fuel_status": FUEL_STATUS,
            "fuel_reason": "the deployed FUEL reads only treasury.sol2near-dev.testnet / Ref Classic pool 2951; no DCL position proof exists in FUEL",
        }))
    }
    pub fn get_creator_deposits(&self, creator: AccountId) -> Vec<U64> {
        self.creator_deposits.get(&creator).map(|v| v.iter().map(|i| U64(*i)).collect()).unwrap_or_default()
    }
    pub fn get_balance(&self, account_id: AccountId, token_id: AccountId) -> U128 {
        U128(self.balances.get(&bal_key(&account_id, &token_id)).copied().unwrap_or(0))
    }
    pub fn get_in_flight(&self) -> Option<InFlight> {
        self.in_flight.clone()
    }
    pub fn get_accounting(&self) -> Value {
        json!({
            "total_received": U128(self.total_received), "community_total": U128(self.community_total),
            "pending_budget_total": U128(self.pending_budget_total), "zap_outstanding": U128(self.zap_outstanding),
            "owed_usdc": U128(self.owed_usdc), "owed_x": U128(self.owed_x), "owed_y": U128(self.owed_y),
            "dex_booked_usdc": U128(self.dex_booked_usdc), "dex_booked_x": U128(self.dex_booked_x), "dex_booked_y": U128(self.dex_booked_y),
            "live_positions": U64(self.live_positions), "next_deposit_id": U64(self.next_deposit_id),
        })
    }
}

// ======================= internals =======================

fn bal_key(a: &AccountId, t: &AccountId) -> String {
    format!("{a}|{t}")
}

fn mark(d: &mut DclDeposit, stage: &str) {
    if d.marks.len() >= MAX_MARKS {
        d.marks.remove(0);
    }
    d.marks.push(StageMark { stage: stage.into(), block: U64(env::block_height()), at: U64(env::block_timestamp()) });
}

impl TreasuryDcl {
    fn get_or_panic(&self, id: u64) -> DclDeposit {
        self.deposits.get(&id).cloned().unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_DEPOSIT"))
    }
    fn save(&mut self, mut d: DclDeposit) {
        d.updated_at = U64(env::block_timestamp());
        self.deposits.insert(d.id.0, d);
    }
    fn start_job(&mut self, deposit_id: U64, job: Job) {
        let now = U64(env::block_timestamp());
        self.in_flight = Some(InFlight { deposit_id, job, started_at: now, updated_at: now });
    }
    fn touch(&mut self) {
        if let Some(f) = self.in_flight.as_mut() {
            f.updated_at = U64(env::block_timestamp());
        }
    }
    fn expect_stage(&self, id: u64, job: Job, ok: impl Fn(&DclStatus) -> bool) -> Option<DclDeposit> {
        let d = self.deposits.get(&id).cloned()?;
        if self.in_flight.as_ref().is_some_and(|f| f.deposit_id.0 == id && f.job == job) && ok(&d.status) {
            Some(d)
        } else {
            events::emit("callback_ignored", json!({ "deposit_id": U64(id), "status": d.status }));
            None
        }
    }
    fn fail(&mut self, mut d: DclDeposit, reason: &str) {
        d.last_error = Some(reason.to_string());
        self.in_flight = None;
        mark(&mut d, "job_failed");
        events::emit("job_failed", json!({ "deposit_id": d.id, "creator": d.creator, "status": d.status, "reason": reason }));
        self.save(d);
    }
    fn emit_stage(&self, d: &mut DclDeposit, event: &str) {
        mark(d, event);
        events::emit(event, json!({ "deposit_id": d.id, "creator": d.creator, "status": d.status, "lpt_id": d.lpt_id }));
    }
    fn setup_fail(&mut self, stage: &str, error: String) -> bool {
        self.ready = false;
        self.setup_error = Some(format!("{stage}: {error}"));
        events::emit("setup_failed", json!({ "stage": stage, "error": error }));
        false
    }
    fn credit(&mut self, who: &AccountId, token: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        *self.balances.entry(bal_key(who, token)).or_insert(0) += amount;
        *self.owed_mut(token) += amount;
    }
    fn debit(&mut self, who: &AccountId, token: &AccountId, amount: u128) {
        *self.balances.entry(bal_key(who, token)).or_insert(0) -= amount;
        *self.owed_mut(token) -= amount;
    }
    fn owed_mut(&mut self, token: &AccountId) -> &mut u128 {
        let p = &self.config.pool;
        if *token == p.usdc_token {
            &mut self.owed_usdc
        } else if *token == p.token_x {
            &mut self.owed_x
        } else if *token == p.token_y {
            &mut self.owed_y
        } else {
            env::panic_str("ERR_UNKNOWN_TOKEN")
        }
    }
    fn dex_of(&self, d: &DclDeposit, token: &AccountId) -> u128 {
        let p = &self.config.pool;
        if *token == p.usdc_token {
            d.dex_usdc.0
        } else if *token == p.token_x {
            d.dex_x.0
        } else if *token == p.token_y {
            d.dex_y.0
        } else {
            env::panic_str("ERR_UNKNOWN_TOKEN")
        }
    }
    /// The zap took `used` of `sent`: the rest of the budget (plan surplus + any partial refund) goes to the
    /// creator's USDC balance.
    fn settle_zap_usdc(&mut self, d: &mut DclDeposit, sent: u128, used: u128) {
        self.zap_outstanding -= sent;
        let not_spent = d.lp_budget.0 - sent;
        self.pending_budget_total -= not_spent;
        let back = not_spent + (sent - used);
        let usdc = self.config.pool.usdc_token.clone();
        self.credit(&d.creator, &usdc, back);
        d.usdc_used = U128(used);
        d.usdc_unused_to_reserve = U128(back);
    }
    /// Treasury's DCL balances above what is already booked belong to the deposit whose job is in flight
    /// (one job at a time): zap leftovers.
    fn book_dex_delta(&mut self, d: &mut DclDeposit, assets: &HashMap<AccountId, U128>) {
        let get = |t: &AccountId| assets.get(t).map(|v| v.0).unwrap_or(0);
        let p = self.config.pool.clone();
        let dx = get(&p.token_x).saturating_sub(self.dex_booked_x);
        let dy = get(&p.token_y).saturating_sub(self.dex_booked_y);
        let du = get(&p.usdc_token).saturating_sub(self.dex_booked_usdc);
        d.dex_x = U128(d.dex_x.0 + dx);
        d.dex_y = U128(d.dex_y.0 + dy);
        d.dex_usdc = U128(d.dex_usdc.0 + du);
        self.dex_booked_x += dx;
        self.dex_booked_y += dy;
        self.dex_booked_usdc += du;
    }
    fn book_fees(&mut self, d: &mut DclDeposit, fx: u128, fy: u128) {
        d.fees_claimed_x = U128(d.fees_claimed_x.0 + fx);
        d.fees_claimed_y = U128(d.fees_claimed_y.0 + fy);
        d.dex_x = U128(d.dex_x.0 + fx);
        d.dex_y = U128(d.dex_y.0 + fy);
        self.dex_booked_x += fx;
        self.dex_booked_y += fy;
        mark(d, "fees_claimed");
        events::emit("fees_claimed", json!({ "deposit_id": d.id, "lpt_id": d.lpt_id, "fee_x": U128(fx), "fee_y": U128(fy),
            "total_x": d.fees_claimed_x, "total_y": d.fees_claimed_y }));
    }
    fn settle_dex_withdraw(&mut self, deposit_id: U64, token: &AccountId, amount: u128, after: u128) -> bool {
        let mut d = self.get_or_panic(deposit_id.0);
        let p = self.config.pool.clone();
        let booked = if *token == p.usdc_token { self.dex_booked_usdc } else if *token == p.token_x { self.dex_booked_x } else { self.dex_booked_y };
        self.in_flight = None;
        // the DCL re-credits a failed transfer, so success = its balance really dropped by `amount`
        if after + amount > booked {
            d.last_error = Some("dex_withdraw_not_moved".into());
            events::emit("dex_withdraw_failed", json!({ "deposit_id": d.id, "token": token, "amount": U128(amount) }));
            self.save(d);
            return false;
        }
        if *token == p.usdc_token {
            d.dex_usdc = U128(0);
            d.recovered_usdc = U128(d.recovered_usdc.0 + amount);
            self.dex_booked_usdc -= amount;
        } else if *token == p.token_x {
            d.dex_x = U128(0);
            d.recovered_x = U128(d.recovered_x.0 + amount);
            self.dex_booked_x -= amount;
        } else {
            d.dex_y = U128(0);
            d.recovered_y = U128(d.recovered_y.0 + amount);
            self.dex_booked_y -= amount;
        }
        let creator = d.creator.clone();
        self.credit(&creator, token, amount);
        d.last_error = None;
        mark(&mut d, "dex_balance_recovered");
        events::emit("dex_balance_recovered", json!({ "deposit_id": d.id, "token": token, "amount": U128(amount) }));
        self.save(d);
        true
    }
    fn record_position(&mut self, d: &mut DclDeposit, row: &DclLiquidityRow, used: U128) {
        d.lpt_id = Some(row.lpt_id.clone());
        d.left_point = Some(row.left_point);
        d.right_point = Some(row.right_point);
        d.liquidity = row.amount;
        self.lpt_index.insert(row.lpt_id.clone(), d.id.0);
        self.live_positions += 1;
        d.status = DclStatus::ConfirmPending { used };
        self.touch();
    }
    fn lookup(&self, deposit_id: U64, wide: bool) -> Promise {
        let (from, limit, gas) = if wide { (0, 50, T_LIST_WIDE) } else { (self.live_positions.saturating_sub(7), 8, T_LIST) };
        ext_dcl::ext(self.config.pool.dex.clone())
            .with_static_gas(tgas(gas))
            .list_liquidities(env::current_account_id(), Some(from), Some(limit))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB + T_CONFIRM_TOTAL)).on_lookup(deposit_id))
    }
    fn confirm_reads(&self, deposit_id: U64, lpt: String) -> Promise {
        let dex = self.config.pool.dex.clone();
        ext_dcl::ext(dex.clone())
            .with_static_gas(tgas(T_VIEW))
            .get_liquidity_view(lpt)
            .and(ext_dcl::ext(dex).with_static_gas(tgas(T_VIEW)).list_user_assets(env::current_account_id()))
            .then(Self::ext(env::current_account_id()).with_static_gas(tgas(T_CB)).on_confirm(deposit_id))
    }
}

fn ft_storage(token: &AccountId, account: &AccountId) -> Promise {
    ext_ft::ext(token.clone()).with_attached_deposit(FT_STORAGE).with_static_gas(tgas(T_STORAGE)).storage_deposit(Some(account.clone()), Some(true))
}

fn promise_bytes(index: u64) -> Option<Vec<u8>> {
    #[allow(deprecated)]
    match env::promise_result(index) {
        near_sdk::PromiseResult::Successful(b) => Some(b),
        _ => None,
    }
}
