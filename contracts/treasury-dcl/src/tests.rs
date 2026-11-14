//! Unit tests (MOCKED NEAR VM). They prove contract rules and state transitions; the behaviour of the real
//! Rhea DCL / Nearly token code is proven separately in the local sandbox (sandbox-tests/tests/v42_dcl.rs).
#![allow(unused_must_use)]
use super::*;
use crate::plan::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult};

const USDC: &str = "usdc.tidepool-sandbox.testnet";
const MEME: &str = "meme.sol2near-dev.testnet";
const WNEAR: &str = "wnear.tidepool-sandbox.testnet";
const DEX: &str = "dclv2.ref-dev.testnet";
const TREASURY: &str = "treasury-dcl.sol2near-dev.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const LOCK_NS: u64 = 600 * 1_000_000_000;
const T0: u64 = 1_000 * 1_000_000_000;
const MIN: u64 = 60 * 1_000_000_000;
const E18: u128 = 1_000_000_000_000_000_000;
const E24: u128 = 1_000_000_000_000_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn pool_id() -> String {
    format!("{MEME}|{WNEAR}|10000")
}
fn usdc_pool() -> String {
    format!("{USDC}|{WNEAR}|2000")
}

struct Ctx {
    now: u64,
}
impl Ctx {
    fn b(&self, p: &str) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc(TREASURY)).predecessor_account_id(acc(p)).signer_account_id(acc(p)).block_timestamp(self.now).prepaid_gas(Gas::from_tgas(300));
        b
    }
    fn set(&self, p: &str) {
        testing_env!(self.b(p).build());
    }
    fn set_yocto(&self, p: &str, y: u128) {
        testing_env!(self.b(p).attached_deposit(NearToken::from_yoctonear(y)).build());
    }
    fn results(&self, r: Vec<PromiseResult>) {
        testing_env!(self.b(TREASURY).build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), r);
    }
}
fn ok(v: Value) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&v).unwrap())
}
fn cfg_pool() -> DclPoolConfig {
    DclPoolConfig {
        dex: acc(DEX),
        pool_id: pool_id(),
        token_x: acc(MEME),
        token_y: acc(WNEAR),
        x_decimals: 18,
        y_decimals: 24,
        fee: 10000,
        point_delta: 200,
        usdc_token: acc(USDC),
        usdc_decimals: 6,
        route_x: vec![usdc_pool(), pool_id()],
        route_y: vec![usdc_pool()],
    }
}
fn guards() -> DclGuards {
    DclGuards { max_slippage_bps: 100, max_price_impact_bps: 1_000, max_plan_ttl_ns: U64(10 * MIN), min_range_width: 4_000, max_range_width: 200_000 }
}
fn new_t(ctx: &Ctx) -> TreasuryDcl {
    ctx.set(TREASURY);
    TreasuryDcl::new("testnet".into(), cfg_pool(), U128(1_000_000), U64(LOCK_NS), guards())
}
fn ready_t(ctx: &Ctx) -> TreasuryDcl {
    let mut t = new_t(ctx);
    t.ready = true;
    t
}
fn deposit(t: &mut TreasuryDcl, ctx: &Ctx, from: &str, amount: u128) -> u128 {
    ctx.set(USDC);
    match t.ft_on_transfer(acc(from), U128(amount), r#"{"action":"deposit"}"#.into()) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("promise"),
    }
}
fn pool_view(current: i32) -> DclPoolView {
    DclPoolView {
        pool_id: pool_id(),
        token_x: acc(MEME),
        token_y: acc(WNEAR),
        fee: 10000,
        point_delta: 200,
        current_point: current,
        state: "Running".into(),
        tax: None,
        liquidity: U128(1),
    }
}
/// 18 USDC LP budget: 9 → MEME (min 900 MEME), 9 → wNEAR (min 4.5 wNEAR).
fn plan(ctx: &Ctx) -> DclPlan {
    DclPlan {
        usdc_to_x: U128(9_000_000),
        usdc_to_y: U128(8_000_000),
        min_x_out: U128(900 * E18),
        min_y_out: U128(4 * E24),
        left_point: -20_000,
        right_point: 20_000,
        amount_x: U128(890 * E18),
        amount_y: U128(39 * E24 / 10),
        min_amount_x: U128(875 * E18),
        min_amount_y: U128(383 * E24 / 100),
        deadline_ns: U64(ctx.now + 5 * MIN),
    }
}
fn q(v: u128) -> PromiseResult {
    ok(json!({ "amount": v.to_string(), "tag": null }))
}
/// predict_hotzap shape measured on the real DCL: need + what is left after add
fn predict_v(out_x: u128, out_y: u128, need_x: u128, need_y: u128) -> Value {
    json!([[{ "need_x": need_x.to_string(), "need_y": need_y.to_string(), "liquidity_amount": "318" }], { MEME: (out_x - need_x).to_string(), WNEAR: (out_y - need_y).to_string() }])
}
fn pred(out_x: u128, out_y: u128, need_x: u128, need_y: u128) -> Prediction {
    parse_predict(&predict_v(out_x, out_y, need_x, need_y), &cfg_pool()).unwrap()
}
/// simulation consistent with the plan and low impact
fn preflight_ok(current: i32) -> Vec<PromiseResult> {
    vec![ok(serde_json::to_value(pool_view(current)).unwrap()), ok(predict_v(905 * E18, 402 * E24 / 100, 889 * E18, 39 * E24 / 10)), q(905 * E18 / 1000), q(402 * E24 / 100_000)]
}
fn row(lpt: &str, owner: &str, left: i32, right: i32, amount: u128) -> Value {
    json!({ "lpt_id": lpt, "owner_id": owner, "pool_id": pool_id(), "left_point": left, "right_point": right, "amount": amount.to_string(),
        "mft_id": "", "v_liquidity": "0", "unclaimed_fee_x": "0", "unclaimed_fee_y": "0" })
}
fn lpt(n: u32) -> String {
    format!("{}#{n}", pool_id())
}
fn view_of(lpt_id: &str, owner: &str) -> Value {
    json!({ "lpt_id": lpt_id, "owner_id": owner, "amount": "318385873595859217349", "token_x": (880 * E18).to_string(), "token_y": (38 * E24 / 10).to_string(),
        "fee_x": "0", "fee_y": "0", "left_point": -20000, "right_point": 20000, "pool_id": pool_id(), "mft_id": "", "v_liquidity": "0" })
}
trait EqValue {
    fn eq_value(&self) -> bool;
}
impl EqValue for PromiseOrValue<bool> {
    fn eq_value(&self) -> bool {
        matches!(self, PromiseOrValue::Value(true))
    }
}
fn status(t: &TreasuryDcl, id: u64) -> DclStatus {
    t.get_deposit(U64(id)).unwrap().status
}

/// deposit 20 USDC, run the whole creation path with mocked results; leftovers 20 MEME + 0.2 wNEAR in the DCL
fn confirmed(ctx: &mut Ctx) -> TreasuryDcl {
    let mut t = ready_t(ctx);
    deposit(&mut t, ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_dcl_lp(U64(0), plan(ctx));
    ctx.results(preflight_ok(0));
    t.on_preflight(U64(0));
    ctx.results(vec![]);
    t.on_zap(U64(0), Ok(U128(17_000_000)));
    ctx.results(vec![]);
    t.on_lookup(U64(0), Ok(serde_json::from_value(json!([row(&lpt(5), TREASURY, -20_000, 20_000, 318)])).unwrap()));
    ctx.results(vec![]);
    let assets: HashMap<AccountId, U128> = [(acc(MEME), U128(20 * E18)), (acc(WNEAR), U128(2 * E24 / 10))].into_iter().collect();
    assert!(t.on_confirm(U64(0), Ok(Some(serde_json::from_value(view_of(&lpt(5), TREASURY)).unwrap())), Ok(assets)));
    t
}

// ---------------- init / network ----------------

#[test]
#[should_panic(expected = "ERR_NETWORK_ACCOUNT")]
fn mainnet_dex_refused_at_init() {
    let ctx = Ctx { now: T0 };
    ctx.set(TREASURY);
    let mut p = cfg_pool();
    p.dex = acc("dclv2.ref-labs.near");
    TreasuryDcl::new("testnet".into(), p, U128(1), U64(LOCK_NS), guards());
}
#[test]
#[should_panic(expected = "ERR_NETWORK")]
fn mainnet_network_refused() {
    let ctx = Ctx { now: T0 };
    ctx.set(TREASURY);
    TreasuryDcl::new("mainnet".into(), cfg_pool(), U128(1), U64(LOCK_NS), guards());
}
#[test]
#[should_panic(expected = "ERR_POOL_ID_FORMAT")]
fn pool_id_must_match_tokens_and_fee() {
    let ctx = Ctx { now: T0 };
    ctx.set(TREASURY);
    let mut p = cfg_pool();
    p.pool_id = format!("{MEME}|{WNEAR}|2000");
    TreasuryDcl::new("testnet".into(), p, U128(1), U64(LOCK_NS), guards());
}
#[test]
#[should_panic(expected = "ERR_GUARD_SLIPPAGE")]
fn guard_ceiling_cannot_be_disabled() {
    let ctx = Ctx { now: T0 };
    ctx.set(TREASURY);
    let mut g = guards();
    g.max_slippage_bps = 5_000;
    TreasuryDcl::new("testnet".into(), cfg_pool(), U128(1), U64(LOCK_NS), g);
}

// ---------------- setup checks (pure) ----------------

#[test]
fn target_pool_identity_fee_state_and_tax() {
    let c = cfg_pool();
    assert!(check_target_pool(&c, &pool_view(0)).is_ok());
    let mut p = pool_view(0);
    p.token_x = acc("imposter.testnet");
    assert!(check_target_pool(&c, &p).is_err());
    let mut p = pool_view(0);
    p.fee = 2000;
    assert!(check_target_pool(&c, &p).is_err());
    let mut p = pool_view(0);
    p.state = "Paused".into();
    assert!(check_target_pool(&c, &p).unwrap_err().contains("state"));
    let mut p = pool_view(0);
    p.tax = Some(json!({ "rate": 100 }));
    assert!(check_target_pool(&c, &p).unwrap_err().contains("tax"));
}
#[test]
fn routes_must_connect_usdc_to_each_token() {
    let up = DclPoolView { pool_id: usdc_pool(), token_x: acc(USDC), token_y: acc(WNEAR), ..pool_view(0) };
    assert!(check_route(&[usdc_pool(), pool_id()], &[up.clone(), pool_view(0)], USDC, MEME).is_ok());
    assert!(check_route(&[usdc_pool()], &[up.clone()], USDC, WNEAR).is_ok());
    assert!(check_route(&[usdc_pool()], &[up.clone()], USDC, MEME).unwrap_err().contains("ends at"));
    assert!(check_route(&[pool_id()], &[pool_view(0)], USDC, MEME).unwrap_err().contains("does not hold"));
    assert!(check_route(&[], &[], USDC, MEME).is_err());
}
#[test]
fn tax_tokens_are_blocked_and_untaxed_pass() {
    assert!(tax_verdict(None).is_ok(), "method absent (raw token) = no Nearly tax");
    assert!(tax_verdict(Some(&json!({ "tax": null, "pending": "0" }))).is_ok());
    let taxed = json!({ "tax": { "buy_bps": 300, "sell_bps": 400, "pairs": [DEX], "admin": "f.testnet" }, "pending": "0" });
    assert!(tax_verdict(Some(&taxed)).unwrap_err().contains("BLOCKED_TAX"));
    let sell_only = json!({ "tax": { "buy_bps": 0, "sell_bps": 100 } });
    assert!(tax_verdict(Some(&sell_only)).is_err());
    let zero = json!({ "tax": { "buy_bps": 0, "sell_bps": 0 } });
    assert!(tax_verdict(Some(&zero)).is_ok());
    let unreadable = json!({ "tax": { "something": 1 } });
    assert!(tax_verdict(Some(&unreadable)).is_err(), "an unparseable tax object is refused, not ignored");
}
#[test]
fn setup_refuses_a_taxed_token() {
    let ctx = Ctx { now: T0 };
    let mut t = new_t(&ctx);
    let up = json!({ "pool_id": usdc_pool(), "token_x": USDC, "token_y": WNEAR, "fee": 2000, "point_delta": 40, "current_point": 403960, "state": "Running", "tax": null, "liquidity": "1" });
    let target = serde_json::to_value(pool_view(0)).unwrap();
    let mk = |tax_x: PromiseResult| {
        vec![ok(json!(null)), ok(target.clone()), ok(json!({ "decimals": 6 })), ok(json!({ "decimals": 18 })), ok(json!({ "decimals": 24 })), tax_x, PromiseResult::Failed, ok(up.clone()), ok(target.clone()), ok(up.clone())]
    };
    ctx.results(mk(ok(json!({ "tax": { "buy_bps": 300, "sell_bps": 400 } }))));
    assert!(!t.on_setup_done());
    assert!(t.setup_error.clone().unwrap().contains("BLOCKED_TAX"));
    ctx.results(mk(PromiseResult::Failed));
    assert!(t.on_setup_done(), "{:?}", t.setup_error);
    assert!(t.ready);
}
#[test]
fn setup_refuses_wrong_decimals() {
    let ctx = Ctx { now: T0 };
    let mut t = new_t(&ctx);
    let target = serde_json::to_value(pool_view(0)).unwrap();
    ctx.results(vec![ok(json!(null)), ok(target), ok(json!({ "decimals": 6 })), ok(json!({ "decimals": 24 })), ok(json!({ "decimals": 24 }))]);
    assert!(!t.on_setup_done());
    assert!(t.setup_error.clone().unwrap().contains("decimals x"));
}

// ---------------- plan guards (pure) ----------------

#[test]
fn plan_guards() {
    let ctx = Ctx { now: T0 };
    let c = Config { network: "testnet".into(), pool: cfg_pool(), min_deposit: U128(1), lock_duration_ns: U64(LOCK_NS), guards: guards() };
    let b = 18_000_000;
    assert_eq!(check_plan(&c, &plan(&ctx), b, ctx.now), Ok(()));
    let bad = |f: &dyn Fn(&mut DclPlan)| {
        let mut p = plan(&ctx);
        f(&mut p);
        check_plan(&c, &p, b, ctx.now).unwrap_err()
    };
    assert_eq!(bad(&|p| p.usdc_to_x = U128(0)), "ERR_PLAN_SWAP_ZERO");
    assert_eq!(bad(&|p| p.usdc_to_y = U128(10_000_000)), "ERR_PLAN_OVER_BUDGET");
    assert_eq!(bad(&|p| p.min_x_out = U128(0)), "ERR_PLAN_NO_SLIPPAGE_GUARD");
    assert_eq!(bad(&|p| (p.left_point, p.right_point) = (20_000, -20_000)), "ERR_RANGE_ORDER");
    assert_eq!(bad(&|p| p.left_point = -20_100), "ERR_RANGE_NOT_ON_POINT_DELTA");
    assert_eq!(bad(&|p| p.left_point = -900_000), "ERR_RANGE_BOUNDS");
    assert_eq!(bad(&|p| (p.left_point, p.right_point) = (-1_000, 1_000)), "ERR_RANGE_WIDTH");
    assert_eq!(bad(&|p| (p.left_point, p.right_point) = (-200_000, 200_000)), "ERR_RANGE_WIDTH");
    assert_eq!(bad(&|p| p.amount_x = U128(901 * E18)), "ERR_PLAN_AMOUNT_ABOVE_MIN_OUT");
    assert_eq!(bad(&|p| p.min_amount_x = U128(800 * E18)), "ERR_PLAN_MIN_AMOUNTS_TOO_LOOSE");
    assert_eq!(bad(&|p| p.min_amount_y = U128(5 * E24)), "ERR_PLAN_MIN_AMOUNTS_ABOVE_AMOUNTS");
    assert_eq!(bad(&|p| p.deadline_ns = U64(T0)), "ERR_PLAN_EXPIRED");
    assert_eq!(bad(&|p| p.deadline_ns = U64(T0 + 60 * MIN)), "ERR_PLAN_DEADLINE_TOO_FAR");
}
#[test]
fn preflight_out_of_range_slippage_and_impact() {
    let ctx = Ctx { now: T0 };
    let c = Config { network: "testnet".into(), pool: cfg_pool(), min_deposit: U128(1), lock_duration_ns: U64(LOCK_NS), guards: guards() };
    let p = plan(&ctx);
    let (qx, qy) = (905 * E18, 402 * E24 / 100);
    let good = pred(qx, qy, 889 * E18, 39 * E24 / 10);
    assert_eq!((good.out_x, good.need_x), (qx, 889 * E18), "out = left + need");
    assert!(check_preflight(&c, &p, &pool_view(0), &good, qx / 1000, qy / 1000).is_ok());
    // price moved outside the planned range (or onto its edge): position would not be active at entry
    assert!(check_preflight(&c, &p, &pool_view(25_000), &good, qx / 1000, qy / 1000).unwrap_err().contains("out of range"));
    assert!(check_preflight(&c, &p, &pool_view(20_000), &good, qx / 1000, qy / 1000).unwrap_err().contains("out of range"));
    // simulated output fell below min_out (zap would revert anyway)
    let low = pred(899 * E18, qy, 880 * E18, 39 * E24 / 10);
    assert!(check_preflight(&c, &p, &pool_view(0), &low, 899 * E18 / 1000, qy / 1000).unwrap_err().contains("below min_out"));
    // min_out much looser than 1 % of the simulated output
    let rich = pred(1_000 * E18, qy, 889 * E18, 39 * E24 / 10);
    assert!(check_preflight(&c, &p, &pool_view(0), &rich, E18, qy / 1000).unwrap_err().contains("looser"));
    // the simulated position would take less than the plan's minimum (ratio off): refused before sending
    let lopsided = pred(qx, qy, 600 * E18, 39 * E24 / 10);
    assert!(check_preflight(&c, &p, &pool_view(0), &lopsided, qx / 1000, qy / 1000).unwrap_err().contains("below min_amount"));
    let empty = Prediction { liquidity: 0, ..good };
    assert!(check_preflight(&c, &p, &pool_view(0), &empty, qx / 1000, qy / 1000).unwrap_err().contains("liquidity is 0"));
    // price impact: small quote says 1 USDC-unit buys 2x more than the large trade's average
    assert!(check_preflight(&c, &p, &pool_view(0), &good, qx / 500, qy / 1000).unwrap_err().contains("impact_x"));
    let mut taxed = pool_view(0);
    taxed.tax = Some(json!({ "rate": 1 }));
    assert!(check_preflight(&c, &p, &taxed, &good, qx / 1000, qy / 1000).is_err());
}
#[test]
fn find_position_matches_owner_pool_range_and_skips_known() {
    let rows: Vec<DclLiquidityRow> = serde_json::from_value(json!([
        row(&lpt(3), TREASURY, -20_000, 20_000, 10),
        row(&lpt(9), BOB, -20_000, 20_000, 10),
        row(&lpt(7), TREASURY, -20_000, 20_000, 10),
        row(&lpt(8), TREASURY, -40_000, 20_000, 10),
        row(&lpt(10), TREASURY, -20_000, 20_000, 0),
    ]))
    .unwrap();
    let f = find_new_position(&rows, TREASURY, &pool_id(), -20_000, 20_000, |_| false).unwrap();
    assert_eq!(f.lpt_id, lpt(7), "newest matching, owned by Treasury, liquidity > 0");
    let f = find_new_position(&rows, TREASURY, &pool_id(), -20_000, 20_000, |id| id == lpt(7)).unwrap();
    assert_eq!(f.lpt_id, lpt(3));
    assert!(find_new_position(&rows, TREASURY, &pool_id(), -20_000, 20_000, |_| true).is_none());
}
#[test]
fn hotzap_message_uses_only_configured_routes() {
    let ctx = Ctx { now: T0 };
    let m: Value = serde_json::from_str(&hotzap_msg(&cfg_pool(), &plan(&ctx))).unwrap();
    let hz = &m["HotZap"];
    assert_eq!(hz["swap_infos"][0]["pool_ids"], json!([usdc_pool(), pool_id()]));
    assert_eq!(hz["swap_infos"][1]["pool_ids"], json!([usdc_pool()]));
    assert_eq!(hz["swap_infos"][0]["input_token"], USDC);
    assert_eq!(hz["swap_infos"][0]["min_output_amount"], (900 * E18).to_string());
    assert_eq!(hz["add_liquidity_infos"][0]["pool_id"], pool_id());
    assert_eq!(hz["add_liquidity_infos"][0]["left_point"], -20_000);
    assert_eq!(hz["add_liquidity_infos"].as_array().unwrap().len(), 1);
}

// ---------------- intake ----------------

#[test]
fn deposit_split_and_refusals() {
    let ctx = Ctx { now: T0 };
    let mut t = new_t(&ctx);
    assert_eq!(deposit(&mut t, &ctx, ALICE, 20_000_000), 20_000_000, "not ready → refunded");
    t.ready = true;
    assert_eq!(deposit(&mut t, &ctx, ALICE, 999_999), 999_999, "below min");
    ctx.set(MEME);
    assert!(matches!(t.ft_on_transfer(acc(ALICE), U128(5), r#"{"action":"deposit"}"#.into()), PromiseOrValue::Value(U128(5))));
    assert_eq!(deposit(&mut t, &ctx, ALICE, 20_000_000), 0);
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.lp_budget.0, d.reserve.0, d.community.0), (18_000_000, 1_600_000, 400_000));
    assert_eq!(t.get_balance(acc(ALICE), acc(USDC)).0, 1_600_000);
}

// ---------------- creation flow ----------------

#[test]
fn full_creation_records_the_position_and_leftovers() {
    let mut ctx = Ctx { now: T0 };
    let t = confirmed(&mut ctx);
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DclStatus::PositionConfirmed);
    assert_eq!(d.lpt_id, Some(lpt(5)));
    assert_eq!((d.left_point, d.right_point), (Some(-20_000), Some(20_000)));
    assert_eq!(d.liquidity.0, 318385873595859217349);
    assert_eq!(d.usdc_used.0, 17_000_000);
    // 18 budget - 17 sent = 1 USDC back to the reserve, plus the 1.6 reserve
    assert_eq!(d.usdc_unused_to_reserve.0, 1_000_000);
    assert_eq!(t.get_balance(acc(ALICE), acc(USDC)).0, 2_600_000);
    assert_eq!((d.dex_x.0, d.dex_y.0), (20 * E18, 2 * E24 / 10));
    assert_eq!(d.unlock_at, Some(U64(T0 + LOCK_NS)));
    assert!(t.in_flight.is_none());
    assert_eq!(t.live_positions, 1);
    assert_eq!(t.pending_budget_total + t.zap_outstanding, 0);
    // USDC conservation: received = used by DCL + owed + community
    assert_eq!(t.total_received, d.usdc_used.0 + t.owed_usdc + t.community_total);
    let pos = t.get_position(U64(0)).unwrap();
    assert_eq!(pos["fuel_status"], "FUEL_NOT_ELIGIBLE");
    assert_eq!(pos["locked"], true);
}
#[test]
#[should_panic(expected = "ERR_NOT_CREATOR")]
fn only_the_creator_executes() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(BOB);
    t.execute_dcl_lp(U64(0), plan(&ctx));
}
#[test]
#[should_panic(expected = "ERR_JOB_IN_FLIGHT")]
fn one_job_at_a_time() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_dcl_lp(U64(0), plan(&ctx));
    t.execute_dcl_lp(U64(1), plan(&ctx));
}
#[test]
fn guard_failure_sends_nothing() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_dcl_lp(U64(0), plan(&ctx));
    ctx.results(preflight_ok(30_000)); // price outside the range
    assert!(matches!(t.on_preflight(U64(0)), PromiseOrValue::Value(false)));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!(d.status, DclStatus::BudgetAllocated);
    assert!(d.last_error.unwrap().contains("out of range"));
    assert_eq!(t.pending_budget_total, 18_000_000);
    assert!(t.in_flight.is_none());
}
#[test]
fn zap_refused_by_dcl_is_a_full_refund() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_dcl_lp(U64(0), plan(&ctx));
    ctx.results(preflight_ok(0));
    t.on_preflight(U64(0));
    assert_eq!(t.zap_outstanding, 17_000_000);
    ctx.results(vec![]);
    t.on_zap(U64(0), Ok(U128(0)));
    assert_eq!(status(&t, 0), DclStatus::BudgetAllocated);
    assert_eq!((t.pending_budget_total, t.zap_outstanding), (18_000_000, 0));
    assert!(t.get_deposit(U64(0)).unwrap().lpt_id.is_none(), "no position recorded");
}
#[test]
fn replayed_callbacks_are_ignored() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.results(vec![]);
    assert!(matches!(t.on_zap(U64(0), Ok(U128(17_000_000))), PromiseOrValue::Value(false)));
    assert!(matches!(t.on_lookup(U64(0), Ok(vec![])), PromiseOrValue::Value(false)));
    assert!(!t.on_confirm(U64(0), Ok(None), Ok(HashMap::new())));
    assert_eq!(status(&t, 0), DclStatus::PositionConfirmed);
    assert_eq!(t.live_positions, 1);
}
#[test]
fn missing_position_keeps_the_job_for_reconcile() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_dcl_lp(U64(0), plan(&ctx));
    ctx.results(preflight_ok(0));
    t.on_preflight(U64(0));
    ctx.results(vec![]);
    t.on_zap(U64(0), Ok(U128(17_000_000)));
    ctx.results(vec![]);
    // a row from someone else, and one with another range: no match
    let rows = serde_json::from_value(json!([row(&lpt(2), BOB, -20_000, 20_000, 9), row(&lpt(3), TREASURY, -40_000, 40_000, 9)])).unwrap();
    t.on_lookup(U64(0), Ok(rows));
    let d = t.get_deposit(U64(0)).unwrap();
    assert!(matches!(d.status, DclStatus::LookupPending { .. }));
    assert!(d.lpt_id.is_none(), "nothing recorded without on-chain evidence");
    assert!(t.in_flight.is_some());
}
#[test]
fn confirm_refuses_a_position_not_owned_by_treasury() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_dcl_lp(U64(0), plan(&ctx));
    ctx.results(preflight_ok(0));
    t.on_preflight(U64(0));
    ctx.results(vec![]);
    t.on_zap(U64(0), Ok(U128(17_000_000)));
    t.on_lookup(U64(0), Ok(serde_json::from_value(json!([row(&lpt(5), TREASURY, -20_000, 20_000, 318)])).unwrap()));
    assert!(!t.on_confirm(U64(0), Ok(Some(serde_json::from_value(view_of(&lpt(5), BOB)).unwrap())), Ok(HashMap::new())));
    assert!(matches!(status(&t, 0), DclStatus::ConfirmPending { .. }));
}

// ---------------- fees ----------------

#[test]
fn fees_booked_from_dcl_return_and_no_double_count() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.set(ALICE);
    t.claim_fees(U64(0));
    ctx.results(vec![]);
    assert!(t.on_fees(U64(0), Ok(vec![U128(5 * E18), U128(8 * E24 / 1000)])));
    ctx.set(ALICE);
    t.claim_fees(U64(0));
    ctx.results(vec![]);
    assert!(t.on_fees(U64(0), Ok(vec![U128(0), U128(0)])));
    // replay of the first result does nothing
    assert!(!t.on_fees(U64(0), Ok(vec![U128(5 * E18), U128(1)])));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.fees_claimed_x.0, d.fees_claimed_y.0), (5 * E18, 8 * E24 / 1000));
    assert_eq!(d.dex_x.0, 25 * E18, "20 leftover + 5 fees");
    assert_eq!(t.dex_booked_x, 25 * E18);
}
#[test]
fn zero_fees_out_of_range_is_not_an_error() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.set(ALICE);
    t.claim_fees(U64(0));
    ctx.results(vec![]);
    assert!(t.on_fees(U64(0), Ok(vec![U128(0), U128(0)])));
    assert_eq!(status(&t, 0), DclStatus::PositionConfirmed);
}
#[test]
fn failed_fee_claim_does_not_block_other_jobs() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.set(ALICE);
    t.claim_fees(U64(0));
    ctx.results(vec![]);
    assert!(!t.on_fees(U64(0), Err(PromiseError::Failed)));
    assert!(t.in_flight.is_none(), "the lock is released");
    deposit(&mut t, &ctx, BOB, 20_000_000);
    ctx.set(BOB);
    t.execute_dcl_lp(U64(1), plan(&ctx)); // another position can proceed
    assert_eq!(status(&t, 1), DclStatus::PreflightPending);
}
#[test]
fn lost_fee_callback_reconciled_from_dcl_balances() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.set(ALICE);
    t.claim_fees(U64(0));
    ctx.now += RECONCILE_TIMEOUT_NS;
    ctx.set(BOB);
    t.reconcile();
    ctx.results(vec![]);
    let assets: HashMap<AccountId, U128> = [(acc(MEME), U128(23 * E18)), (acc(WNEAR), U128(2 * E24 / 10))].into_iter().collect();
    assert!(t.on_reconcile_fees(U64(0), Ok(assets)));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.fees_claimed_x.0, d.fees_claimed_y.0), (3 * E18, 0));
    assert!(t.in_flight.is_none());
}

// ---------------- exit ----------------

#[test]
#[should_panic(expected = "ERR_POSITION_LOCKED")]
fn withdraw_refused_during_lock() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.set_yocto(ALICE, 1);
    t.withdraw_position(U64(0));
}
#[test]
#[should_panic(expected = "ERR_NOT_CREATOR")]
fn withdraw_refused_to_others() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.now += LOCK_NS;
    ctx.set_yocto(BOB, 1);
    t.withdraw_position(U64(0));
}
#[test]
fn withdraw_after_lock_verified_by_owner_then_no_double() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.now += LOCK_NS;
    ctx.set_yocto(ALICE, 1);
    t.withdraw_position(U64(0));
    ctx.results(vec![]);
    let r: DclLiquidityRow = serde_json::from_value(row(&lpt(5), ALICE, -20_000, 20_000, 318)).unwrap();
    assert!(t.on_transfer_checked(U64(0), Ok(Some(r))));
    assert_eq!(status(&t, 0), DclStatus::PositionWithdrawn);
    assert_eq!(t.live_positions, 0);
    ctx.set_yocto(ALICE, 1);
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.withdraw_position(U64(0));
    }));
    assert!(again.is_err(), "second withdrawal refused");
}
#[test]
fn failed_nft_transfer_rolls_back() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.now += LOCK_NS;
    ctx.set_yocto(ALICE, 1);
    t.withdraw_position(U64(0));
    ctx.results(vec![]);
    let r: DclLiquidityRow = serde_json::from_value(row(&lpt(5), TREASURY, -20_000, 20_000, 318)).unwrap();
    assert!(!t.on_transfer_checked(U64(0), Ok(Some(r))));
    assert_eq!(status(&t, 0), DclStatus::PositionConfirmed);
    assert!(t.in_flight.is_none());
}
#[test]
fn dex_balance_credited_only_if_dcl_balance_dropped() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.set_yocto(ALICE, 1);
    t.withdraw_dex_balance(U64(0), acc(MEME));
    ctx.results(vec![]);
    // DCL still shows the full 20 MEME: transfer failed and was re-credited → nothing credited
    assert!(!t.on_dex_withdrawn(U64(0), acc(MEME), U128(20 * E18), Ok(Some(U128(20 * E18)))));
    assert_eq!(t.get_balance(acc(ALICE), acc(MEME)).0, 0);
    ctx.set_yocto(ALICE, 1);
    t.withdraw_dex_balance(U64(0), acc(MEME));
    ctx.results(vec![]);
    assert!(t.on_dex_withdrawn(U64(0), acc(MEME), U128(20 * E18), Ok(Some(U128(0)))));
    assert_eq!(t.get_balance(acc(ALICE), acc(MEME)).0, 20 * E18);
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.dex_x.0, d.recovered_x.0), (0, 20 * E18));
    ctx.set_yocto(ALICE, 1);
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.withdraw_dex_balance(U64(0), acc(MEME));
    }));
    assert!(again.is_err(), "nothing left: no double withdrawal");
}
#[test]
fn failed_token_transfer_is_recredited() {
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.set_yocto(ALICE, 1);
    t.withdraw_token(acc(USDC), U128(2_600_000));
    assert_eq!(t.get_balance(acc(ALICE), acc(USDC)).0, 0);
    ctx.results(vec![]);
    assert!(!t.on_token_sent(acc(ALICE), acc(USDC), U128(2_600_000), Err(PromiseError::Failed)));
    assert_eq!(t.get_balance(acc(ALICE), acc(USDC)).0, 2_600_000);
}
#[test]
fn abort_before_zap_returns_budget() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.abort(U64(0));
    assert_eq!(status(&t, 0), DclStatus::Aborted);
    assert_eq!(t.get_balance(acc(ALICE), acc(USDC)).0, 19_600_000);
    assert_eq!(t.pending_budget_total, 0);
}

// ---------------- reconcile ----------------

#[test]
fn reconcile_too_early_refused() {
    let ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_dcl_lp(U64(0), plan(&ctx));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.reconcile();
    }));
    assert!(r.is_err());
}
#[test]
fn reconcile_lost_preflight_sends_nothing() {
    let mut ctx = Ctx { now: T0 };
    let mut t = ready_t(&ctx);
    deposit(&mut t, &ctx, ALICE, 20_000_000);
    ctx.set(ALICE);
    t.execute_dcl_lp(U64(0), plan(&ctx));
    ctx.now += RECONCILE_TIMEOUT_NS;
    ctx.set(BOB);
    assert!(matches!(t.reconcile(), PromiseOrValue::Value(true)));
    assert_eq!(status(&t, 0), DclStatus::BudgetAllocated);
    assert_eq!(t.pending_budget_total, 18_000_000);
}
#[test]
fn reconcile_lost_zap_decided_by_the_dcl_not_by_the_usdc_balance() {
    for found in [false, true] {
        let mut ctx = Ctx { now: T0 };
        let mut t = ready_t(&ctx);
        deposit(&mut t, &ctx, ALICE, 20_000_000);
        ctx.set(ALICE);
        t.execute_dcl_lp(U64(0), plan(&ctx));
        ctx.results(preflight_ok(0));
        t.on_preflight(U64(0));
        ctx.now += RECONCILE_TIMEOUT_NS;
        ctx.set(BOB);
        t.reconcile();
        ctx.results(vec![]);
        // someone else's position in the same range never counts; only Treasury's own row does
        let mut rows = vec![row(&lpt(2), BOB, -20_000, 20_000, 9)];
        if found {
            rows.push(row(&lpt(5), TREASURY, -20_000, 20_000, 318));
        }
        t.on_reconcile_zap(U64(0), Ok(serde_json::from_value(json!(rows)).unwrap()));
        let d = t.get_deposit(U64(0)).unwrap();
        if found {
            assert_eq!(d.status, DclStatus::ConfirmPending { used: U128(17_000_000) });
            assert_eq!((d.usdc_used.0, d.lpt_id.clone()), (17_000_000, Some(lpt(5))));
        } else {
            assert_eq!(d.status, DclStatus::BudgetAllocated, "no position → refunded, whatever USDC was gifted to Treasury");
            assert_eq!(t.pending_budget_total, 18_000_000);
        }
        assert_eq!(t.zap_outstanding, 0);
        assert!(!t.on_reconcile_zap(U64(0), Ok(vec![])).eq_value(), "replay ignored");
    }
}

#[test]
fn ninety_eight_two_unchanged_by_fees_and_leftovers() {
    // fees and leftovers are booked in X/Y buckets and never touch the USDC split of the deposit
    let mut ctx = Ctx { now: T0 };
    let mut t = confirmed(&mut ctx);
    ctx.set(ALICE);
    t.claim_fees(U64(0));
    ctx.results(vec![]);
    t.on_fees(U64(0), Ok(vec![U128(E18), U128(E18)]));
    let d = t.get_deposit(U64(0)).unwrap();
    assert_eq!((d.lp_budget.0, d.reserve.0, d.community.0), (18_000_000, 1_600_000, 400_000));
    assert_eq!(d.usdc_used.0 + d.usdc_unused_to_reserve.0, d.lp_budget.0);
    assert_eq!(t.community_total, 400_000);
}
