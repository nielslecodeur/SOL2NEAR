//! Pure checks (no NEAR env), shared by the contract and its unit tests.
//! DCL facts used here were measured on the REAL dclv2.ref-labs.near v2.4.2 wasm in a local sandbox
//! (sandbox-tests/tests/v42_dcl_explore.rs, docs/V4_2A_DCL_FEASIBILITY.md):
//! - points must be multiples of the pool's point_delta (E200 otherwise) and left < right (E202);
//! - a range strictly above the current point holds only token_x, strictly below only token_y,
//!   and earns no fee while the price is outside it;
//! - `quote` returns `{"amount": "<atomic>"}` along a path of pool ids.
use crate::types::*;
use near_sdk::serde_json::Value;

pub const BPS: u128 = 10_000;
/// DCL point bounds (price 1.0001^point).
pub const POINT_MIN: i32 = -800_000;
pub const POINT_MAX: i32 = 800_000;
pub const MAX_ROUTE_HOPS: usize = 3;

pub fn bps_of(v: u128, bps: u128) -> u128 {
    v / BPS * bps + v % BPS * bps / BPS
}

/// Static plan validation (before any promise). `now` and `budget` come from the contract.
pub fn check_plan(cfg: &Config, p: &DclPlan, budget: u128, now: u64) -> Result<(), &'static str> {
    let g = &cfg.guards;
    let pd = cfg.pool.point_delta;
    if p.usdc_to_x.0 == 0 || p.usdc_to_y.0 == 0 {
        return Err("ERR_PLAN_SWAP_ZERO");
    }
    let spend = p.usdc_to_x.0.checked_add(p.usdc_to_y.0).ok_or("ERR_PLAN_OVERFLOW")?;
    if spend > budget {
        return Err("ERR_PLAN_OVER_BUDGET");
    }
    if p.min_x_out.0 == 0 || p.min_y_out.0 == 0 {
        return Err("ERR_PLAN_NO_SLIPPAGE_GUARD");
    }
    if p.left_point >= p.right_point {
        return Err("ERR_RANGE_ORDER");
    }
    if p.left_point < POINT_MIN || p.right_point > POINT_MAX {
        return Err("ERR_RANGE_BOUNDS");
    }
    if p.left_point % pd != 0 || p.right_point % pd != 0 {
        return Err("ERR_RANGE_NOT_ON_POINT_DELTA");
    }
    let width = p.right_point - p.left_point;
    if width < g.min_range_width || width > g.max_range_width {
        return Err("ERR_RANGE_WIDTH");
    }
    if p.amount_x.0 == 0 || p.amount_y.0 == 0 {
        return Err("ERR_PLAN_AMOUNT_ZERO");
    }
    // the zap must always be able to pay add_liquidity from its own swap outputs
    if p.amount_x.0 > p.min_x_out.0 || p.amount_y.0 > p.min_y_out.0 {
        return Err("ERR_PLAN_AMOUNT_ABOVE_MIN_OUT");
    }
    let floor = BPS - 2 * g.max_slippage_bps as u128;
    if p.min_amount_x.0 < bps_of(p.amount_x.0, floor) || p.min_amount_y.0 < bps_of(p.amount_y.0, floor) {
        return Err("ERR_PLAN_MIN_AMOUNTS_TOO_LOOSE");
    }
    if p.min_amount_x.0 > p.amount_x.0 || p.min_amount_y.0 > p.amount_y.0 {
        return Err("ERR_PLAN_MIN_AMOUNTS_ABOVE_AMOUNTS");
    }
    if p.deadline_ns.0 <= now {
        return Err("ERR_PLAN_EXPIRED");
    }
    if p.deadline_ns.0 > now + g.max_plan_ttl_ns.0 {
        return Err("ERR_PLAN_DEADLINE_TOO_FAR");
    }
    Ok(())
}

/// Target pool read in `setup` and right before the zap.
pub fn check_target_pool(cfg: &DclPoolConfig, pool: &DclPoolView) -> Result<(), String> {
    if pool.pool_id != cfg.pool_id || pool.token_x != cfg.token_x || pool.token_y != cfg.token_y {
        return Err(format!("pool identity differs: {} {} {}", pool.pool_id, pool.token_x, pool.token_y));
    }
    if pool.fee != cfg.fee || pool.point_delta != cfg.point_delta {
        return Err(format!("fee/point_delta {}/{} differ from config", pool.fee, pool.point_delta));
    }
    if pool.state != "Running" {
        return Err(format!("pool state {}", pool.state));
    }
    if pool.tax.as_ref().is_some_and(|t| !t.is_null()) {
        return Err("pool-level tax set (DCL create_pool_with_tax): not supported".into());
    }
    Ok(())
}

/// Route pools read in `setup`: each route must connect USDC to its target token through the listed pools.
pub fn check_route(route: &[String], pools: &[DclPoolView], from: &str, to: &str) -> Result<(), String> {
    if route.is_empty() || route.len() > MAX_ROUTE_HOPS || route.len() != pools.len() {
        return Err("route length".into());
    }
    let mut cur = from.to_string();
    for (id, p) in route.iter().zip(pools) {
        if &p.pool_id != id || p.state != "Running" {
            return Err(format!("route pool {id} not running or not found"));
        }
        if p.tax.as_ref().is_some_and(|t| !t.is_null()) {
            return Err(format!("route pool {id} has a pool-level tax"));
        }
        cur = if p.token_x.as_str() == cur {
            p.token_y.to_string()
        } else if p.token_y.as_str() == cur {
            p.token_x.to_string()
        } else {
            return Err(format!("route pool {id} does not hold {cur}"));
        };
    }
    if cur != to {
        return Err(format!("route ends at {cur}, not {to}"));
    }
    Ok(())
}

/// Token tax verdict from a `get_tax` view result (Nearly tax tokens expose it; others do not).
/// `None` = the view failed (method absent) → no Nearly-style tax. Any non-zero bps → refused.
pub fn tax_verdict(view: Option<&Value>) -> Result<(), String> {
    let Some(v) = view else { return Ok(()) };
    let t = &v["tax"];
    if t.is_null() {
        return Ok(());
    }
    let bps = |k: &str| t[k].as_u64().or_else(|| t[k].as_str().and_then(|s| s.parse().ok())).unwrap_or(u64::MAX);
    let (buy, sell) = (bps("buy_bps"), bps("sell_bps"));
    if buy == 0 && sell == 0 {
        return Ok(());
    }
    Err(format!("token transfer tax buy={buy} sell={sell} bps: BLOCKED_TAX"))
}

/// The target pool is still the configured one and its price sits strictly inside the planned range.
pub fn check_entry(cfg: &Config, p: &DclPlan, pool: &DclPoolView) -> Result<(), String> {
    check_target_pool(&cfg.pool, pool)?;
    if pool.current_point <= p.left_point || pool.current_point >= p.right_point {
        return Err(format!("price out of range: current point {} not in ({}, {})", pool.current_point, p.left_point, p.right_point));
    }
    Ok(())
}

/// DCL `predict_hotzap` result → amounts. Measured on the real wasm:
/// `[[{need_x, need_y, liquidity_amount}], {token: amount LEFT after add_liquidity}]`, so out = left + need.
/// The swaps are simulated in sequence (both legs share the USDC pool), which independent quotes are not.
pub fn parse_predict(v: &Value, cfg: &DclPoolConfig) -> Option<Prediction> {
    let n = &v[0][0];
    let num = |x: &Value| x.as_str().and_then(|s| s.parse::<u128>().ok());
    let (nx, ny, liq) = (num(&n["need_x"])?, num(&n["need_y"])?, num(&n["liquidity_amount"])?);
    let left = |t: &str| num(&v[1][t]).unwrap_or(0);
    Some(Prediction { out_x: left(cfg.token_x.as_str()) + nx, out_y: left(cfg.token_y.as_str()) + ny, need_x: nx, need_y: ny, liquidity: liq })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Prediction {
    pub out_x: u128,
    pub out_y: u128,
    pub need_x: u128,
    pub need_y: u128,
    pub liquidity: u128,
}

/// Right before the zap, from DCL's own views: the price must sit strictly inside the planned range (the
/// position is active at entry); each swap minimum within slippage of DCL's simulated output; the simulated
/// position must take at least the plan's minimum amounts; each swap's price impact bounded, where
/// `q_*_small` is the quote for `amount / 1000` (impact = 1 - out / (1000 * q_small)).
pub fn check_preflight(cfg: &Config, p: &DclPlan, pool: &DclPoolView, pr: &Prediction, q_x_small: u128, q_y_small: u128) -> Result<(), String> {
    let (q_x, q_y) = (pr.out_x, pr.out_y);
    if pr.liquidity == 0 {
        return Err("predicted liquidity is 0".into());
    }
    if pr.need_x < p.min_amount_x.0 || pr.need_y < p.min_amount_y.0 {
        return Err(format!("predicted position takes {} / {}, below min_amount {} / {}", pr.need_x, pr.need_y, p.min_amount_x.0, p.min_amount_y.0));
    }
    check_entry(cfg, p, pool)?;
    let slip = cfg.guards.max_slippage_bps as u128;
    for (name, q, min) in [("x", q_x, p.min_x_out.0), ("y", q_y, p.min_y_out.0)] {
        if q < min {
            return Err(format!("quote_{name} {q} below min_out {min}"));
        }
        if min < bps_of(q, BPS - slip) {
            return Err(format!("min_{name}_out {min} looser than {slip} bps of quote {q}"));
        }
    }
    for (name, q, qs) in [("x", q_x, q_x_small), ("y", q_y, q_y_small)] {
        let ideal = qs.saturating_mul(1_000);
        if ideal == 0 {
            return Err(format!("impact_{name}: no small quote"));
        }
        let impact = if q >= ideal { 0 } else { (ideal - q) * BPS / ideal };
        if impact > cfg.guards.max_price_impact_bps as u128 {
            return Err(format!("impact_{name} {impact} bps > {} bps", cfg.guards.max_price_impact_bps));
        }
    }
    Ok(())
}

/// Find the position a zap just created in a `list_liquidities` page: same pool and range, owned by
/// Treasury, not already recorded. The newest (highest `#n`) wins.
pub fn find_new_position<'a>(
    rows: &'a [DclLiquidityRow],
    me: &str,
    pool_id: &str,
    left: i32,
    right: i32,
    known: impl Fn(&str) -> bool,
) -> Option<&'a DclLiquidityRow> {
    let seq = |r: &DclLiquidityRow| r.lpt_id.rsplit('#').next().and_then(|n| n.parse::<u64>().ok()).unwrap_or(0);
    rows.iter()
        .filter(|r| r.owner_id.as_str() == me && r.pool_id == pool_id && r.left_point == left && r.right_point == right && r.amount.0 > 0)
        .filter(|r| !known(&r.lpt_id))
        .max_by_key(|r| seq(r))
}

/// The two parts of the `HotZap`: swaps along the fixed routes, then ONE add_liquidity.
pub fn hotzap_parts(cfg: &DclPoolConfig, p: &DclPlan) -> (Value, Value) {
    let v = near_sdk::serde_json::from_str::<Value>(&hotzap_msg(cfg, p)).expect("own json");
    (v["HotZap"]["swap_infos"].clone(), v["HotZap"]["add_liquidity_infos"].clone())
}

/// The `HotZap` message sent with the USDC `ft_transfer_call`.
pub fn hotzap_msg(cfg: &DclPoolConfig, p: &DclPlan) -> String {
    near_sdk::serde_json::json!({ "HotZap": {
        "swap_infos": [
            { "pool_ids": cfg.route_x, "input_token": cfg.usdc_token, "output_token": cfg.token_x, "amount_in": p.usdc_to_x, "min_output_amount": p.min_x_out },
            { "pool_ids": cfg.route_y, "input_token": cfg.usdc_token, "output_token": cfg.token_y, "amount_in": p.usdc_to_y, "min_output_amount": p.min_y_out },
        ],
        "add_liquidity_infos": [{
            "pool_id": cfg.pool_id, "left_point": p.left_point, "right_point": p.right_point,
            "amount_x": p.amount_x, "amount_y": p.amount_y, "min_amount_x": p.min_amount_x, "min_amount_y": p.min_amount_y,
        }],
    }})
    .to_string()
}
