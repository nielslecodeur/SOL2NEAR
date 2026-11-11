//! Unit tests (mocked NEAR VM). They prove contract logic, NOT on-chain integration with Ref.
#![allow(unused_must_use)]
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult};

const USDC: &str = "usdc.tidepool-sandbox.testnet";
const WNEAR: &str = "wnear.tidepool-sandbox.testnet";
const REF: &str = "ref-finance-101.testnet";
const TREASURY: &str = "treasury.sol2near-dev.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const POOL: u64 = 42;
const LOCK_NS: u64 = 600 * 1_000_000_000;

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
    fn set(&self, predecessor: &str) {
        testing_env!(self.builder(predecessor).build());
    }
    fn set_with_deposit(&self, predecessor: &str, yocto: u128) {
        testing_env!(self
            .builder(predecessor)
            .attached_deposit(NearToken::from_yoctonear(yocto))
            .build());
    }
    fn set_gas(&self, predecessor: &str, tgas: u64) {
        testing_env!(self.builder(predecessor).prepaid_gas(Gas::from_tgas(tgas)).build());
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

fn new_treasury(ctx: &Ctx) -> Treasury {
    ctx.set(TREASURY);
    Treasury::new(acc(USDC), acc(WNEAR), acc(REF), POOL, U128(1_000_000), U64(LOCK_NS))
}

fn ready_treasury(ctx: &Ctx) -> Treasury {
    let mut t = new_treasury(ctx);
    t.ready = true;
    t.usdc_pool_index = 0;
    t
}

fn deposit_msg() -> String {
    r#"{"action":"deposit"}"#.to_string()
}

fn deposit(t: &mut Treasury, ctx: &Ctx, from: &str, amount: u128) -> PromiseOrValue<U128> {
    ctx.set(USDC);
    t.ft_on_transfer(acc(from), U128(amount), deposit_msg())
}

fn refunded(r: PromiseOrValue<U128>) -> u128 {
    match r {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}

fn plan() -> LpPlan {
    LpPlan {
        swap_amount_in: U128(9_000_000),
        min_swap_out: U128(1),
        min_amounts: vec![U128(1), U128(1)],
    }
}

fn status(t: &Treasury, id: u64) -> DepositStatus {
    t.get_deposit(U64(id)).unwrap().status
}

/// Drives deposit 0 (20 USDC from ALICE) through every stage up to LpConfirmed.
fn happy_path(t: &mut Treasury, ctx: &Ctx) {
    assert_eq!(refunded(deposit(t, ctx, ALICE, 20_000_000)), 0);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    assert_eq!(status(t, 0), DepositStatus::AmmDepositPending);

    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    assert_eq!(status(t, 0), DepositStatus::SwapPending { usdc: U128(18_000_000) });

    t.on_swap(U64(0), Ok(U128(2_400_000_000_000_000_000_000_000)));
    assert_eq!(
        status(t, 0),
        DepositStatus::AddLiquidityPending {
            usdc: U128(9_000_000),
            wnear: U128(2_400_000_000_000_000_000_000_000)
        }
    );

    t.on_add_liquidity(U64(0), Ok(U128(5_000)));
    assert!(matches!(status(t, 0), DepositStatus::VerifyPending { .. }));

    // Ref now reports 5_000 shares and a small dust of each token left in Treasury's deposit.
    let mut deps = HashMap::new();
    deps.insert(acc(USDC), U128(10));
    deps.insert(acc(WNEAR), U128(7));
    t.on_verified(U64(0), Ok(U128(5_000)), Ok(deps));
}

// ------------------------- intake -------------------------

#[test]
fn deposit_is_split_90_8_2_and_counted_once() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    assert_eq!(refunded(deposit(&mut t, &ctx, ALICE, 20_000_000)), 0);
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.lp_budget.0, d.reserve.0, d.community.0), (18_000_000, 1_600_000, 400_000));
    assert_eq!(d.status, DepositStatus::BudgetAllocated);
    let a = t.get_accounting();
    assert_eq!(a.total_received.0, 20_000_000);
    assert_eq!(a.pending_budget_total.0, 18_000_000);
    assert_eq!(a.reserve_total.0, 1_600_000);
    assert_eq!(a.community_total.0, 400_000);
    assert_eq!(t.get_reserve(acc(ALICE)).0, 1_600_000);
    assert_eq!(a.deposits_count.0, 1);
}

#[test]
fn wrong_token_is_refunded() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    ctx.set(WNEAR);
    assert_eq!(refunded(t.ft_on_transfer(acc(ALICE), U128(5_000_000), deposit_msg())), 5_000_000);
    assert_eq!(t.get_accounting().deposits_count.0, 0);
}

#[test]
fn spoofed_deposit_from_frontend_is_not_credited() {
    // A user calling ft_on_transfer directly is the predecessor, not the USDC contract.
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    ctx.set(ALICE);
    assert_eq!(refunded(t.ft_on_transfer(acc(ALICE), U128(5_000_000), deposit_msg())), 5_000_000);
    assert_eq!(t.get_accounting().total_received.0, 0);
}

#[test]
fn invalid_msg_below_min_and_not_ready_are_refunded() {
    let ctx = Ctx { now: 1 };
    let mut t = new_treasury(&ctx);
    assert_eq!(refunded(deposit(&mut t, &ctx, ALICE, 5_000_000)), 5_000_000, "not ready");
    t.ready = true;
    ctx.set(USDC);
    assert_eq!(refunded(t.ft_on_transfer(acc(ALICE), U128(5_000_000), String::new())), 5_000_000);
    assert_eq!(
        refunded(t.ft_on_transfer(acc(ALICE), U128(5_000_000), r#"{"action":"steal"}"#.into())),
        5_000_000
    );
    assert_eq!(refunded(deposit(&mut t, &ctx, ALICE, 999_999)), 999_999, "below min");
    assert_eq!(t.get_accounting().deposits_count.0, 0);
}

// ------------------------- execution guards -------------------------

#[test]
#[should_panic(expected = "ERR_NOT_CREATOR")]
fn only_creator_can_execute_lp() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(BOB);
    t.execute_lp(U64(0), Some(plan()));
}

#[test]
#[should_panic(expected = "ERR_LP_JOB_IN_FLIGHT")]
fn one_lp_job_at_a_time() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    deposit(&mut t, &ctx, BOB, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    ctx.set(BOB);
    t.execute_lp(U64(1), Some(plan()));
}

#[test]
#[should_panic(expected = "ERR_PLAN_NO_SLIPPAGE_GUARD")]
fn plan_requires_slippage_guard() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(LpPlan { min_swap_out: U128(0), ..plan() }));
}

#[test]
#[should_panic(expected = "ERR_NOT_ENOUGH_GAS")]
fn execute_lp_requires_enough_gas() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set_gas(ALICE, 100);
    t.execute_lp(U64(0), Some(plan()));
}

#[test]
#[should_panic(expected = "ERR_NOT_READY")]
fn execute_requires_setup() {
    let ctx = Ctx { now: 1 };
    let mut t = new_treasury(&ctx);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
}

// ------------------------- async pipeline -------------------------

#[test]
fn happy_path_confirms_lp_with_dust_and_lock() {
    let ctx = Ctx { now: 1_000 };
    let mut t = ready_treasury(&ctx);
    happy_path(&mut t, &ctx);
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DepositStatus::LpConfirmed);
    assert_eq!(d.lp_shares.0, 5_000);
    assert!(d.lp_verified);
    assert_eq!(d.usdc_in_lp.0, 9_000_000 - 10);
    assert_eq!(d.dust_usdc.0, 10);
    assert_eq!(d.dust_wnear.0, 7);
    assert_eq!(d.unlock_at, Some(U64(1_000 + LOCK_NS)));
    assert_eq!((d.pool_id, d.lp_confirmed_at), (Some(POOL), Some(U64(1_000))));
    let a = t.get_accounting();
    assert_eq!(a.recorded_shares.0, 5_000);
    assert_eq!(a.pending_budget_total.0, 0);
    assert_eq!((a.ref_expected_usdc.0, a.ref_expected_wnear.0), (10, 7));
    assert!(t.get_in_flight().is_none());
    assert!(t.get_last_proof().unwrap().ok);
}

#[test]
fn amm_deposit_failure_keeps_budget_and_releases_lock() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Err(PromiseError::Failed));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DepositStatus::BudgetAllocated);
    assert_eq!(d.last_error.as_deref(), Some("amm_deposit_failed_or_refunded"));
    assert_eq!(t.get_accounting().pending_budget_total.0, 18_000_000);
    assert_eq!(t.get_accounting().recorded_shares.0, 0, "no LP marked");
    assert!(t.get_in_flight().is_none());
}

#[test]
fn swap_failure_parks_funds_in_ref_and_is_resumable() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    t.on_swap(U64(0), Err(PromiseError::Failed));
    assert_eq!(status(&t, 0), DepositStatus::InRef { usdc: U128(18_000_000) });
    assert!(t.get_in_flight().is_none());
    // resume from InRef with a new plan
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    assert_eq!(status(&t, 0), DepositStatus::SwapPending { usdc: U128(18_000_000) });
}

#[test]
fn add_liquidity_failure_does_not_mark_lp() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    t.on_swap(U64(0), Ok(U128(3)));
    t.on_add_liquidity(U64(0), Err(PromiseError::Failed));
    assert_eq!(status(&t, 0), DepositStatus::Swapped { usdc: U128(9_000_000), wnear: U128(3) });
    assert_eq!(t.get_accounting().recorded_shares.0, 0);
    assert!(t.get_in_flight().is_none());
}

#[test]
fn replayed_callback_is_ignored() {
    let ctx = Ctx { now: 1_000 };
    let mut t = ready_treasury(&ctx);
    happy_path(&mut t, &ctx);
    let before = t.get_accounting().recorded_shares.0;
    ctx.set(TREASURY);
    assert!(matches!(t.on_add_liquidity(U64(0), Ok(U128(5_000))), PromiseOrValue::Value(false)));
    assert!(!t.on_verified(U64(0), Ok(U128(10_000)), Ok(HashMap::new())));
    assert!(matches!(t.on_amm_deposit(U64(0), Ok(U128(18_000_000))), PromiseOrValue::Value(false)));
    assert_eq!(t.get_accounting().recorded_shares.0, before, "no double LP credit");
    assert_eq!(status(&t, 0), DepositStatus::LpConfirmed);
}

#[test]
fn unverified_when_onchain_shares_do_not_cover() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    t.on_swap(U64(0), Ok(U128(3)));
    t.on_add_liquidity(U64(0), Ok(U128(5_000)));
    t.on_verified(U64(0), Ok(U128(4_999)), Err(PromiseError::Failed));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DepositStatus::LpConfirmed);
    assert!(!d.lp_verified, "claimed shares not backed on-chain -> unverified");
    assert!(!t.get_last_proof().unwrap().ok);
}

// ------------------------- reconcile -------------------------

#[test]
#[should_panic(expected = "ERR_RECONCILE_TOO_EARLY")]
fn reconcile_requires_timeout() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    ctx.set(BOB);
    t.reconcile();
}

#[test]
fn reconcile_detects_amm_deposit_that_landed() {
    let mut ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    let since = t.get_in_flight().unwrap().since;
    ctx.now += RECONCILE_TIMEOUT_NS + 1;
    ctx.set(BOB);
    t.reconcile();
    ctx.set(TREASURY);
    let mut deps = HashMap::new();
    deps.insert(acc(USDC), U128(18_000_000));
    assert!(t.on_reconcile(U64(0), since, Ok(U128(0)), Ok(deps)));
    assert_eq!(status(&t, 0), DepositStatus::InRef { usdc: U128(18_000_000) });
    assert_eq!(t.get_accounting().pending_budget_total.0, 0);
    assert!(t.get_in_flight().is_none());
}

#[test]
fn reconcile_detects_minted_shares() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    ctx.set(TREASURY);
    t.on_amm_deposit(U64(0), Ok(U128(18_000_000)));
    t.on_swap(U64(0), Ok(U128(3)));
    // on_add_liquidity never arrives (e.g. callback out of gas)
    let since = t.get_in_flight().unwrap().since;
    let mut deps = HashMap::new();
    deps.insert(acc(USDC), U128(0));
    deps.insert(acc(WNEAR), U128(0));
    assert!(t.on_reconcile(U64(0), since, Ok(U128(777)), Ok(deps)));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DepositStatus::LpConfirmed);
    assert_eq!(d.lp_shares.0, 777);
    assert!(d.lp_verified);
}

#[test]
fn stale_reconcile_is_ignored() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_lp(U64(0), Some(plan()));
    ctx.set(TREASURY);
    assert!(!t.on_reconcile(U64(0), U64(123_456), Ok(U128(0)), Ok(HashMap::new())));
    assert_eq!(status(&t, 0), DepositStatus::AmmDepositPending);
}

// ------------------------- withdrawals -------------------------

#[test]
#[should_panic(expected = "ERR_LP_LOCKED")]
fn lp_cannot_be_withdrawn_before_unlock() {
    let ctx = Ctx { now: 1_000 };
    let mut t = ready_treasury(&ctx);
    happy_path(&mut t, &ctx);
    ctx.set_with_deposit(ALICE, 1);
    t.withdraw_lp(U64(0));
}

#[test]
#[should_panic(expected = "ERR_NOT_CREATOR")]
fn lp_cannot_be_withdrawn_by_someone_else() {
    let mut ctx = Ctx { now: 1_000 };
    let mut t = ready_treasury(&ctx);
    happy_path(&mut t, &ctx);
    ctx.now += LOCK_NS;
    ctx.set_with_deposit(BOB, 1);
    t.withdraw_lp(U64(0));
}

#[test]
fn lp_withdraw_after_unlock_and_failure_rollback() {
    let mut ctx = Ctx { now: 1_000 };
    let mut t = ready_treasury(&ctx);
    happy_path(&mut t, &ctx);
    ctx.now += LOCK_NS;
    ctx.set_with_deposit(ALICE, 1);
    t.withdraw_lp(U64(0));
    assert_eq!(status(&t, 0), DepositStatus::LpWithdrawPending);

    ctx.set_results(vec![PromiseResult::Failed]);
    assert!(!t.on_lp_withdraw(U64(0)));
    assert_eq!(status(&t, 0), DepositStatus::LpConfirmed);
    assert_eq!(t.get_accounting().recorded_shares.0, 5_000);

    ctx.set_with_deposit(ALICE, 1);
    t.withdraw_lp(U64(0));
    ctx.set_results(vec![PromiseResult::Successful(vec![])]);
    assert!(t.on_lp_withdraw(U64(0)));
    assert_eq!(status(&t, 0), DepositStatus::LpWithdrawn);
    assert_eq!(t.get_accounting().recorded_shares.0, 0);
    // second callback (replay) does nothing
    assert!(!t.on_lp_withdraw(U64(0)));
}

#[test]
#[should_panic(expected = "ERR_INSUFFICIENT_RESERVE")]
fn reserve_withdraw_is_bounded() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set_with_deposit(ALICE, 1);
    t.withdraw_reserve(U128(1_600_001));
}

#[test]
#[should_panic(expected = "ERR_INSUFFICIENT_RESERVE")]
fn reserve_of_someone_else_cannot_be_withdrawn() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set_with_deposit(BOB, 1);
    t.withdraw_reserve(U128(1));
}

#[test]
fn reserve_withdraw_failure_recredits() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set_with_deposit(ALICE, 1);
    t.withdraw_reserve(U128(600_000));
    assert_eq!(t.get_reserve(acc(ALICE)).0, 1_000_000);
    ctx.set_results(vec![PromiseResult::Failed]);
    assert!(!t.on_reserve_withdraw(acc(ALICE), U128(600_000)));
    assert_eq!(t.get_reserve(acc(ALICE)).0, 1_600_000);
    assert_eq!(t.get_accounting().reserve_total.0, 1_600_000);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn reserve_withdraw_requires_one_yocto() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.withdraw_reserve(U128(1));
}

// ------------------------- setup -------------------------

#[test]
fn setup_validates_pool_and_token_order() {
    let ctx = Ctx { now: 1 };
    let mut t = new_treasury(&ctx);
    let pool = |a: &str, b: &str, kind: &str| {
        format!(
            r#"{{"pool_kind":"{kind}","token_account_ids":["{a}","{b}"],"amounts":["0","0"],"total_fee":30,"shares_total_supply":"0","amp":0}}"#
        )
        .into_bytes()
    };
    ctx.set_results(vec![PromiseResult::Successful(vec![]), PromiseResult::Successful(pool(USDC, "x.testnet", "SIMPLE_POOL"))]);
    assert!(!t.on_setup_done());
    assert!(!t.get_config().ready);

    ctx.set_results(vec![PromiseResult::Successful(vec![]), PromiseResult::Successful(pool(WNEAR, USDC, "STABLE_SWAP"))]);
    assert!(!t.on_setup_done());

    ctx.set_results(vec![PromiseResult::Failed, PromiseResult::Successful(pool(WNEAR, USDC, "SIMPLE_POOL"))]);
    assert!(!t.on_setup_done(), "register_tokens failed");

    ctx.set_results(vec![PromiseResult::Successful(vec![]), PromiseResult::Successful(pool(WNEAR, USDC, "SIMPLE_POOL"))]);
    assert!(t.on_setup_done());
    let c = t.get_config();
    assert!(c.ready);
    assert_eq!(c.usdc_pool_index, 1);
    assert_eq!((c.lp_bps, c.reserve_bps, c.community_bps), (9000, 800, 200));
}

#[test]
#[should_panic(expected = "ERR_SETUP_DEPOSIT")]
fn setup_requires_deposit() {
    let ctx = Ctx { now: 1 };
    let mut t = new_treasury(&ctx);
    ctx.set_with_deposit(ALICE, 1);
    t.setup();
}

#[test]
fn pool_order_follows_pool_tokens() {
    let ctx = Ctx { now: 1 };
    let mut t = ready_treasury(&ctx);
    assert_eq!(t.pool_order(5, 9), vec![U128(5), U128(9)]);
    t.usdc_pool_index = 1;
    assert_eq!(t.pool_order(5, 9), vec![U128(9), U128(5)]);
}
