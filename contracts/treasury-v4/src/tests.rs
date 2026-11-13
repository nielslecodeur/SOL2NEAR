//! Unit tests (MOCKED NEAR VM). They prove contract rules and state transitions; the integration with
//! the real Ref wasm is proven separately in the local sandbox run (sandbox-tests/, docs/V4_1_EXECUTION.md).
#![allow(unused_must_use)]
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult};

const USDC: &str = "usdc.tidepool-sandbox.testnet";
const MEME: &str = "s2nmeme.sol2near-dev.testnet";
const REF: &str = "ref-finance-101.testnet";
const TREASURY: &str = "treasury-v4.sol2near-dev.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const POOL: u64 = 77;
const LOCK_NS: u64 = 600 * 1_000_000_000;
const T0: u64 = 1_000 * 1_000_000_000;
const MIN: u64 = 60 * 1_000_000_000;
const ONE_MEME: u128 = 1_000_000_000_000_000_000;
/// Pool: 1 000 USDC / 1 000 000 MEME, 30 bps.
const R_USDC: u128 = 1_000_000_000;
const R_MEME: u128 = 1_000_000 * ONE_MEME;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

struct Ctx {
    now: u64,
}

impl Ctx {
    fn builder(&self, predecessor: &str) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc(TREASURY))
            .predecessor_account_id(acc(predecessor))
            .signer_account_id(acc(predecessor))
            .block_timestamp(self.now)
            .prepaid_gas(Gas::from_tgas(300));
        b
    }
    fn set(&self, p: &str) {
        testing_env!(self.builder(p).build());
    }
    fn set_deposit(&self, p: &str, yocto: u128) {
        testing_env!(self.builder(p).attached_deposit(NearToken::from_yoctonear(yocto)).build());
    }
    fn set_gas(&self, p: &str, t: u64) {
        testing_env!(self.builder(p).prepaid_gas(Gas::from_tgas(t)).build());
    }
    fn set_results(&self, results: Vec<PromiseResult>) {
        testing_env!(
            self.builder(TREASURY).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            results
        );
    }
}

fn pool_cfg() -> PoolConfig {
    PoolConfig { dex: acc(REF), pool_id: POOL, usdc_token: acc(USDC), base_token: acc(MEME), usdc_decimals: 6, base_decimals: 18 }
}
fn guards() -> Guards {
    Guards { max_slippage_bps: 100, max_price_impact_bps: 1_000, max_plan_ttl_ns: U64(10 * MIN) }
}
fn new_t(ctx: &Ctx) -> TreasuryV4 {
    ctx.set(TREASURY);
    TreasuryV4::new("testnet".into(), pool_cfg(), U128(1_000_000), U64(LOCK_NS), guards())
}
fn ready_t(ctx: &Ctx) -> TreasuryV4 {
    let mut t = new_t(ctx);
    t.ready = true;
    t
}
fn deposit(t: &mut TreasuryV4, ctx: &Ctx, from: &str, amount: u128) -> u128 {
    ctx.set(USDC);
    match t.ft_on_transfer(acc(from), U128(amount), r#"{"action":"deposit"}"#.into()) {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}
fn pool_info() -> PoolInfo {
    PoolInfo {
        pool_kind: "SIMPLE_POOL".into(),
        token_account_ids: vec![acc(USDC), acc(MEME)],
        amounts: vec![U128(R_USDC), U128(R_MEME)],
        total_fee: 30,
        shares_total_supply: U128(1_000_000),
    }
}
/// Ref simple-pool formula (same as packages/near-client lpPlan.getAmountOut).
fn ref_out(amount_in: u128) -> u128 {
    let inf = amount_in * (10_000 - 30);
    inf * R_MEME / (R_USDC * 10_000 + inf)
}
const SWAP_IN: u128 = 9_000_000;
fn plan(ctx: &Ctx) -> LpPlan {
    let q = ref_out(SWAP_IN);
    LpPlan {
        swap_amount_in: U128(SWAP_IN),
        min_swap_out: U128(q * 9_950 / 10_000),
        min_amounts: vec![U128(9_000_000 * 9_900 / 10_000), U128(q * 9_900 / 10_000)],
        deadline_ns: U64(ctx.now + 5 * MIN),
    }
}
fn status(t: &TreasuryV4, id: u64) -> DepositStatus {
    t.get_deposit(U64(id)).unwrap().status
}

/// Deposit 0 (20 USDC from ALICE) through every stage. Returns the base amount swapped in.
fn to_swapped(t: &mut TreasuryV4, ctx: &Ctx) -> u128 {
    assert_eq!(deposit(t, ctx, ALICE, 20_000_000), 0);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(ctx)));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    assert_eq!(status(t, 0), DepositStatus::PreSwapCheckPending { usdc: U128(18_000_000) });
    ctx.set(TREASURY);
    t.on_pre_swap(U64(0), Ok(pool_info()), Ok(U128(ref_out(SWAP_IN))));
    assert_eq!(status(t, 0), DepositStatus::SwapPending { usdc: U128(18_000_000) });
    let out = ref_out(SWAP_IN);
    ctx.set(TREASURY);
    t.on_swap(U64(0), Ok(U128(out)));
    out
}
fn happy(t: &mut TreasuryV4, ctx: &Ctx) {
    let out = to_swapped(t, ctx);
    assert_eq!(status(t, 0), DepositStatus::AddLiquidityPending { usdc: U128(9_000_000), base: U128(out) });
    ctx.set(TREASURY);
    t.on_add_liquidity(U64(0), Ok(U128(5_000)));
    let mut deps = HashMap::new();
    deps.insert(acc(USDC), U128(10));
    deps.insert(acc(MEME), U128(7));
    ctx.set(TREASURY);
    t.on_verified(U64(0), Ok(U128(5_000)), Ok(deps));
}
/// The deposit's USDC LP budget is fully accounted for (the same identity FUEL checks on V3).
fn assert_reconciled(t: &TreasuryV4, id: u64) {
    let d = t.get_deposit(U64(id)).unwrap();
    assert_eq!(
        d.usdc_swapped.0 + d.usdc_in_lp.0 + d.dust_usdc.0 + d.usdc_returned_to_reserve.0 + d.usdc_recovered.0,
        d.lp_budget.0,
        "USDC reconciliation of deposit {id}"
    );
    assert_eq!(d.lp_budget.0 + d.reserve.0 + d.community.0, d.amount.0);
}

// ------------------------- configuration -------------------------

#[test]
#[should_panic(expected = "ERR_NETWORK_ACCOUNT")]
fn mainnet_pool_or_token_is_refused_at_init() {
    let ctx = Ctx { now: T0 };
    ctx.set(TREASURY);
    let mut p = pool_cfg();
    p.base_token = acc("blackdragon.tkn.near");
    TreasuryV4::new("testnet".into(), p, U128(1), U64(LOCK_NS), guards());
}

#[test]
#[should_panic(expected = "ERR_NETWORK")]
fn mainnet_network_is_refused() {
    let ctx = Ctx { now: T0 };
    ctx.set(TREASURY);
    TreasuryV4::new("mainnet".into(), pool_cfg(), U128(1), U64(LOCK_NS), guards());
}

#[test]
#[should_panic(expected = "ERR_GUARD_SLIPPAGE")]
fn guards_cannot_be_switched_off() {
    let ctx = Ctx { now: T0 };
    ctx.set(TREASURY);
    TreasuryV4::new("testnet".into(), pool_cfg(), U128(1), U64(LOCK_NS), Guards { max_slippage_bps: 5_000, ..guards() });
}

#[test]
#[should_panic(expected = "ERR_GUARD_IMPACT")]
fn excessive_impact_ceiling_is_refused() {
    let ctx = Ctx { now: T0 };
    ctx.set(TREASURY);
    TreasuryV4::new("testnet".into(), pool_cfg(), U128(1), U64(LOCK_NS), Guards { max_price_impact_bps: 5_000, ..guards() });
}

fn meta(decimals: u8) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&json!({ "spec": "ft-1.0.0", "name": "x", "symbol": "X", "decimals": decimals })).unwrap())
}
fn pool_bytes(p: &PoolInfo) -> PromiseResult {
    PromiseResult::Successful(
        serde_json::to_vec(&json!({
            "pool_kind": p.pool_kind, "token_account_ids": p.token_account_ids, "amounts": p.amounts,
            "total_fee": p.total_fee, "shares_total_supply": p.shares_total_supply,
        }))
        .unwrap(),
    )
}

#[test]
fn setup_checks_kind_tokens_and_decimals_on_chain() {
    let ctx = Ctx { now: T0 };
    let ok = || PromiseResult::Successful(vec![]);
    // wrong decimals of the base token -> not ready
    let mut t = new_t(&ctx);
    ctx.set_results(vec![ok(), pool_bytes(&pool_info()), meta(6), meta(24)]);
    assert!(!t.on_setup_done());
    assert!(!t.ready);
    // unknown / imposter token in the pool -> not ready
    let mut p = pool_info();
    p.token_account_ids[1] = acc("s2nmeme-fake.testnet");
    ctx.set_results(vec![ok(), pool_bytes(&p), meta(6), meta(18)]);
    assert!(!t.on_setup_done());
    // stable pool -> not ready
    let mut p = pool_info();
    p.pool_kind = "STABLE_SWAP".into();
    ctx.set_results(vec![ok(), pool_bytes(&p), meta(6), meta(18)]);
    assert!(!t.on_setup_done());
    // metadata unreadable -> not ready
    ctx.set_results(vec![ok(), pool_bytes(&pool_info()), meta(6), PromiseResult::Failed]);
    assert!(!t.on_setup_done());
    // everything right, tokens in reverse order -> ready, index 1
    let mut p = pool_info();
    p.token_account_ids.reverse();
    ctx.set_results(vec![ok(), pool_bytes(&p), meta(6), meta(18)]);
    assert!(t.on_setup_done());
    assert!(t.ready);
    assert_eq!(t.get_config().usdc_pool_index, 1);
    assert_eq!(t.get_config().fuel, FUEL_NOT_ELIGIBLE);
}

#[test]
#[should_panic(expected = "ERR_SETUP_DEPOSIT")]
fn setup_requires_storage_deposit() {
    let ctx = Ctx { now: T0 };
    let mut t = new_t(&ctx);
    ctx.set_deposit(BOB, 1);
    t.setup();
}

// ------------------------- intake -------------------------

#[test]
fn deposit_split_90_8_2_and_refusals() {
    let ctx = Ctx { now: T0 };
    let mut t = new_t(&ctx);
    assert_eq!(deposit(&mut t, &ctx, ALICE, 20_000_000), 20_000_000, "not ready -> refunded");
    t.ready = true;
    assert_eq!(deposit(&mut t, &ctx, ALICE, 999_999), 999_999, "below min -> refunded");
    ctx.set(MEME);
    let r = t.ft_on_transfer(acc(ALICE), U128(5), r#"{"action":"deposit"}"#.into());
    assert!(matches!(r, PromiseOrValue::Value(U128(5))), "wrong token contract -> refunded");
    assert_eq!(deposit(&mut t, &ctx, ALICE, 20_000_001), 0);
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.lp_budget.0, d.reserve.0, d.community.0), (18_000_000, 1_600_000, 400_001));
    assert_eq!(t.get_reserve(acc(ALICE)).0, 1_600_000);
    assert_eq!(t.get_accounting().pending_budget_total.0, 18_000_000);
    assert_eq!(d.dex, acc(REF));
    assert_eq!(d.base_token, acc(MEME));
    assert_eq!(d.marks[0].stage, "deposit_allocated");
}

// ------------------------- plan validation -------------------------

#[test]
#[should_panic(expected = "ERR_NOT_CREATOR")]
fn only_the_creator_executes() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(BOB);
    t.execute_lp(U64(0), Some(plan(&ctx)));
}

#[test]
#[should_panic(expected = "ERR_PLAN_MIN_AMOUNTS")]
fn zero_add_liquidity_guard_is_refused() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(LpPlan { min_amounts: vec![U128(0), U128(1)], ..plan(&ctx) }));
}

#[test]
#[should_panic(expected = "ERR_PLAN_DEADLINE_TOO_FAR")]
fn plan_deadline_beyond_ttl_is_refused() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(LpPlan { deadline_ns: U64(T0 + 11 * MIN), ..plan(&ctx) }));
}

#[test]
#[should_panic(expected = "ERR_PLAN_EXPIRED")]
fn expired_plan_is_refused() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(LpPlan { deadline_ns: U64(T0 - 1), ..plan(&ctx) }));
}

#[test]
#[should_panic(expected = "ERR_NOT_ENOUGH_GAS")]
fn execute_requires_enough_gas() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set_gas(ALICE, 150);
    t.execute_lp(U64(0), Some(plan(&ctx)));
}

#[test]
#[should_panic(expected = "ERR_JOB_IN_FLIGHT")]
fn one_job_at_a_time() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    deposit(&mut t, &ctx, BOB, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(BOB);
    t.execute_lp(U64(1), Some(plan(&ctx)));
}

// ------------------------- happy path -------------------------

#[test]
fn happy_path_confirms_verified_lp_with_lock_dust_and_no_fuel() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DepositStatus::LpConfirmed);
    assert!(d.lp_verified);
    assert_eq!(d.lp_shares.0, 5_000);
    assert_eq!((d.usdc_swapped.0, d.usdc_in_lp.0, d.dust_usdc.0), (9_000_000, 8_999_990, 10));
    assert_eq!(d.dust_base.0, 7);
    assert_eq!(d.base_in_lp.0, ref_out(SWAP_IN) - 7);
    assert_eq!(d.unlock_at, Some(U64(T0 + LOCK_NS)));
    assert_eq!(d.pool_id, Some(POOL));
    assert_reconciled(&t, 0);
    let a = t.get_accounting();
    assert_eq!((a.ref_expected_usdc.0, a.ref_expected_base.0, a.recorded_shares.0, a.pending_budget_total.0), (10, 7, 5_000, 0));
    assert!(t.get_in_flight().is_none());
    assert!(t.get_last_proof().unwrap().ok);
    let p = t.get_position(U64(0)).unwrap();
    assert!(p.locked && !p.lp_withdrawable && p.leftovers_recoverable);
    assert_eq!(p.fuel_status, "FUEL_NOT_ELIGIBLE");
    let stages: Vec<_> = d.marks.iter().map(|m| m.stage.as_str()).collect();
    assert_eq!(stages, ["deposit_allocated", "amm_deposit_confirmed", "swap_confirmed", "lp_confirmed"]);
}

#[test]
fn lp_not_backed_on_ref_is_recorded_unverified() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    to_swapped(&mut t, &ctx);
    ctx.set(TREASURY);
    t.on_add_liquidity(U64(0), Ok(U128(5_000)));
    ctx.set(TREASURY);
    t.on_verified(U64(0), Ok(U128(4_999)), Ok(HashMap::new()));
    assert!(!t.get_deposit(U64(0)).unwrap().lp_verified);
}

// ------------------------- on-chain guards -------------------------

#[test]
fn excessive_price_impact_parks_funds_in_ref_without_swapping() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    // Shallow pool: 20 USDC / 20 000 MEME -> the 9 USDC swap moves the price ~31 %.
    let shallow = PoolInfo { amounts: vec![U128(20_000_000), U128(20_000 * ONE_MEME)], ..pool_info() };
    let q = (SWAP_IN * 9_970 * 20_000 * ONE_MEME) / (20_000_000 * 10_000 + SWAP_IN * 9_970);
    ctx.set(TREASURY);
    let r = t.on_pre_swap(U64(0), Ok(shallow), Ok(U128(q)));
    assert!(matches!(r, PromiseOrValue::Value(false)));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DepositStatus::InRef { usdc: U128(18_000_000) });
    assert!(d.last_error.unwrap().starts_with("guard_price_impact"));
    assert!(t.get_in_flight().is_none());
    assert_eq!(t.get_accounting().ref_expected_usdc.0, 18_000_000, "nothing swapped, nothing lost");
}

#[test]
fn loose_slippage_guard_is_refused_on_chain() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(LpPlan { min_swap_out: U128(1), ..plan(&ctx) }));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    ctx.set(TREASURY);
    t.on_pre_swap(U64(0), Ok(pool_info()), Ok(U128(ref_out(SWAP_IN))));
    let d = t.get_deposit(U64(0)).unwrap();
    assert!(matches!(d.status, DepositStatus::InRef { .. }));
    assert!(d.last_error.unwrap().starts_with("guard_slippage"));
}

#[test]
fn pool_changed_or_views_failed_park_the_funds() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    let mut wrong = pool_info();
    wrong.token_account_ids[1] = acc("wrap.testnet");
    ctx.set(TREASURY);
    t.on_pre_swap(U64(0), Ok(wrong), Ok(U128(ref_out(SWAP_IN))));
    assert_eq!(t.get_deposit(U64(0)).unwrap().last_error.as_deref(), Some("pool tokens do not match config"));
    // resume: the pre-swap check runs again; this time the views fail
    ctx.set(ALICE);
    t.execute_lp(U64(0), None);
    assert!(matches!(status(&t, 0), DepositStatus::PreSwapCheckPending { .. }));
    ctx.set(TREASURY);
    t.on_pre_swap(U64(0), Err(PromiseError::Failed), Ok(U128(1)));
    assert_eq!(t.get_deposit(U64(0)).unwrap().last_error.as_deref(), Some("guard_views_failed"));
}

#[test]
fn add_liquidity_guard_out_of_bounds_parks_swapped_funds() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    // min_amounts far below what will be provided (5 % < provided - 2 x 1 %)
    let mut p = plan(&ctx);
    p.min_amounts = vec![U128(9_000_000 * 95 / 100), U128(ref_out(SWAP_IN) * 95 / 100)];
    t.execute_lp(U64(0), Some(p));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    ctx.set(TREASURY);
    t.on_pre_swap(U64(0), Ok(pool_info()), Ok(U128(ref_out(SWAP_IN))));
    ctx.set(TREASURY);
    t.on_swap(U64(0), Ok(U128(ref_out(SWAP_IN))));
    let d = t.get_deposit(U64(0)).unwrap();
    assert!(matches!(d.status, DepositStatus::Swapped { .. }));
    assert_eq!(d.last_error.as_deref(), Some("guard_add_liquidity_min_amounts"));
    assert!(t.get_in_flight().is_none());
}

#[test]
fn plan_expiring_between_stages_parks_instead_of_executing_late() {
    let mut ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    ctx.now = T0 + 6 * MIN; // past the 5-minute deadline
    ctx.set(TREASURY);
    t.on_pre_swap(U64(0), Ok(pool_info()), Ok(U128(ref_out(SWAP_IN))));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DepositStatus::InRef { usdc: U128(18_000_000) });
    assert_eq!(d.last_error.as_deref(), Some("plan_expired"));
}

// ------------------------- failures, resume, no double spend -------------------------

#[test]
fn swap_failure_is_resumable_without_double_spend() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    ctx.set(TREASURY);
    t.on_pre_swap(U64(0), Ok(pool_info()), Ok(U128(ref_out(SWAP_IN))));
    ctx.set(TREASURY);
    t.on_swap(U64(0), Err(PromiseError::Failed));
    assert_eq!(status(&t, 0), DepositStatus::InRef { usdc: U128(18_000_000) });
    assert_eq!(t.get_accounting().ref_expected_usdc.0, 18_000_000);
    // resume from InRef: no second transfer to Ref, budget not re-sent
    ctx.set(ALICE);
    t.execute_lp(U64(0), None);
    assert!(matches!(status(&t, 0), DepositStatus::PreSwapCheckPending { .. }));
    assert_eq!(t.get_accounting().ref_expected_usdc.0, 18_000_000);
    assert_eq!(t.get_accounting().pending_budget_total.0, 0);
}

#[test]
fn amm_deposit_partial_acceptance_is_returned_to_reserve_and_reconciled() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(17_000_000)));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.usdc_returned_to_reserve.0, 1_000_000);
    assert_eq!(t.get_reserve(acc(ALICE)).0, 2_600_000);
}

#[test]
fn amm_deposit_failure_keeps_the_budget() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Err(PromiseError::Failed));
    assert_eq!(status(&t, 0), DepositStatus::BudgetAllocated);
    assert_eq!(t.get_accounting().pending_budget_total.0, 18_000_000);
    assert!(t.get_in_flight().is_none());
}

#[test]
fn failed_add_liquidity_never_marks_lp() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    let out = to_swapped(&mut t, &ctx);
    ctx.set(TREASURY);
    t.on_add_liquidity(U64(0), Err(PromiseError::Failed));
    assert_eq!(status(&t, 0), DepositStatus::Swapped { usdc: U128(9_000_000), base: U128(out) });
    assert_eq!(t.get_accounting().recorded_shares.0, 0);
}

#[test]
fn replayed_callbacks_are_ignored() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    let before = t.get_accounting().recorded_shares.0;
    ctx.set(TREASURY);
    assert!(matches!(t.on_add_liquidity(U64(0), Ok(U128(5_000))), PromiseOrValue::Value(false)));
    ctx.set(TREASURY);
    assert!(!t.on_verified(U64(0), Ok(U128(10_000)), Ok(HashMap::new())));
    ctx.set(TREASURY);
    assert!(matches!(t.on_swap(U64(0), Ok(U128(1))), PromiseOrValue::Value(false)));
    assert_eq!(t.get_accounting().recorded_shares.0, before);
}

#[test]
#[should_panic(expected = "ERR_RECONCILE_TOO_EARLY")]
fn reconcile_waits_for_the_timeout() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(BOB);
    t.reconcile();
}

#[test]
fn reconcile_after_interruption_uses_ref_balances() {
    let mut ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan(&ctx)));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000))); // now PreSwapCheckPending, callback lost
    let since = t.get_in_flight().unwrap().since;
    ctx.now = T0 + RECONCILE_TIMEOUT_NS + 1;
    ctx.set(BOB);
    t.reconcile();
    ctx.set(TREASURY);
    let mut deps = HashMap::new();
    deps.insert(acc(USDC), U128(18_000_000));
    ctx.set(TREASURY);
    assert!(t.on_reconcile(U64(0), since, Ok(U128(0)), Ok(deps)));
    assert_eq!(status(&t, 0), DepositStatus::InRef { usdc: U128(18_000_000) });
    assert!(t.get_in_flight().is_none());
}

#[test]
fn reconcile_detects_minted_shares_after_a_lost_callback() {
    let mut ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    let out = to_swapped(&mut t, &ctx); // AddLiquidityPending, callback lost
    let since = t.get_in_flight().unwrap().since;
    ctx.now = T0 + RECONCILE_TIMEOUT_NS + 1;
    ctx.set(TREASURY);
    let mut deps = HashMap::new();
    deps.insert(acc(USDC), U128(3));
    deps.insert(acc(MEME), U128(4));
    ctx.set(TREASURY);
    assert!(t.on_reconcile(U64(0), since, Ok(U128(4_321)), Ok(deps)));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DepositStatus::LpConfirmed);
    assert_eq!(d.lp_shares.0, 4_321);
    assert_eq!(d.base_in_lp.0, out - 4);
    assert_reconciled(&t, 0);
}

// ------------------------- exit -------------------------

#[test]
#[should_panic(expected = "ERR_LP_LOCKED")]
fn lp_withdraw_during_lock_is_refused() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    ctx.set_deposit(ALICE, 1);
    t.withdraw_lp(U64(0));
}

#[test]
#[should_panic(expected = "ERR_NOT_CREATOR")]
fn lp_withdraw_by_someone_else_is_refused() {
    let mut ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    ctx.now = T0 + LOCK_NS;
    ctx.set_deposit(BOB, 1);
    t.withdraw_lp(U64(0));
}

#[test]
fn lp_withdraw_after_unlock_then_no_double_withdraw() {
    let mut ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    ctx.now = T0 + LOCK_NS;
    ctx.set(ALICE);
    let pos = t.get_position(U64(0)).unwrap();
    assert!(pos.lp_withdrawable && !pos.locked);
    ctx.set_deposit(ALICE, 1);
    t.withdraw_lp(U64(0));
    assert_eq!(status(&t, 0), DepositStatus::LpWithdrawPending);
    // failure: shares stay with Treasury, the creator can retry
    ctx.set_results(vec![PromiseResult::Failed]);
    t.on_lp_withdraw(U64(0));
    assert_eq!(status(&t, 0), DepositStatus::LpConfirmed);
    assert_eq!(t.get_accounting().recorded_shares.0, 5_000);
    // retry: success
    ctx.set_deposit(ALICE, 1);
    t.withdraw_lp(U64(0));
    ctx.set_results(vec![PromiseResult::Successful(vec![])]);
    assert!(matches!(t.on_lp_withdraw(U64(0)), PromiseOrValue::Promise(_)), "success chains a fresh proof");
    assert_eq!(status(&t, 0), DepositStatus::LpWithdrawn);
    assert_eq!(t.get_accounting().recorded_shares.0, 0);
    // replayed callback does nothing
    assert!(matches!(t.on_lp_withdraw(U64(0)), PromiseOrValue::Value(false)));
    assert_eq!(t.get_accounting().recorded_shares.0, 0);
}

#[test]
#[should_panic(expected = "ERR_NO_CONFIRMED_LP")]
fn lp_cannot_be_withdrawn_twice() {
    let mut ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    ctx.now = T0 + LOCK_NS;
    ctx.set_deposit(ALICE, 1);
    t.withdraw_lp(U64(0));
    ctx.set_results(vec![PromiseResult::Successful(vec![])]);
    t.on_lp_withdraw(U64(0));
    ctx.set_deposit(ALICE, 1);
    t.withdraw_lp(U64(0));
}

// ------------------------- abort and leftovers -------------------------

#[test]
fn abort_before_ref_returns_the_budget_to_the_reserve() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.abort_lp(U64(0));
    assert_eq!(status(&t, 0), DepositStatus::Aborted);
    assert_eq!(t.get_reserve(acc(ALICE)).0, 1_600_000 + 18_000_000);
    assert_eq!(t.get_accounting().pending_budget_total.0, 0);
    assert_reconciled(&t, 0);
}

#[test]
fn abort_after_swap_turns_both_legs_into_recoverable_leftovers() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    let out = ref_out(SWAP_IN);
    ctx.set(ALICE);
    let mut p = plan(&ctx);
    p.min_amounts = vec![U128(1), U128(1)]; // add_liquidity guard will park it
    t.execute_lp(U64(0), Some(p));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    ctx.set(TREASURY);
    t.on_pre_swap(U64(0), Ok(pool_info()), Ok(U128(out)));
    ctx.set(TREASURY);
    t.on_swap(U64(0), Ok(U128(out)));
    ctx.set(ALICE);
    t.abort_lp(U64(0));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.dust_usdc.0, d.dust_base.0), (9_000_000, out));
    assert_reconciled(&t, 0);
    assert!(t.get_position(U64(0)).unwrap().leftovers_recoverable);
}

#[test]
#[should_panic(expected = "ERR_NOT_ABORTABLE")]
fn confirmed_lp_cannot_be_aborted() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    ctx.set(ALICE);
    t.abort_lp(U64(0));
}

#[test]
#[should_panic(expected = "ERR_NOT_CREATOR")]
fn leftovers_of_someone_else_cannot_be_withdrawn() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    ctx.set_deposit(BOB, 1);
    t.withdraw_leftover(U64(0), acc(MEME));
}

#[test]
fn leftover_withdraw_is_judged_from_ref_balances() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx); // dust 10 USDC-atomic, 7 MEME-atomic; ref_expected 10 / 7
    ctx.set_deposit(ALICE, 1);
    t.withdraw_leftover(U64(0), acc(MEME));
    // Ref still shows 7: the transfer failed and was re-credited -> nothing changes
    ctx.set(TREASURY);
    let mut deps = HashMap::new();
    deps.insert(acc(MEME), U128(7));
    ctx.set(TREASURY);
    assert!(!t.on_leftover(U64(0), acc(MEME), U128(7), Ok(deps)));
    assert_eq!(t.get_deposit(U64(0)).unwrap().dust_base.0, 7);
    assert!(t.get_in_flight().is_none());
    // retry: Ref shows 0 -> recovered to the creator's base balance
    ctx.set_deposit(ALICE, 1);
    t.withdraw_leftover(U64(0), acc(MEME));
    ctx.set(TREASURY);
    let mut deps = HashMap::new();
    deps.insert(acc(MEME), U128(0));
    ctx.set(TREASURY);
    assert!(t.on_leftover(U64(0), acc(MEME), U128(7), Ok(deps.clone())));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.dust_base.0, d.base_recovered.0), (0, 7));
    assert_eq!(t.get_base_balance(acc(ALICE)).0, 7);
    assert_eq!(t.get_accounting().ref_expected_base.0, 0);
    // replay of the same callback: ignored (no job in flight)
    ctx.set(TREASURY);
    assert!(!t.on_leftover(U64(0), acc(MEME), U128(7), Ok(deps)));
    assert_eq!(t.get_base_balance(acc(ALICE)).0, 7);
    // USDC leftover goes to the reserve; the deposit stays reconciled
    ctx.set_deposit(ALICE, 1);
    t.withdraw_leftover(U64(0), acc(USDC));
    ctx.set(TREASURY);
    let mut deps = HashMap::new();
    deps.insert(acc(USDC), U128(0));
    ctx.set(TREASURY);
    assert!(t.on_leftover(U64(0), acc(USDC), U128(10), Ok(deps)));
    assert_eq!(t.get_reserve(acc(ALICE)).0, 1_600_000 + 10);
    assert_reconciled(&t, 0);
}

#[test]
#[should_panic(expected = "ERR_NOTHING_TO_WITHDRAW")]
fn no_double_leftover_withdraw() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    happy(&mut t, &ctx);
    ctx.set_deposit(ALICE, 1);
    t.withdraw_leftover(U64(0), acc(MEME));
    ctx.set(TREASURY);
    let mut deps = HashMap::new();
    deps.insert(acc(MEME), U128(0));
    ctx.set(TREASURY);
    t.on_leftover(U64(0), acc(MEME), U128(7), Ok(deps));
    ctx.set_deposit(ALICE, 1);
    t.withdraw_leftover(U64(0), acc(MEME));
}

#[test]
fn base_withdraw_failure_recredits() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    t.base_balances.insert(acc(ALICE), 7);
    t.base_balance_total = 7;
    ctx.set_deposit(ALICE, 1);
    t.withdraw_base(U128(7));
    assert_eq!(t.get_base_balance(acc(ALICE)).0, 0);
    ctx.set_results(vec![PromiseResult::Failed]);
    assert!(!t.on_base_withdraw(acc(ALICE), U128(7)));
    assert_eq!(t.get_base_balance(acc(ALICE)).0, 7);
    assert_eq!(t.get_accounting().base_balance_total.0, 7);
}

#[test]
#[should_panic(expected = "ERR_INSUFFICIENT_BASE")]
fn base_of_someone_else_cannot_be_withdrawn() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    t.base_balances.insert(acc(ALICE), 7);
    ctx.set_deposit(BOB, 1);
    t.withdraw_base(U128(7));
}
