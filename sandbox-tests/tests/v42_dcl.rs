#![allow(unused_must_use)]
//! V4.2A — TreasuryDCL end to end in a LOCAL SANDBOX (near-workspaces, neard). NOT a public-network proof.
//!
//! Real code everywhere except the chain itself:
//! - Rhea DCL: the wasm of dclv2.ref-labs.near v2.4.2 (mainnet code, fetched read-only, LOCAL state);
//! - wNEAR: the wasm of wrap.near; USDC: the wasm of usdc.tidepool-sandbox.testnet (local copy, 6 decimals);
//! - memecoins: the Nearly raw v1 token wasm ($NEARLY's code) and the Nearly tax v6 token wasm, both fetched by
//!   global code hash and equal byte for byte to github.com/sam3dsol/Nearlytrade; LOCAL test tokens, no value;
//! - TreasuryDCL: contracts/treasury-dcl built with cargo-near.
//! Pools and liquidity exist only in this sandbox. Nothing is a Nearly or mainnet pool.
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const E18: u128 = 1_000_000_000_000_000_000;
const E24: u128 = 1_000_000_000_000_000_000_000_000;
const USDC1: u128 = 1_000_000;
const MIN_NS: u64 = 60 * 1_000_000_000;
const LOCK_NS: u64 = 30 * 1_000_000_000;
const SLIP_BPS: u128 = 100;
const DEPOSIT_MSG: &str = r#"{"action":"deposit"}"#;

fn tgas(t: u64) -> Gas {
    Gas::from_tgas(t)
}
fn y(v: u128) -> NearToken {
    NearToken::from_yoctonear(v)
}
fn mn(v: u128) -> NearToken {
    NearToken::from_millinear(v)
}
fn u(v: &Value) -> u128 {
    v.as_str().map(|s| s.parse().unwrap()).unwrap_or_else(|| v.as_u64().unwrap_or(0) as u128)
}
fn events(r: &ExecutionFinalResult) -> Vec<String> {
    r.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .filter(|e| e["standard"] == "sol2near")
        .map(|e| e["event"].as_str().unwrap_or("?").to_string())
        .collect()
}
fn event_data(r: &ExecutionFinalResult, name: &str) -> Option<Value> {
    r.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .find(|e| e["standard"] == "sol2near" && e["event"] == name)
        .map(|e| e["data"][0].clone())
}
fn failure(r: &ExecutionFinalResult) -> String {
    r.receipt_failures().iter().map(|o| format!("{:?}", (*o).clone().into_result().err())).collect::<Vec<_>>().join(" | ")
}
fn burnt(r: &ExecutionFinalResult) -> u64 {
    r.total_gas_burnt.as_tgas()
}
// ---------- H2 proof recorder: every step is logged in order, then exported (scripts/proofs/export-nearly-proof.mjs) ----------
// "call" = a transaction sent (must / must_fail), "refusal" = the contract's job_failed reason, "rec" = the method,
// contract, arguments, result and the on-chain reads that prove it. LOCAL SANDBOX only.
static PROOF_LOG: std::sync::Mutex<Vec<Value>> = std::sync::Mutex::new(Vec::new());
fn log(v: Value) {
    PROOF_LOG.lock().unwrap().push(v);
}
fn rec(step: &str, contract: impl std::fmt::Display, method: &str, args: Value, result: Value, proof: Value) {
    log(json!({ "kind": "rec", "step": step, "contract": contract.to_string(), "method": method, "args": args, "result": result, "proof": proof }));
}
fn short_err(f: &str) -> String {
    match f.find("panicked: ") {
        Some(i) => f[i + 10..].split('"').next().unwrap_or("").trim_end_matches('\\').to_string(),
        None => f.chars().take(240).collect(),
    }
}
fn must(n: &str, what: &str, r: ExecutionFinalResult) -> anyhow::Result<ExecutionFinalResult> {
    println!("[{n}] {what}: {} · {} Tgas · events {:?}", if r.is_success() { "OK" } else { "FAILED" }, burnt(&r), events(&r));
    log(json!({ "kind": "call", "step": n, "what": what, "outcome": if r.is_success() { "success" } else { "failure" }, "gas_tgas": burnt(&r), "events": events(&r),
        "error": if r.is_success() { Value::Null } else { json!(short_err(&failure(&r))) } }));
    anyhow::ensure!(r.is_success(), "{what} failed: {}", failure(&r));
    Ok(r)
}
fn must_fail(n: &str, what: &str, r: ExecutionFinalResult, expect: &str) -> anyhow::Result<()> {
    let f = failure(&r);
    println!("[{n}] {what}: refused as expected ({})", if f.contains(expect) { expect } else { "?" });
    log(json!({ "kind": "call", "step": n, "what": what, "outcome": if r.is_success() { "success" } else { "failure" }, "expected_error": expect,
        "error": short_err(&f), "events": events(&r) }));
    anyhow::ensure!(!r.is_success() && f.contains(expect), "{what}: expected failure {expect}, got success={} {f}", r.is_success());
    Ok(())
}
/// The call succeeds as a transaction, but the contract refused the job and said why (event job_failed).
fn must_refuse(n: &str, what: &str, r: &ExecutionFinalResult, expect: &str) -> anyhow::Result<()> {
    let why = event_data(r, "job_failed").map(|d| d["reason"].as_str().unwrap_or("").to_string()).unwrap_or_default();
    println!("[{n}] {what}: refused on-chain as expected — {why}");
    log(json!({ "kind": "refusal", "step": n, "what": what, "expected": expect, "job_failed_reason": why }));
    anyhow::ensure!(why.contains(expect), "{what}: expected job_failed containing {expect:?}, got {why:?} ({:?})", events(r));
    Ok(())
}
async fn view(w: &Worker<Sandbox>, c: &AccountId, m: &str, args: Value) -> anyhow::Result<Value> {
    Ok(w.view(c, m).args_json(args).await?.json::<Value>()?)
}
async fn sub(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result()?)
}

struct Env {
    w: Worker<Sandbox>,
    root: Account,
    dcl: Contract,
    wrap: Contract,
    usdc: Contract,
    raw: Contract,
    tax: Contract,
}
impl Env {
    fn p_usdc(&self) -> String {
        format!("{}|{}|2000", self.usdc.id(), self.wrap.id())
    }
    fn p_raw(&self) -> String {
        format!("{}|{}|10000", self.raw.id(), self.wrap.id())
    }
    fn p_tax(&self) -> String {
        format!("{}|{}|10000", self.tax.id(), self.wrap.id())
    }
}

async fn treasury(e: &Env, name: &str, meme: &Contract, x_decimals: u8) -> anyhow::Result<Contract> {
    let acc = sub(&e.root, name, 30).await?;
    let t = acc.deploy(&std::fs::read("../target/near/treasury-dcl/sol2near_treasury_dcl.wasm")?).await?.into_result()?;
    let pool_id = format!("{}|{}|10000", meme.id(), e.wrap.id());
    let r = t
        .call("new")
        .args_json(json!({
            "network": "sandbox",
            "pool": { "dex": e.dcl.id(), "pool_id": pool_id, "token_x": meme.id(), "token_y": e.wrap.id(), "x_decimals": x_decimals, "y_decimals": 24,
                "fee": 10000, "point_delta": 200, "usdc_token": e.usdc.id(), "usdc_decimals": 6,
                "route_x": [e.p_usdc(), pool_id.clone()], "route_y": [e.p_usdc()] },
            "min_deposit": USDC1.to_string(),
            "lock_duration_ns": LOCK_NS.to_string(),
            "guards": { "max_slippage_bps": SLIP_BPS, "max_price_impact_bps": 1000, "max_plan_ttl_ns": (10 * MIN_NS).to_string(),
                "min_range_width": 4000, "max_range_width": 200000 },
        }))
        .transact()
        .await?;
    must("init", &format!("{name}.new"), r)?;
    Ok(t)
}

fn swap_infos(e: &Env, to_x: u128, to_y: u128, min_x: u128, min_y: u128) -> Value {
    json!([
        { "pool_ids": [e.p_usdc(), e.p_raw()], "input_token": e.usdc.id(), "output_token": e.raw.id(), "amount_in": to_x.to_string(), "min_output_amount": min_x.to_string() },
        { "pool_ids": [e.p_usdc()], "input_token": e.usdc.id(), "output_token": e.wrap.id(), "amount_in": to_y.to_string(), "min_output_amount": min_y.to_string() },
    ])
}
async fn predict(e: &Env, to_x: u128, to_y: u128, l: i32, r: i32, cap_x: u128, cap_y: u128) -> anyhow::Result<(u128, u128, u128, u128)> {
    let v = view(&e.w, e.dcl.id(), "predict_hotzap", json!({
        "token_in": e.usdc.id(), "amount_in": (to_x + to_y).to_string(), "swap_infos": swap_infos(e, to_x, to_y, 0, 0),
        "add_liquidity_infos": [{ "pool_id": e.p_raw(), "left_point": l, "right_point": r, "amount_x": cap_x.to_string(), "amount_y": cap_y.to_string(), "min_amount_x": "0", "min_amount_y": "0" }],
    })).await?;
    // v[0][0] = what add_liquidity would take; v[1] = what would be LEFT in the DCL account (swap outputs - need)
    let (nx, ny) = (u(&v[0][0]["need_x"]), u(&v[0][0]["need_y"]));
    Ok((u(&v[1][e.raw.id().as_str()]) + nx, u(&v[1][e.wrap.id().as_str()]) + ny, nx, ny))
}

/// The plan the dashboard would prepare (packages/near-client/src/dclPlan.ts mirrors it):
/// range ±half_width points around the live price (on the 200 grid), USDC split between the two legs so the
/// position uses both swap outputs, from DCL's own predict_hotzap (sequential swaps, real pool math).
/// min_out = predicted output − half the slippage budget (the on-chain guard quotes each leg on its own).
async fn plan_for(e: &Env, spend: u128, half_width: i32, deadline: u64) -> anyhow::Result<Value> {
    let cur = view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].as_i64().unwrap() as i32;
    let l = (cur - half_width).div_euclid(200) * 200;
    let r = (cur + half_width).div_euclid(200) * 200 + 200;
    // bisection on the USDC share of the X leg: the X leg buys through the target pool and moves its price,
    // so the share is searched until both sides of the position use the same fraction of their swap output
    let (mut lo, mut hi) = (0.02f64, 0.98f64);
    let (mut ox, mut oy, mut nx, mut ny) = (0, 0, 0, 0);
    let mut f_used = 0.5;
    for _ in 0..16 {
        let f = (lo + hi) / 2.0;
        f_used = f;
        let to_x = (spend as f64 * f) as u128;
        let qx = u(&view(&e.w, e.dcl.id(), "quote", json!({ "pool_ids": [e.p_usdc(), e.p_raw()], "input_token": e.usdc.id(), "output_token": e.raw.id(), "input_amount": to_x.to_string() })).await?["amount"]);
        let qy = u(&view(&e.w, e.dcl.id(), "quote", json!({ "pool_ids": [e.p_usdc()], "input_token": e.usdc.id(), "output_token": e.wrap.id(), "input_amount": (spend - to_x).to_string() })).await?["amount"]);
        let (a, bb, _, _) = predict(e, to_x, spend - to_x, l, r, qx / 2, qy / 2).await?;
        // same 5 bps cap margin as packages/near-client/src/dcl.ts (a live chain can move between the two views)
        let (_, _, cx, cy) = predict(e, to_x, spend - to_x, l, r, a * 9_995 / 10_000, bb * 9_995 / 10_000).await?;
        (ox, oy, nx, ny) = (a, bb, cx, cy);
        let (ux, uy) = (cx as f64 / a as f64, cy as f64 / bb as f64);
        if (ux - uy).abs() < 0.0002 {
            break;
        }
        if ux > uy { lo = f } else { hi = f }
    }
    let to_x = (spend as f64 * f_used) as u128;
    let to_y = spend - to_x;
    let min_x = ox * (10_000 - SLIP_BPS / 2) / 10_000;
    let min_y = oy * (10_000 - SLIP_BPS / 2) / 10_000;
    let floor = 10_000 - 2 * SLIP_BPS;
    println!("      plan: point {cur} range [{l}, {r}] usdc {to_x}/{to_y} → predicted out {ox} / {oy}, need {nx} / {ny}");
    Ok(json!({
        "usdc_to_x": to_x.to_string(), "usdc_to_y": to_y.to_string(), "min_x_out": min_x.to_string(), "min_y_out": min_y.to_string(),
        "left_point": l, "right_point": r, "amount_x": min_x.to_string(), "amount_y": min_y.to_string(),
        "min_amount_x": (min_x * floor / 10_000 + 1).to_string(), "min_amount_y": (min_y * floor / 10_000 + 1).to_string(),
        "deadline_ns": deadline.to_string(),
    }))
}

async fn now(e: &Env) -> anyhow::Result<u64> {
    Ok(e.w.view_block().await?.timestamp())
}
async fn trade_round_trip(e: &Env, trader: &Account, near: u128) -> anyhow::Result<()> {
    let s1 = json!({ "Swap": { "pool_ids": [e.p_raw()], "output_token": e.raw.id(), "min_output_amount": "0" } });
    trader.call(e.wrap.id(), "ft_transfer_call").args_json(json!({ "receiver_id": e.dcl.id(), "amount": (near * E24).to_string(), "msg": s1.to_string() })).deposit(y(1)).gas(tgas(200)).transact().await?.into_result()?;
    let bal = view(&e.w, e.raw.id(), "ft_balance_of", json!({ "account_id": trader.id() })).await?;
    let s2 = json!({ "Swap": { "pool_ids": [e.p_raw()], "output_token": e.wrap.id(), "min_output_amount": "0", "skip_unwrap_near": true } });
    trader.call(e.raw.id(), "ft_transfer_call").args_json(json!({ "receiver_id": e.dcl.id(), "amount": bal, "msg": s2.to_string() })).deposit(y(1)).gas(tgas(200)).transact().await?.into_result()?;
    Ok(())
}

/// Books must equal real balances: Treasury's USDC / X / Y wallet balances and its DCL account.
async fn reconcile_books(e: &Env, t: &AccountId, tag: &str) -> anyhow::Result<Value> {
    let a = view(&e.w, t, "get_accounting", json!({})).await?;
    let usdc = u(&view(&e.w, e.usdc.id(), "ft_balance_of", json!({ "account_id": t })).await?);
    let x = u(&view(&e.w, e.raw.id(), "ft_balance_of", json!({ "account_id": t })).await?);
    let yb = u(&view(&e.w, e.wrap.id(), "ft_balance_of", json!({ "account_id": t })).await?);
    let dex = view(&e.w, e.dcl.id(), "list_user_assets", json!({ "account_id": t })).await?;
    let dg = |k: &AccountId| u(&dex.get(k.as_str()).cloned().unwrap_or(json!("0")));
    let expect_usdc = u(&a["owed_usdc"]) + u(&a["community_total"]) + u(&a["pending_budget_total"]) + u(&a["zap_outstanding"]);
    println!("[{tag}] books vs real: USDC wallet {usdc} = owed+community+pending {expect_usdc}; X wallet {x} = owed_x {}; wNEAR wallet {yb} = owed_y {}; DCL acct X {} = {}, Y {} = {}, USDC {} = {}",
        u(&a["owed_x"]), u(&a["owed_y"]), dg(e.raw.id()), u(&a["dex_booked_x"]), dg(e.wrap.id()), u(&a["dex_booked_y"]), dg(e.usdc.id()), u(&a["dex_booked_usdc"]));
    anyhow::ensure!(usdc == expect_usdc && x == u(&a["owed_x"]) && yb == u(&a["owed_y"]), "wallet books differ");
    anyhow::ensure!(dg(e.raw.id()) == u(&a["dex_booked_x"]) && dg(e.wrap.id()) == u(&a["dex_booked_y"]) && dg(e.usdc.id()) == u(&a["dex_booked_usdc"]), "DCL books differ");
    log(json!({ "kind": "call", "step": tag, "what": "books = real balances (views only, no transaction)", "outcome": "success", "events": [] }));
    rec(tag, t, "get_accounting + ft_balance_of ×3 + DCL list_user_assets", json!({}), json!({ "books": a }),
        json!({ "treasury_wallet": { "usdc": usdc.to_string(), "x": x.to_string(), "wnear": yb.to_string() }, "treasury_dcl_account": dex,
            "checks": ["USDC wallet = owed_usdc + community_total + pending_budget_total + zap_outstanding", "X wallet = owed_x", "wNEAR wallet = owed_y", "DCL account X/Y/USDC = dex_booked_x/y/usdc"] }));
    Ok(a)
}

#[tokio::test]
async fn v42_treasury_dcl_end_to_end_in_local_sandbox() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    println!("LOCAL SANDBOX (neard), root {} — nothing here is testnet or mainnet", root.id());

    // ---------- real code: DCL v2.4.2, wrap.near, Tidepool USDC, Nearly raw v1 + tax v6 tokens ----------
    let dcl = sub(&root, "dcl", 100).await?.deploy(&std::fs::read("res/dcl_mainnet.wasm")?).await?.into_result()?;
    let wrap = sub(&root, "wrap", 50).await?.deploy(&std::fs::read("res/wrap_near.wasm")?).await?.into_result()?;
    let usdc = sub(&root, "usdc", 20).await?.deploy(&std::fs::read("res/tidepool_usdc.wasm")?).await?.into_result()?;
    let factory = sub(&root, "factory", 20).await?;
    let lp = sub(&root, "lp", 2500).await?;
    let alice = sub(&root, "alice", 100).await?;
    let bob = sub(&root, "bob", 30).await?;
    let trader = sub(&root, "trader", 2500).await?;
    let raw = sub(&root, "rawmeme", 20).await?.deploy(&std::fs::read("res/nearly_token_raw_v1.wasm")?).await?.into_result()?;
    let tax = sub(&root, "taxmeme", 20).await?.deploy(&std::fs::read("res/nearly_token_tax_v6.wasm")?).await?.into_result()?;
    must("A1", "DCL new (wasm of dclv2.ref-labs.near v2.4.2)", dcl.call("new").args_json(json!({ "owner_id": root.id(), "wnear_id": wrap.id(), "farming_contract_id": root.id() })).transact().await?)?;
    must("A2", "wNEAR new (wasm of wrap.near)", wrap.call("new").args_json(json!({})).transact().await?)?;
    must("A3", "USDC new (wasm of usdc.tidepool-sandbox.testnet)", usdc.call("new").args_json(json!({ "owner_id": root.id(), "name": "Tidepool USDC (LOCAL COPY)", "symbol": "USDC", "decimals": 6 })).transact().await?)?;
    must("A4", "RAWMEME new (Nearly raw v1 code, LOCAL TEST TOKEN)", factory.call(raw.id(), "new").args_json(json!({ "owner_id": lp.id(), "total_supply": (1_000_000_000 * E18).to_string(),
        "metadata": { "spec": "ft-1.0.0", "name": "RAWMEME (LOCAL TEST, NO VALUE)", "symbol": "RAWMEME", "decimals": 18 } })).transact().await?)?;
    must("A5", "TAXMEME new (Nearly tax v6 code, buy 3 % / sell 4 %, LOCAL TEST TOKEN)", factory.call(tax.id(), "new").args_json(json!({ "owner_id": lp.id(), "total_supply": (1_000_000_000 * E18).to_string(),
        "metadata": { "spec": "ft-1.0.0", "name": "TAXMEME (LOCAL TEST, NO VALUE)", "symbol": "TAXMEME", "decimals": 18 },
        "tax": { "buy_bps": 300, "sell_bps": 400, "pairs": [dcl.id()], "admin": factory.id(), "exempt": [] } })).transact().await?)?;
    log(json!({ "kind": "call", "step": "A0", "what": "deploy the real code in a fresh local sandbox (genesis state, no fork)", "outcome": "success", "events": [] }));
    let deployed: serde_json::Map<String, Value> = [
        (dcl.id(), "res/dcl_mainnet.wasm (dclv2.ref-labs.near, Rhea DCL v2.4.2)"),
        (wrap.id(), "res/wrap_near.wasm (wrap.near)"),
        (usdc.id(), "res/tidepool_usdc.wasm (usdc.tidepool-sandbox.testnet)"),
        (raw.id(), "res/nearly_token_raw_v1.wasm (Nearly raw v1 global code = the code of nearly-993927.nearlytrade.near)"),
        (tax.id(), "res/nearly_token_tax_v6.wasm (Nearly tax v6 global code)"),
    ].into_iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
    rec("A0", root.id(), "deploy", Value::Object(deployed), json!({ "token_x_metadata": view(&w, raw.id(), "ft_metadata", json!({})).await?, "dcl_metadata": view(&w, dcl.id(), "get_metadata", json!({})).await? }),
        json!("SHA-256 of each file in the export's provenance section"));
    let e = Env { w, root, dcl, wrap, usdc, raw, tax };
    let mut fx = serde_json::Map::new();
    let mut points = serde_json::Map::new();

    // ---------- market: USDC/wNEAR 0.2 % and RAWMEME/wNEAR, TAXMEME/wNEAR 1 % pools seeded by lp (sandbox only) ----------
    for a in [&lp, &alice, &bob, &trader] {
        a.call(e.dcl.id(), "storage_deposit").args_json(json!({})).deposit(mn(500)).transact().await?.into_result()?;
        a.call(e.dcl.id(), "register_tokens").args_json(json!({ "token_ids": [e.wrap.id(), e.usdc.id(), e.raw.id(), e.tax.id()] })).deposit(mn(100)).transact().await?.into_result()?;
        for t in [e.wrap.id(), e.usdc.id(), e.raw.id(), e.tax.id()] {
            a.call(t, "storage_deposit").args_json(json!({ "account_id": a.id(), "registration_only": true })).deposit(mn(10)).transact().await?.into_result()?;
        }
    }
    for t in [e.wrap.id(), e.usdc.id(), e.raw.id(), e.tax.id()] {
        e.root.call(t, "storage_deposit").args_json(json!({ "account_id": e.dcl.id(), "registration_only": true })).deposit(mn(10)).transact().await?.into_result()?;
    }
    for (who, amt) in [(lp.id(), 100_000 * USDC1), (alice.id(), 2_000 * USDC1)] {
        e.root.call(e.usdc.id(), "mint").args_json(json!({ "account_id": who, "amount": amt.to_string() })).transact().await?.into_result()?;
    }
    for a in [&lp, &trader] {
        a.call(e.wrap.id(), "near_deposit").deposit(NearToken::from_near(2000)).transact().await?.into_result()?;
    }
    // 1 USDC = 0.5 NEAR (point 403 960 on the 40 grid); 1 RAWMEME = 1e-6 NEAR... as an atomic price 1.0001^0 = 1 (18 vs 24 dec)
    for (a, b, fee, pt) in [(e.usdc.id(), e.wrap.id(), 2000, 403_960), (e.raw.id(), e.wrap.id(), 10000, 0), (e.tax.id(), e.wrap.id(), 10000, 0)] {
        must("B1", &format!("create_pool {a}|{b}|{fee}"), lp.call(e.dcl.id(), "create_pool").args_json(json!({ "token_a": a, "token_b": b, "fee": fee, "init_point": pt })).deposit(mn(100)).gas(tgas(50)).transact().await?)?;
    }
    for (t, amt) in [(e.raw.id(), 100_000_000 * E18), (e.tax.id(), 100_000_000 * E18), (e.wrap.id(), 1_500 * E24), (e.usdc.id(), 50_000 * USDC1)] {
        lp.call(t, "ft_transfer_call").args_json(json!({ "receiver_id": e.dcl.id(), "amount": amt.to_string(), "msg": "\"Deposit\"" })).deposit(y(1)).gas(tgas(100)).transact().await?.into_result()?;
    }
    for (pool, l, r, ax, ay) in [(e.p_usdc(), 380_000, 428_000, 20_000 * USDC1, 300 * E24), (e.p_raw(), -40_000, 40_000, 50_000_000 * E18, 300 * E24), (e.p_tax(), -40_000, 40_000, 50_000_000 * E18, 300 * E24)] {
        must("B2", &format!("seed add_liquidity {pool}"), lp.call(e.dcl.id(), "add_liquidity").args_json(json!({ "pool_id": pool, "left_point": l, "right_point": r,
            "amount_x": ax.to_string(), "amount_y": ay.to_string(), "min_amount_x": "0", "min_amount_y": "0" })).gas(tgas(150)).transact().await?)?;
    }
    println!("pool RAWMEME/wNEAR {}", view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?);
    rec("B2", e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() }), view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?,
        json!("pool of the NEARLY-code token / wNEAR, fee 10000 (1 %), point_delta 200 = the NEARLY mainnet pool type; LOCAL price and liquidity, seeded by lp"));

    // ---------- setup: on-chain checks ----------
    let t_tax = treasury(&e, "treasury-tax", &e.tax, 18).await?;
    must("C0", "setup of a Treasury targeting the TAXED token pool", e.root.call(t_tax.id(), "setup").deposit(mn(700)).gas(tgas(300)).transact().await?)?;
    let c = view(&e.w, t_tax.id(), "get_config", json!({})).await?;
    println!("[C0] taxed-token Treasury ready = {}, setup_error = {}", c["ready"], c["setup_error"]);
    anyhow::ensure!(c["ready"] == false && c["setup_error"].as_str().unwrap_or("").contains("BLOCKED_TAX"));
    rec("C0", t_tax.id(), "setup", json!({}), json!({ "ready": c["ready"], "setup_error": c["setup_error"] }), json!("get_config after setup: a taxed token pool is refused"));
    let t_bad = treasury(&e, "treasury-bad", &e.raw, 24).await?;
    must("C1", "setup with WRONG token_x decimals (24)", e.root.call(t_bad.id(), "setup").deposit(mn(700)).gas(tgas(300)).transact().await?)?;
    let c = view(&e.w, t_bad.id(), "get_config", json!({})).await?;
    println!("[C1] wrong-decimals Treasury ready = {}, setup_error = {}", c["ready"], c["setup_error"]);
    anyhow::ensure!(c["ready"] == false);
    let t = treasury(&e, "treasury-dcl", &e.raw, 18).await?;
    must("C2", "setup (DCL storage + register_tokens, target + 3 route pools, decimals, get_tax)", e.root.call(t.id(), "setup").deposit(mn(700)).gas(tgas(300)).transact().await?)?;
    let cfg = view(&e.w, t.id(), "get_config", json!({})).await?;
    anyhow::ensure!(cfg["ready"] == true && cfg["fuel"] == "FUEL_NOT_ELIGIBLE", "config {cfg}");
    fx.insert("config".into(), cfg.clone());
    rec("C2", t.id(), "setup", json!({}), cfg.clone(), json!({
        "dcl_get_user_storage_detail": view(&e.w, e.dcl.id(), "get_user_storage_detail", json!({ "user_id": t.id() })).await?,
        "dcl_get_user_registered_tokens": view(&e.w, e.dcl.id(), "get_user_registered_tokens", json!({ "account_id": t.id() })).await? }));
    println!("[C2] Treasury DCL storage {} registered {}", view(&e.w, e.dcl.id(), "get_user_storage_detail", json!({ "user_id": t.id() })).await?,
        view(&e.w, e.dcl.id(), "get_user_registered_tokens", json!({ "account_id": t.id() })).await?);

    // ---------- intake ----------
    let r = lp.call(e.raw.id(), "ft_transfer_call").args_json(json!({ "receiver_id": t.id(), "amount": E18.to_string(), "msg": DEPOSIT_MSG })).deposit(y(1)).gas(tgas(100)).transact().await?;
    let used: String = r.clone().json()?;
    println!("[D0] RAWMEME sent to the Treasury → used {used} (refunded) · events {:?}", events(&r));
    anyhow::ensure!(used == "0");
    log(json!({ "kind": "call", "step": "D0", "what": "a non-USDC token sent to the Treasury", "outcome": "success", "events": events(&r) }));
    rec("D0", e.raw.id(), "ft_transfer_call", json!({ "receiver_id": t.id(), "amount": E18.to_string(), "msg": DEPOSIT_MSG }), json!({ "used": used }), json!("used = 0: the whole amount is refunded"));
    must("D1", "alice deposits 20 USDC", alice.call(e.usdc.id(), "ft_transfer_call").args_json(json!({ "receiver_id": t.id(), "amount": (20 * USDC1).to_string(), "msg": DEPOSIT_MSG })).deposit(y(1)).gas(tgas(100)).transact().await?)?;
    let d = view(&e.w, t.id(), "get_deposit", json!({ "deposit_id": "0" })).await?;
    anyhow::ensure!(u(&d["lp_budget"]) == 18 * USDC1 && u(&d["reserve"]) == 1_600_000 && u(&d["community"]) == 400_000);
    rec("D1", e.usdc.id(), "ft_transfer_call", json!({ "receiver_id": t.id(), "amount": (20 * USDC1).to_string(), "msg": DEPOSIT_MSG }), d.clone(),
        json!("get_deposit(0): lp_budget 18 000 000 (90 %) + reserve 1 600 000 (8 %) + community 400 000 (2 %) = 20 000 000"));
    points.insert("deposit_allocated".into(), view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].clone());
    fx.insert("deposit_allocated".into(), view(&e.w, t.id(), "get_position", json!({ "deposit_id": "0" })).await?);

    // ---------- guards ----------
    let dl = now(&e).await? + 5 * MIN_NS;
    let good = plan_for(&e, 17 * USDC1, 20_000, dl).await?;
    must_fail("E1", "bob executes alice's deposit", bob.call(t.id(), "execute_dcl_lp").args_json(json!({ "deposit_id": "0", "plan": good })).gas(tgas(300)).transact().await?, "ERR_NOT_CREATOR")?;
    rec("E1", t.id(), "execute_dcl_lp", json!({ "deposit_id": "0", "plan": good }), json!(null), json!("signer bob.test.near is not the creator"));
    let mut off_grid = good.clone();
    off_grid["left_point"] = json!(good["left_point"].as_i64().unwrap() + 100);
    must_fail("E2", "range not on the 200-point grid", alice.call(t.id(), "execute_dcl_lp").args_json(json!({ "deposit_id": "0", "plan": off_grid })).gas(tgas(300)).transact().await?, "ERR_RANGE_NOT_ON_POINT_DELTA")?;
    rec("E2", t.id(), "execute_dcl_lp", json!({ "deposit_id": "0", "plan": off_grid }), json!(null), json!("see the call outcome / refusal reason"));
    let mut above = good.clone();
    let cur = view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].as_i64().unwrap();
    above["left_point"] = json!((cur / 200 + 10) * 200);
    above["right_point"] = json!((cur / 200 + 40) * 200);
    let r = must("E3", "plan whose range is entirely above the price", alice.call(t.id(), "execute_dcl_lp").args_json(json!({ "deposit_id": "0", "plan": above })).gas(tgas(300)).transact().await?)?;
    must_refuse("E3", "range out of the current price", &r, "out of range")?;
    rec("E3", t.id(), "execute_dcl_lp", json!({ "deposit_id": "0", "plan": above }), json!(null), json!("see the call outcome / refusal reason"));
    // both legs' minimums at 50 % of DCL's simulated outputs (a coherent plan, but no slippage protection)
    let mut loose = good.clone();
    for (o, a, m) in [("min_x_out", "amount_x", "min_amount_x"), ("min_y_out", "amount_y", "min_amount_y")] {
        loose[o] = json!((u(&good[o]) / 2).to_string());
        loose[a] = loose[o].clone();
        loose[m] = json!((u(&loose[a]) * 98 / 100 + 1).to_string());
    }
    let r = must("E4", "plan with both min outs at 50 % of the simulated outputs", alice.call(t.id(), "execute_dcl_lp").args_json(json!({ "deposit_id": "0", "plan": loose })).gas(tgas(300)).transact().await?)?;
    must_refuse("E4", "slippage guard", &r, "looser")?;
    rec("E4", t.id(), "execute_dcl_lp", json!({ "deposit_id": "0", "plan": loose }), json!(null), json!("see the call outcome / refusal reason"));
    // only the X side halved: the position ratio no longer fits, DCL's own simulation refuses it
    let mut lopsided = good.clone();
    lopsided["min_x_out"] = json!((u(&good["min_x_out"]) / 2).to_string());
    lopsided["amount_x"] = lopsided["min_x_out"].clone();
    lopsided["min_amount_x"] = json!((u(&lopsided["amount_x"]) * 98 / 100 + 1).to_string());
    let r = must("E4b", "plan whose amounts do not fit the range ratio", alice.call(t.id(), "execute_dcl_lp").args_json(json!({ "deposit_id": "0", "plan": lopsided })).gas(tgas(300)).transact().await?)?;
    must_refuse("E4b", "DCL simulation refusal", &r, "predict_hotzap refused")?;
    rec("E4b", t.id(), "execute_dcl_lp", json!({ "deposit_id": "0", "plan": lopsided }), json!(null), json!("see the call outcome / refusal reason"));
    let d = view(&e.w, t.id(), "get_deposit", json!({ "deposit_id": "0" })).await?;
    anyhow::ensure!(d["status"] == "BudgetAllocated" && d["lpt_id"].is_null(), "nothing sent: {d}");
    rec("E4b", t.id(), "get_deposit", json!({ "deposit_id": "0" }), json!({ "status": d["status"], "lpt_id": d["lpt_id"] }), json!("after E1–E4b: still BudgetAllocated, no position, nothing sent"));
    reconcile_books(&e, t.id(), "E5").await?;

    // ---------- the position ----------
    let dl = now(&e).await? + 5 * MIN_NS;
    let good = plan_for(&e, 17 * USDC1, 20_000, dl).await?;
    let r = must("F1", "execute_dcl_lp: guards → HotZap (USDC→wNEAR→RAWMEME, USDC→wNEAR, add_liquidity) → lookup → confirm",
        alice.call(t.id(), "execute_dcl_lp").args_json(json!({ "deposit_id": "0", "plan": good })).gas(tgas(300)).transact().await?)?;
    let conf = event_data(&r, "position_confirmed").ok_or_else(|| anyhow::anyhow!("no position_confirmed: {:?} {:?} {}", events(&r), event_data(&r, "job_failed"), failure(&r)))?;
    println!("[F1] position_confirmed {conf}");
    let lpt = conf["lpt_id"].as_str().unwrap().to_string();
    let onchain = view(&e.w, e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt })).await?;
    let nft = view(&e.w, e.dcl.id(), "nft_token", json!({ "token_id": lpt })).await?;
    println!("[F1] DCL get_liquidity {onchain}\n[F1] DCL nft_token owner {}", nft["owner_id"]);
    anyhow::ensure!(onchain["owner_id"] == t.id().as_str() && nft["owner_id"] == t.id().as_str(), "Treasury must own the position");
    anyhow::ensure!(onchain["amount"] == conf["liquidity"] && u(&conf["liquidity"]) > 0);
    anyhow::ensure!(onchain["left_point"] == good["left_point"] && onchain["right_point"] == good["right_point"]);
    let d = view(&e.w, t.id(), "get_deposit", json!({ "deposit_id": "0" })).await?;
    anyhow::ensure!(u(&d["usdc_used"]) + u(&d["usdc_unused_to_reserve"]) == 18 * USDC1, "USDC side reconciles");
    rec("F1", t.id(), "execute_dcl_lp", json!({ "deposit_id": "0", "plan": good }), conf.clone(), json!({
        "dcl_get_liquidity": onchain, "dcl_nft_token_owner": nft["owner_id"], "treasury_get_deposit": d,
        "checks": ["get_liquidity.owner_id = nft_token.owner_id = the Treasury", "get_liquidity.amount = recorded liquidity > 0", "range = plan range", "usdc_used + usdc_unused_to_reserve = 18 USDC budget"] }));
    println!("[F1] USDC used {} + back to reserve {} = 18 USDC budget; position x {} y {}; leftovers in DCL x {} y {} usdc {}",
        d["usdc_used"], d["usdc_unused_to_reserve"], d["position_x"], d["position_y"], d["dex_x"], d["dex_y"], d["dex_usdc"]);
    points.insert("position_confirmed".into(), view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].clone());
    fx.insert("position_confirmed".into(), view(&e.w, t.id(), "get_position", json!({ "deposit_id": "0" })).await?);
    fx.insert("position_confirmed_dcl".into(), onchain.clone());
    reconcile_books(&e, t.id(), "F2").await?;

    // ---------- impact guard: a large deposit against shallow test pools ----------
    must("F3", "alice deposits 400 USDC", alice.call(e.usdc.id(), "ft_transfer_call").args_json(json!({ "receiver_id": t.id(), "amount": (400 * USDC1).to_string(), "msg": DEPOSIT_MSG })).deposit(y(1)).gas(tgas(100)).transact().await?)?;
    let dl = now(&e).await? + 5 * MIN_NS;
    // 300 USDC against a ~860 USDC test pool: the plan is computed exactly as for a small one
    let big = plan_for(&e, 300 * USDC1, 20_000, dl).await?;
    let r = must("F4", "execute_dcl_lp of a 300 USDC plan", alice.call(t.id(), "execute_dcl_lp").args_json(json!({ "deposit_id": "1", "plan": big })).gas(tgas(300)).transact().await?)?;
    must_refuse("F4", "price-impact guard", &r, "impact")?;
    rec("F4", t.id(), "execute_dcl_lp", json!({ "deposit_id": "1", "plan": big }), json!(null), json!("300 USDC against shallow LOCAL pools: refused by the on-chain price-impact guard (max 1000 bps), nothing sent"));
    must("F5", "abort deposit 1 (budget back to the USDC reserve)", alice.call(t.id(), "abort").args_json(json!({ "deposit_id": "1" })).transact().await?)?;
    let bal = view(&e.w, t.id(), "get_balance", json!({ "account_id": alice.id(), "token_id": e.usdc.id() })).await?;
    let before = u(&view(&e.w, e.usdc.id(), "ft_balance_of", json!({ "account_id": alice.id() })).await?);
    must("F6", "withdraw_token USDC (reserves + unused + aborted budget)", alice.call(t.id(), "withdraw_token").args_json(json!({ "token_id": e.usdc.id(), "amount": bal })).deposit(y(1)).gas(tgas(100)).transact().await?)?;
    let after = u(&view(&e.w, e.usdc.id(), "ft_balance_of", json!({ "account_id": alice.id() })).await?);
    println!("[F6] alice USDC +{} = Treasury balance {}", after - before, u(&bal));
    anyhow::ensure!(after - before == u(&bal));
    rec("F6", t.id(), "withdraw_token", json!({ "token_id": e.usdc.id(), "amount": bal }), json!({ "alice_wallet_delta": (after - before).to_string() }), json!("wallet delta = Treasury get_balance (8 % reserves + unused budget + aborted deposit 1)"));
    reconcile_books(&e, t.id(), "F7").await?;

    // ---------- fees ----------
    for _ in 0..3 {
        trade_round_trip(&e, &trader, 5).await?;
    }
    let pre = view(&e.w, e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt })).await?;
    println!("[G1] after trades: unclaimed fees x {} y {}", pre["unclaimed_fee_x"], pre["unclaimed_fee_y"]);
    anyhow::ensure!(u(&pre["unclaimed_fee_x"]) > 0 && u(&pre["unclaimed_fee_y"]) > 0);
    log(json!({ "kind": "call", "step": "G1", "what": "3 trader round trips through the pool (sandbox trader)", "outcome": "success", "events": [] }));
    rec("G1", e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt }), json!({ "unclaimed_fee_x": pre["unclaimed_fee_x"], "unclaimed_fee_y": pre["unclaimed_fee_y"] }), json!("TEST fees from LOCAL trades: not a forecast"));
    points.insert("fees_unclaimed".into(), view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].clone());
    fx.insert("fees_unclaimed".into(), view(&e.w, t.id(), "get_position", json!({ "deposit_id": "0" })).await?);
    fx.insert("fees_unclaimed_dcl".into(), pre.clone());
    must_fail("G2", "bob claims alice's fees", bob.call(t.id(), "claim_fees").args_json(json!({ "deposit_id": "0" })).gas(tgas(100)).transact().await?, "ERR_NOT_CREATOR")?;
    rec("G2", t.id(), "claim_fees", json!({ "deposit_id": "0", "signer": bob.id() }), json!(null), json!("refused: not the creator"));
    let r = must("G3", "claim_fees (DCL remove_liquidity amount 0)", alice.call(t.id(), "claim_fees").args_json(json!({ "deposit_id": "0" })).gas(tgas(100)).transact().await?)?;
    let fc = event_data(&r, "fees_claimed").unwrap();
    println!("[G3] fees_claimed {fc}");
    anyhow::ensure!(fc["fee_x"] == pre["unclaimed_fee_x"] && fc["fee_y"] == pre["unclaimed_fee_y"], "booked = DCL's unclaimed fees");
    rec("G3", t.id(), "claim_fees", json!({ "deposit_id": "0" }), fc.clone(), json!("fees booked = DCL unclaimed_fee_x / unclaimed_fee_y read in G1"));
    let r = must("G4", "second claim_fees", alice.call(t.id(), "claim_fees").args_json(json!({ "deposit_id": "0" })).gas(tgas(100)).transact().await?)?;
    let fc2 = event_data(&r, "fees_claimed").unwrap();
    anyhow::ensure!(u(&fc2["fee_x"]) == 0 && u(&fc2["fee_y"]) == 0, "no double count");
    rec("G4", t.id(), "claim_fees", json!({ "deposit_id": "0" }), fc2.clone(), json!("a repeated claim books 0 / 0: no double count"));
    let d = view(&e.w, t.id(), "get_deposit", json!({ "deposit_id": "0" })).await?;
    anyhow::ensure!(d["fees_claimed_x"] == pre["unclaimed_fee_x"]);
    reconcile_books(&e, t.id(), "G5").await?;
    points.insert("fees_claimed".into(), view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].clone());
    fx.insert("fees_claimed".into(), view(&e.w, t.id(), "get_position", json!({ "deposit_id": "0" })).await?);

    // ---------- out of range: a narrow second position, then the price leaves it ----------
    must("K1", "alice deposits 20 USDC (deposit 2)", alice.call(e.usdc.id(), "ft_transfer_call").args_json(json!({ "receiver_id": t.id(), "amount": (20 * USDC1).to_string(), "msg": DEPOSIT_MSG })).deposit(y(1)).gas(tgas(100)).transact().await?)?;
    let dl = now(&e).await? + 5 * MIN_NS;
    let narrow = plan_for(&e, 17 * USDC1, 2_000, dl).await?;
    let r = must("K2", "execute_dcl_lp with a narrow range (±2 000 points)", alice.call(t.id(), "execute_dcl_lp").args_json(json!({ "deposit_id": "2", "plan": narrow })).gas(tgas(300)).transact().await?)?;
    let lpt2 = event_data(&r, "position_confirmed").ok_or_else(|| anyhow::anyhow!("K2 {:?} {}", events(&r), failure(&r)))?["lpt_id"].as_str().unwrap().to_string();
    rec("K2", t.id(), "execute_dcl_lp", json!({ "deposit_id": "2", "plan": narrow }), json!({ "lpt_id": lpt2 }), json!("narrow position ±2 000 points"));
    // a large buy of RAWMEME pushes the point below the range (price of X in Y falls when X is bought? DCL: buying X raises the point)
    let s = json!({ "Swap": { "pool_ids": [e.p_raw()], "output_token": e.raw.id(), "min_output_amount": "0" } });
    trader.call(e.wrap.id(), "ft_transfer_call").args_json(json!({ "receiver_id": e.dcl.id(), "amount": (120 * E24).to_string(), "msg": s.to_string() })).deposit(y(1)).gas(tgas(200)).transact().await?.into_result()?;
    let p = view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?;
    let l2 = view(&e.w, e.dcl.id(), "get_liquidity_view", json!({ "lpt_id": lpt2 })).await?;
    println!("[K3] point now {} vs range [{}, {}] → position holds x {} y {}", p["current_point"], narrow["left_point"], narrow["right_point"], l2["token_x"], l2["token_y"]);
    let outside = p["current_point"].as_i64().unwrap() >= narrow["right_point"].as_i64().unwrap() || p["current_point"].as_i64().unwrap() < narrow["left_point"].as_i64().unwrap();
    anyhow::ensure!(outside, "price must have left the narrow range");
    log(json!({ "kind": "call", "step": "K3", "what": "a large LOCAL buy moves the price out of the narrow range", "outcome": "success", "events": [] }));
    rec("K3", e.dcl.id(), "get_pool + get_liquidity_view", json!({ "lpt_id": lpt2 }), json!({ "current_point": p["current_point"], "range": [narrow["left_point"], narrow["right_point"]], "position": l2 }), json!("out of range: the position holds a single asset"));
    must("K4", "claim_fees right after leaving the range", alice.call(t.id(), "claim_fees").args_json(json!({ "deposit_id": "2" })).gas(tgas(100)).transact().await?)?;
    // trades that stay outside the narrow range: further small buys of RAWMEME only (the point keeps rising)
    for _ in 0..3 {
        trader.call(e.wrap.id(), "ft_transfer_call").args_json(json!({ "receiver_id": e.dcl.id(), "amount": (2 * E24).to_string(), "msg": s.to_string() })).deposit(y(1)).gas(tgas(200)).transact().await?.into_result()?;
    }
    let p2 = view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].as_i64().unwrap();
    let oor = view(&e.w, e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt2 })).await?;
    let wide = view(&e.w, e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt })).await?;
    println!("[K5] trades while out of range (point {p2}): narrow position unclaimed {} / {} · wide position unclaimed {} / {}",
        oor["unclaimed_fee_x"], oor["unclaimed_fee_y"], wide["unclaimed_fee_x"], wide["unclaimed_fee_y"]);
    anyhow::ensure!(u(&oor["unclaimed_fee_x"]) == 0 && u(&oor["unclaimed_fee_y"]) == 0, "out of range earns nothing");
    anyhow::ensure!(u(&wide["unclaimed_fee_x"]) + u(&wide["unclaimed_fee_y"]) > 0, "the wide position kept the fees of the K3 swap that crossed its range");
    log(json!({ "kind": "call", "step": "K5", "what": "3 more LOCAL trades while the narrow position is out of range", "outcome": "success", "events": [] }));
    rec("K5", e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt2 }), json!({ "narrow_unclaimed": [oor["unclaimed_fee_x"], oor["unclaimed_fee_y"]], "wide_unclaimed": [wide["unclaimed_fee_x"], wide["unclaimed_fee_y"]] }), json!("out of range earns 0 / 0"));
    points.insert("out_of_range".into(), view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].clone());
    fx.insert("out_of_range".into(), view(&e.w, t.id(), "get_position", json!({ "deposit_id": "2" })).await?);
    fx.insert("out_of_range_dcl".into(), json!({ "pool": view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?, "liquidity_view": view(&e.w, e.dcl.id(), "get_liquidity_view", json!({ "lpt_id": lpt2 })).await? }));
    reconcile_books(&e, t.id(), "K6").await?;

    // ---------- exit ----------
    must_fail("H1", "withdraw_position during the lock", alice.call(t.id(), "withdraw_position").args_json(json!({ "deposit_id": "0" })).deposit(y(1)).gas(tgas(100)).transact().await?, "ERR_POSITION_LOCKED")?;
    rec("H1", t.id(), "withdraw_position", json!({ "deposit_id": "0" }), json!(null), json!("refused during the lock (unlock_at not reached)"));
    must_fail("H2", "bob withdraws alice's position", bob.call(t.id(), "withdraw_position").args_json(json!({ "deposit_id": "0" })).deposit(y(1)).gas(tgas(100)).transact().await?, "ERR_NOT_CREATOR")?;
    rec("H2", t.id(), "withdraw_position", json!({ "deposit_id": "0", "signer": bob.id() }), json!(null), json!("refused: not the creator"));
    let unlock = u(&view(&e.w, t.id(), "get_deposit", json!({ "deposit_id": "0" })).await?["unlock_at"]) as u64;
    while now(&e).await? < unlock {
        e.w.fast_forward(50).await?;
    }
    println!("[H3] sandbox time is past unlock_at {unlock}");
    must("H3", "withdraw_position: nft_transfer to alice, owner checked", alice.call(t.id(), "withdraw_position").args_json(json!({ "deposit_id": "0" })).deposit(y(1)).gas(tgas(100)).transact().await?)?;
    let owner = view(&e.w, e.dcl.id(), "nft_token", json!({ "token_id": lpt })).await?["owner_id"].clone();
    println!("[H3] DCL nft_token owner = {owner}");
    anyhow::ensure!(owner == alice.id().as_str());
    rec("H3", t.id(), "withdraw_position", json!({ "deposit_id": "0" }), json!({ "dcl_nft_token_owner": owner }), json!("after the lock: the DCL NFT owner is the creator"));
    points.insert("position_withdrawn".into(), view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?["current_point"].clone());
    fx.insert("position_withdrawn".into(), view(&e.w, t.id(), "get_position", json!({ "deposit_id": "0" })).await?);
    must_fail("H4", "second withdraw_position", alice.call(t.id(), "withdraw_position").args_json(json!({ "deposit_id": "0" })).deposit(y(1)).gas(tgas(100)).transact().await?, "ERR_NO_CONFIRMED_POSITION")?;
    rec("H4", t.id(), "withdraw_position", json!({ "deposit_id": "0" }), json!(null), json!("no double exit"));
    must_fail("H5", "claim_fees after the position left the Treasury", alice.call(t.id(), "claim_fees").args_json(json!({ "deposit_id": "0" })).gas(tgas(100)).transact().await?, "ERR_NO_CONFIRMED_POSITION")?;
    rec("H5", t.id(), "claim_fees", json!({ "deposit_id": "0" }), json!(null), json!("no claim once the NFT left the Treasury"));
    // the creator now acts on the DCL directly: partial then full removal
    let amount = u(&view(&e.w, e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt })).await?["amount"]);
    must("H6", "alice remove_liquidity 50 % on the DCL", alice.call(e.dcl.id(), "remove_liquidity").args_json(json!({ "lpt_id": lpt, "amount": (amount / 2).to_string(), "min_amount_x": "0", "min_amount_y": "0" })).gas(tgas(150)).transact().await?)?;
    let rest = u(&view(&e.w, e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt })).await?["amount"]);
    must("H7", "alice remove_liquidity the rest", alice.call(e.dcl.id(), "remove_liquidity").args_json(json!({ "lpt_id": lpt, "amount": rest.to_string(), "min_amount_x": "0", "min_amount_y": "0" })).gas(tgas(150)).transact().await?)?;
    let gone = view(&e.w, e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt })).await?;
    println!("[H7] position after full removal: {gone}; alice wallet RAWMEME {} wNEAR(+NEAR unwrapped)", view(&e.w, e.raw.id(), "ft_balance_of", json!({ "account_id": alice.id() })).await?);
    anyhow::ensure!(gone.is_null());
    rec("H7", e.dcl.id(), "get_liquidity", json!({ "lpt_id": lpt }), gone.clone(), json!("the creator removed 50 % then the rest on the DCL herself: position deleted (null)"));

    // ---------- leftovers and claimed fees back to the creator ----------
    for tok in [e.raw.id(), e.wrap.id()] {
        let d = view(&e.w, t.id(), "get_deposit", json!({ "deposit_id": "0" })).await?;
        let k = if tok == e.raw.id() { "dex_x" } else { "dex_y" };
        if u(&d[k]) == 0 {
            continue;
        }
        must("J1", &format!("withdraw_dex_balance {tok} (leftovers + fees)"), alice.call(t.id(), "withdraw_dex_balance").args_json(json!({ "deposit_id": "0", "token_id": tok })).deposit(y(1)).gas(tgas(150)).transact().await?)?;
        let b = view(&e.w, t.id(), "get_balance", json!({ "account_id": alice.id(), "token_id": tok })).await?;
        let w0 = u(&view(&e.w, tok, "ft_balance_of", json!({ "account_id": alice.id() })).await?);
        must("J2", &format!("withdraw_token {tok}"), alice.call(t.id(), "withdraw_token").args_json(json!({ "token_id": tok, "amount": b })).deposit(y(1)).gas(tgas(100)).transact().await?)?;
        let w1 = u(&view(&e.w, tok, "ft_balance_of", json!({ "account_id": alice.id() })).await?);
        println!("[J2] alice {tok} wallet +{} = booked {}", w1 - w0, u(&b));
        anyhow::ensure!(w1 - w0 == u(&b));
        rec("J2", t.id(), "withdraw_token", json!({ "token_id": tok, "amount": b }), json!({ "creator_wallet_delta": (w1 - w0).to_string() }), json!("leftovers + claimed fees reached the creator's wallet = booked to the atomic unit"));
    }
    must_fail("J3", "withdraw_dex_balance again", alice.call(t.id(), "withdraw_dex_balance").args_json(json!({ "deposit_id": "0", "token_id": e.raw.id() })).deposit(y(1)).gas(tgas(150)).transact().await?, "ERR_NOTHING_TO_WITHDRAW")?;
    rec("J3", t.id(), "withdraw_dex_balance", json!({ "deposit_id": "0", "token_id": e.raw.id() }), json!(null), json!("no double recovery"));
    let a = reconcile_books(&e, t.id(), "R").await?;
    fx.insert("accounting".into(), a);
    let d0 = view(&e.w, t.id(), "get_deposit", json!({ "deposit_id": "0" })).await?;
    println!("[R] deposit 0: claimed fees x {} y {}, recovered x {} y {}, status {}", d0["fees_claimed_x"], d0["fees_claimed_y"], d0["recovered_x"], d0["recovered_y"], d0["status"]);
    rec("R", t.id(), "get_deposit", json!({ "deposit_id": "0" }), d0.clone(), json!("final state of deposit 0"));
    fx.insert("points".into(), Value::Object(points));
    fx.insert("pool_raw".into(), view(&e.w, e.dcl.id(), "get_pool", json!({ "pool_id": e.p_raw() })).await?);
    std::fs::write("../packages/near-client/src/fixtures/v42_dcl_sandbox_views.json", serde_json::to_string_pretty(&Value::Object(fx))? + "\n")?;
    println!("fixture written: packages/near-client/src/fixtures/v42_dcl_sandbox_views.json");

    // ---------- V4.3A: an artificially inflated balance proves nothing ----------
    // A plain ft_transfer (no ft_on_transfer, no deposit) raises Treasury's USDC balance. The books must not move,
    // nobody is credited, and no refund can be inferred from it (reconcile of a zap reads the DCL, not this balance).
    let before = view(&e.w, t.id(), "get_accounting", json!({})).await?;
    let wallet0 = u(&view(&e.w, e.usdc.id(), "ft_balance_of", json!({ "account_id": t.id() })).await?);
    must("S1", "lp gifts 5 USDC to TreasuryDCL by plain ft_transfer", lp.call(e.usdc.id(), "ft_transfer").args_json(json!({ "receiver_id": t.id(), "amount": (5 * USDC1).to_string() })).deposit(y(1)).transact().await?)?;
    let after = view(&e.w, t.id(), "get_accounting", json!({})).await?;
    let wallet1 = u(&view(&e.w, e.usdc.id(), "ft_balance_of", json!({ "account_id": t.id() })).await?);
    println!("[S1] Treasury USDC wallet {wallet0} -> {wallet1}; accounting unchanged = {}", before == after);
    anyhow::ensure!(before == after, "books moved on a gift: {before} vs {after}");
    anyhow::ensure!(wallet1 == wallet0 + 5 * USDC1);
    let trader_bal = view(&e.w, t.id(), "get_balance", json!({ "account_id": lp.id(), "token_id": e.usdc.id() })).await?;
    anyhow::ensure!(u(&trader_bal) == 0, "the gifter is credited nothing");
    rec("S1", t.id(), "get_accounting", json!({}), json!({ "unchanged": before == after, "wallet_before": wallet0.to_string(), "wallet_after": wallet1.to_string(), "gifter_credited": trader_bal }), json!("a plain transfer moves no book and credits nobody"));
    println!("[S1] unattributed USDC = wallet - (owed + community + pending + outstanding) = {} (nobody can withdraw it)", wallet1 - (u(&after["owed_usdc"]) + u(&after["community_total"]) + u(&after["pending_budget_total"]) + u(&after["zap_outstanding"])));
    std::fs::create_dir_all("out")?;
    std::fs::write("out/nearly_dcl_proof.raw.json", serde_json::to_string_pretty(&Value::Array(PROOF_LOG.lock().unwrap().clone()))? + "
")?;
    println!("proof log written: sandbox-tests/out/nearly_dcl_proof.raw.json ({} entries)", PROOF_LOG.lock().unwrap().len());
    Ok(())
}
