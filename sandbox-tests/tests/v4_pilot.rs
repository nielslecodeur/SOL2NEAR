#![allow(unused_must_use)]
//! V4.1 Classic pilot — LOCAL SANDBOX run (near-workspaces, neard sandbox). NOT a public-network proof.
//!
//! Real code everywhere except the chain itself:
//! - Ref exchange: the wasm of ref-finance-101.testnet (fetched with view_code, see scripts/probes/fetch-sandbox-wasm.mjs);
//! - quote token: the wasm of usdc.tidepool-sandbox.testnet (same code, local copy with 6 decimals);
//! - base token: contracts/sandbox-meme (S2NMEME, test token, no value);
//! - TreasuryV4: contracts/treasury-v4 built with cargo-near.
//! The pool and its liquidity exist only inside this local sandbox and are destroyed with it.
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const USDC1: u128 = 1_000_000;
const MEME1: u128 = 1_000_000_000_000_000_000;
const MIN_NS: u64 = 60 * 1_000_000_000;
const LOCK_NS: u64 = 30 * 1_000_000_000;
const DEPOSIT_MSG: &str = r#"{"action":"deposit"}"#;

fn tgas(t: u64) -> Gas {
    Gas::from_tgas(t)
}
fn yocto(y: u128) -> NearToken {
    NearToken::from_yoctonear(y)
}
fn milli(m: u128) -> NearToken {
    NearToken::from_millinear(m)
}
fn u(v: &Value) -> u128 {
    v.as_str().map(|s| s.parse().unwrap()).unwrap_or_else(|| v.as_u64().unwrap() as u128)
}

fn events(r: &ExecutionFinalResult) -> Vec<String> {
    r.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .map(|e| format!("{}:{}", e["standard"].as_str().unwrap_or("?"), e["event"].as_str().unwrap_or("?")))
        .collect()
}
fn failure(r: &ExecutionFinalResult) -> String {
    r.receipt_failures().iter().map(|o| format!("{:?}", (*o).clone().into_result().err())).collect::<Vec<_>>().join(" | ")
}
fn step(n: &str, what: &str, r: &ExecutionFinalResult) {
    println!("[{n}] {what}: {} · events {:?}", if r.is_success() { "OK" } else { "FAILED" }, events(r));
}

fn must(n: &str, what: &str, r: ExecutionFinalResult) -> anyhow::Result<ExecutionFinalResult> {
    step(n, what, &r);
    anyhow::ensure!(r.is_success(), "{what} failed: {}", failure(&r));
    Ok(r)
}
fn must_fail(n: &str, what: &str, r: ExecutionFinalResult, expect: &str) -> anyhow::Result<()> {
    let f = failure(&r);
    println!("[{n}] {what}: refused as expected ({})", f.find(expect).map(|_| expect).unwrap_or("?"));
    anyhow::ensure!(!r.is_success() && f.contains(expect), "{what}: expected failure {expect}, got success={} {f}", r.is_success());
    Ok(())
}

async fn view(c: &AccountId, w: &Worker<Sandbox>, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(w.view(c, method).args_json(args).await?.json::<Value>()?)
}

/// Real contract views captured during the run, written to packages/near-client/src/fixtures/ for the TS/UI tests.
async fn snap(e: &Env, t: &AccountId, pool_id: u64, alice: &AccountId, out: &mut serde_json::Map<String, Value>, key: &str, id: &str) -> anyhow::Result<()> {
    let now = e.w.view_block().await?.timestamp();
    let position = view(t, &e.w, "get_position", json!({ "deposit_id": id })).await?;
    let in_flight = view(t, &e.w, "get_in_flight", json!({})).await?;
    let ref_treasury_shares = view(e.reff.id(), &e.w, "get_pool_shares", json!({ "pool_id": pool_id, "account_id": t })).await?;
    let mft_registered = view(e.reff.id(), &e.w, "mft_has_registered", json!({ "token_id": format!(":{pool_id}"), "account_id": alice })).await?;
    let shares = position["deposit"]["lp_shares"].as_str().unwrap_or("0").to_string();
    let predict_remove = if shares != "0" && position["deposit"]["status"] == "LpConfirmed" {
        view(e.reff.id(), &e.w, "predict_remove_liquidity", json!({ "pool_id": pool_id, "shares": shares })).await?
    } else {
        Value::Null
    };
    let creator_reserve = view(t, &e.w, "get_reserve", json!({ "creator": alice })).await?;
    let creator_base_balance = view(t, &e.w, "get_base_balance", json!({ "creator": alice })).await?;
    out.insert(key.into(), json!({ "now_ns": now.to_string(), "position": position, "in_flight": in_flight, "ref_treasury_shares": ref_treasury_shares, "creator_mft_registered": mft_registered, "predict_remove_liquidity": predict_remove, "creator_reserve": creator_reserve, "creator_base_balance": creator_base_balance }));
    Ok(())
}

async fn sub(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result()?)
}

/// Same zap math as packages/near-client/src/lpPlan.ts (optimalZapIn), u128 is enough for a 6-decimal reserve.
fn optimal_zap_in(amount: u128, reserve_in: u128, fee_bps: u128) -> u128 {
    let g = 10_000 - fee_bps;
    let a = 10_000 + g;
    let n = reserve_in * (reserve_in * a * a + 4 * g * 10_000 * amount);
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    (x - reserve_in * a) / (2 * g)
}

struct Env {
    w: Worker<Sandbox>,
    root: Account,
    reff: Contract,
    usdc: Contract,
    meme: Contract,
}

async fn storage(ft: &Contract, payer: &Account, who: &AccountId) -> anyhow::Result<()> {
    let r = payer.call(ft.id(), "storage_deposit").args_json(json!({ "account_id": who, "registration_only": true })).deposit(milli(10)).transact().await?;
    anyhow::ensure!(r.is_success(), "storage_deposit {who} on {}: {}", ft.id(), failure(&r));
    Ok(())
}

async fn treasury_v4(e: &Env, name: &str, pool_id: u64, base_decimals: u8) -> anyhow::Result<Contract> {
    let acc = sub(&e.root, name, 30).await?;
    let t = acc.deploy(&std::fs::read("../target/near/treasury-v4/sol2near_treasury_v4.wasm")?).await?.into_result()?;
    let r = t
        .call("new")
        .args_json(json!({
            "network": "sandbox",
            "pool": { "dex": e.reff.id(), "pool_id": pool_id, "usdc_token": e.usdc.id(), "base_token": e.meme.id(), "usdc_decimals": 6, "base_decimals": base_decimals },
            "min_deposit": (USDC1).to_string(),
            "lp_lock_duration_ns": LOCK_NS.to_string(),
            "guards": { "max_slippage_bps": 100, "max_price_impact_bps": 1000, "max_plan_ttl_ns": (10 * MIN_NS).to_string() },
        }))
        .transact()
        .await?;
    must("init", &format!("{name}.new"), r)?;
    Ok(t)
}

#[tokio::test]
async fn v4_classic_pilot_end_to_end_in_local_sandbox() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    println!("LOCAL SANDBOX (neard), root {} — nothing here is testnet", root.id());

    // ---------- contracts: real Ref + real Tidepool USDC code, sandbox token ----------
    let reff = sub(&root, "ref", 50).await?.deploy(&std::fs::read("res/ref_exchange.wasm")?).await?.into_result()?;
    must("A1", "Ref new (wasm of ref-finance-101.testnet)", reff.call("new").args_json(json!({
        "owner_id": root.id(), "boost_farm_id": root.id(), "burrowland_id": root.id(), "exchange_fee": 0, "referral_fee": 0 })).transact().await?)?;
    let usdc = sub(&root, "usdc", 20).await?.deploy(&std::fs::read("res/tidepool_usdc.wasm")?).await?.into_result()?;
    must("A2", "USDC new (wasm of usdc.tidepool-sandbox.testnet, local copy)", usdc.call("new").args_json(json!({
        "owner_id": root.id(), "name": "Tidepool USDC (LOCAL SANDBOX COPY)", "symbol": "USDC", "decimals": 6 })).transact().await?)?;
    let lp = sub(&root, "lp", 50).await?;
    let alice = sub(&root, "alice", 50).await?;
    let bob = sub(&root, "bob", 20).await?;
    let meme = sub(&root, "s2nmeme", 20).await?.deploy(&std::fs::read("../target/near/sandbox-meme/sol2near_sandbox_meme.wasm")?).await?.into_result()?;
    must("A3", "S2NMEME new (sandbox token, supply minted once to lp)", meme.call("new").args_json(json!({
        "owner_id": lp.id(), "total_supply": (1_000_000_000 * MEME1).to_string() })).transact().await?)?;
    let e = Env { w, root, reff, usdc, meme };
    let mut fx = serde_json::Map::new();
    let m = view(e.usdc.id(), &e.w, "ft_metadata", json!({})).await?;
    anyhow::ensure!(m["decimals"] == 6, "USDC decimals {m}");

    // ---------- the Classic pool, seeded by `lp` (sandbox only) ----------
    for a in [&lp, &alice] {
        storage(&e.usdc, a, a.id()).await?;
        must("A4", &format!("Ref storage {}", a.id()), a.call(e.reff.id(), "storage_deposit").args_json(json!({})).deposit(milli(100)).transact().await?)?;
    }
    storage(&e.usdc, &lp, e.reff.id()).await?;
    storage(&e.meme, &lp, e.reff.id()).await?;
    storage(&e.meme, &alice, alice.id()).await?;
    for (who, amount) in [(lp.id(), 2_000 * USDC1), (alice.id(), 1_000 * USDC1)] {
        let r = e.root.call(e.usdc.id(), "mint").args_json(json!({ "account_id": who, "amount": amount.to_string() })).transact().await?;
        must("A5", &format!("USDC mint {} to {who}", amount / USDC1), r)?;
    }
    must("B1", "Ref register_tokens", lp.call(e.reff.id(), "register_tokens").args_json(json!({ "token_ids": [e.usdc.id(), e.meme.id()] })).deposit(yocto(1)).transact().await?)?;
    let r = must("B2", "Ref add_simple_pool USDC/S2NMEME 30 bps", lp.call(e.reff.id(), "add_simple_pool").args_json(json!({ "tokens": [e.usdc.id(), e.meme.id()], "fee": 30 })).deposit(milli(100)).transact().await?)?;
    let pool_id: u64 = r.clone().json()?;
    for (tok, amount) in [(&e.usdc, 1_000 * USDC1), (&e.meme, 1_000_000 * MEME1)] {
        must("B3", &format!("seed deposit into Ref ({})", tok.id()), lp.call(tok.id(), "ft_transfer_call").args_json(json!({
            "receiver_id": e.reff.id(), "amount": amount.to_string(), "msg": "" })).deposit(yocto(1)).gas(tgas(100)).transact().await?)?;
    }
    must("B4", "seed add_liquidity 1 000 USDC + 1 000 000 S2NMEME", lp.call(e.reff.id(), "add_liquidity").args_json(json!({
        "pool_id": pool_id, "amounts": [(1_000 * USDC1).to_string(), (1_000_000 * MEME1).to_string()] })).deposit(milli(10)).transact().await?)?;
    println!("pool {pool_id}: {}", view(e.reff.id(), &e.w, "get_pool", json!({ "pool_id": pool_id })).await?);

    // ---------- TreasuryV4: on-chain setup checks ----------
    let bad = treasury_v4(&e, "treasury-bad", pool_id, 24).await?;
    must("C0", "setup with WRONG base decimals (24)", e.root.call(bad.id(), "setup").deposit(milli(105)).gas(tgas(300)).transact().await?)?;
    let ready_bad = view(bad.id(), &e.w, "get_config", json!({})).await?["ready"].clone();
    println!("[C0] wrong-decimals Treasury ready = {ready_bad} (expected false)");
    anyhow::ensure!(ready_bad == false);
    let t = treasury_v4(&e, "treasury-v4", pool_id, 18).await?;
    let r = e.root.call(t.id(), "setup").deposit(milli(105)).gas(tgas(300)).transact().await?;
    must("C1", "setup (storage, register_tokens, get_pool + ft_metadata checks)", r)?;
    let cfg = view(t.id(), &e.w, "get_config", json!({})).await?;
    anyhow::ensure!(cfg["ready"] == true && cfg["fuel"] == "FUEL_NOT_ELIGIBLE", "config {cfg}");
    fx.insert("config".into(), cfg.clone());
    fx.insert("ref_metadata".into(), view(e.reff.id(), &e.w, "metadata", json!({})).await?);

    // ---------- intake ----------
    must_fail("D0", "deposit of the wrong token (S2NMEME) is refunded", {
        let r = lp.call(e.meme.id(), "ft_transfer_call").args_json(json!({ "receiver_id": t.id(), "amount": MEME1.to_string(), "msg": DEPOSIT_MSG })).deposit(yocto(1)).gas(tgas(100)).transact().await?;
        // ft_transfer_call succeeds, but returns 0 used: check the refund instead of a failure
        let used: String = r.clone().json()?;
        println!("[D0] used = {used}, events {:?}", events(&r));
        anyhow::ensure!(used == "0" && events(&r).iter().any(|e| e.ends_with("deposit_refused")));
        bob.call(t.id(), "execute_lp").args_json(json!({ "deposit_id": "0" })).gas(tgas(300)).transact().await?
    }, "ERR_UNKNOWN_DEPOSIT")?;
    let r = must("D1", "alice deposits 20 USDC", alice.call(e.usdc.id(), "ft_transfer_call").args_json(json!({
        "receiver_id": t.id(), "amount": (20 * USDC1).to_string(), "msg": DEPOSIT_MSG })).deposit(yocto(1)).gas(tgas(100)).transact().await?)?;
    anyhow::ensure!(r.clone().json::<String>()? == (20 * USDC1).to_string(), "ft_transfer_call must report the whole amount as used");
    let d = view(t.id(), &e.w, "get_deposit", json!({ "deposit_id": "0" })).await?;
    anyhow::ensure!((u(&d["lp_budget"]), u(&d["reserve"]), u(&d["community"])) == (18 * USDC1, 1_600_000, 400_000), "split {d}");
    println!("[D1] split 90/8/2: {} / {} / {}", d["lp_budget"], d["reserve"], d["community"]);
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "budget_allocated", "0").await?;
    fx.insert("pool_before_lp".into(), view(e.reff.id(), &e.w, "get_pool", json!({ "pool_id": pool_id })).await?);

    // ---------- plan from live Ref views ----------
    let now = e.w.view_block().await?.timestamp();
    let plan = |swap_in: u128, quote: u128, min_out_bps: u128| {
        let usdc_left = 18 * USDC1 - swap_in;
        json!({
            "swap_amount_in": swap_in.to_string(), "min_swap_out": (quote * min_out_bps / 10_000).to_string(),
            "min_amounts": [(usdc_left * 9_900 / 10_000).to_string(), (quote * 9_900 / 10_000).to_string()],
            "deadline_ns": (now + 5 * MIN_NS).to_string(),
        })
    };
    let pool = view(e.reff.id(), &e.w, "get_pool", json!({ "pool_id": pool_id })).await?;
    let swap_in = optimal_zap_in(18 * USDC1, u(&pool["amounts"][0]), pool["total_fee"].as_u64().unwrap() as u128);
    let quote = u(&view(e.reff.id(), &e.w, "get_return", json!({ "pool_id": pool_id, "token_in": e.usdc.id(), "amount_in": swap_in.to_string(), "token_out": e.meme.id() })).await?);
    println!("[E0] plan: swap {swap_in} USDC-atomic -> Ref get_return {quote} S2NMEME-atomic");

    must_fail("E1", "bob executes alice's deposit", bob.call(t.id(), "execute_lp").args_json(json!({ "deposit_id": "0", "plan": plan(swap_in, quote, 9_950) })).gas(tgas(300)).transact().await?, "ERR_NOT_CREATOR")?;
    // A plan whose slippage guard is far below Ref's own quote: the CONTRACT refuses the swap.
    let r = must("E2", "alice executes with a loose guard (min_swap_out = 50 % of quote)", alice.call(t.id(), "execute_lp").args_json(json!({ "deposit_id": "0", "plan": plan(swap_in, quote, 5_000) })).gas(tgas(300)).transact().await?)?;
    let d = view(t.id(), &e.w, "get_deposit", json!({ "deposit_id": "0" })).await?;
    println!("[E2] status {} · last_error {}", d["status"], d["last_error"]);
    anyhow::ensure!(d["status"]["InRef"].is_object() && d["last_error"].as_str().unwrap().starts_with("guard_slippage"), "{d}");
    anyhow::ensure!(!events(&r).iter().any(|e| e.ends_with("swap_confirmed")));
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "parked_guard_slippage", "0").await?;

    // ---------- resume with a correct plan: swap -> add_liquidity -> verify ----------
    let r = must("E3", "alice resumes with a correct plan", alice.call(t.id(), "execute_lp").args_json(json!({ "deposit_id": "0", "plan": plan(swap_in, quote, 9_950) })).gas(tgas(300)).transact().await?)?;
    anyhow::ensure!(events(&r).iter().any(|e| e.ends_with("lp_confirmed")), "{:?}", events(&r));
    let pos = view(t.id(), &e.w, "get_position", json!({ "deposit_id": "0" })).await?;
    let d = &pos["deposit"];
    let shares = u(&d["lp_shares"]);
    let ref_shares = u(&view(e.reff.id(), &e.w, "get_pool_shares", json!({ "pool_id": pool_id, "account_id": t.id() })).await?);
    println!(
        "[E3] LpConfirmed: shares {shares} (Ref says Treasury holds {ref_shares}) · usdc_swapped {} usdc_in_lp {} dust_usdc {} · base_in_lp {} dust_base {} · verified {} · locked {} · fuel {}",
        d["usdc_swapped"], d["usdc_in_lp"], d["dust_usdc"], d["base_in_lp"], d["dust_base"], d["lp_verified"], pos["locked"], pos["fuel_status"]
    );
    anyhow::ensure!(d["status"] == "LpConfirmed" && d["lp_verified"] == true && ref_shares == shares && shares > 0);
    anyhow::ensure!(u(&d["usdc_swapped"]) + u(&d["usdc_in_lp"]) + u(&d["dust_usdc"]) == 18 * USDC1, "USDC reconciliation");
    anyhow::ensure!(pos["locked"] == true && pos["fuel_status"] == "FUEL_NOT_ELIGIBLE");
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "lp_confirmed_locked", "0").await?;

    // ---------- price-impact guard on a budget too large for the pool, then abort + recovery ----------
    must("F1", "alice deposits 900 USDC (LP budget 810 in a ~1 000 USDC pool)", alice.call(e.usdc.id(), "ft_transfer_call").args_json(json!({
        "receiver_id": t.id(), "amount": (900 * USDC1).to_string(), "msg": DEPOSIT_MSG })).deposit(yocto(1)).gas(tgas(100)).transact().await?)?;
    let pool = view(e.reff.id(), &e.w, "get_pool", json!({ "pool_id": pool_id })).await?;
    let big_in = optimal_zap_in(810 * USDC1, u(&pool["amounts"][0]), 30);
    let big_q = u(&view(e.reff.id(), &e.w, "get_return", json!({ "pool_id": pool_id, "token_in": e.usdc.id(), "amount_in": big_in.to_string(), "token_out": e.meme.id() })).await?);
    let big_plan = json!({ "swap_amount_in": big_in.to_string(), "min_swap_out": (big_q * 9_950 / 10_000).to_string(),
        "min_amounts": [((810 * USDC1 - big_in) * 99 / 100).to_string(), (big_q * 99 / 100).to_string()], "deadline_ns": (now + 5 * MIN_NS).to_string() });
    must("F2", "execute_lp on deposit #1", alice.call(t.id(), "execute_lp").args_json(json!({ "deposit_id": "1", "plan": big_plan })).gas(tgas(300)).transact().await?)?;
    let d1 = view(t.id(), &e.w, "get_deposit", json!({ "deposit_id": "1" })).await?;
    println!("[F2] status {} · last_error {}", d1["status"], d1["last_error"]);
    anyhow::ensure!(d1["last_error"].as_str().unwrap().starts_with("guard_price_impact"), "{d1}");
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "parked_price_impact", "1").await?;
    must("F3", "alice aborts deposit #1 (budget stays hers)", alice.call(t.id(), "abort_lp").args_json(json!({ "deposit_id": "1" })).transact().await?)?;
    let usdc_before = u(&view(e.usdc.id(), &e.w, "ft_balance_of", json!({ "account_id": alice.id() })).await?);
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "aborted_with_leftovers", "1").await?;
    must("F4", "withdraw_leftover USDC of #1 (real Ref withdraw, checked with get_deposits)", alice.call(t.id(), "withdraw_leftover").args_json(json!({ "deposit_id": "1", "token_id": e.usdc.id() })).deposit(yocto(1)).gas(tgas(150)).transact().await?)?;
    let d1 = view(t.id(), &e.w, "get_deposit", json!({ "deposit_id": "1" })).await?;
    anyhow::ensure!(u(&d1["dust_usdc"]) == 0 && u(&d1["usdc_recovered"]) == 810 * USDC1, "{d1}");
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "aborted_recovered", "1").await?;
    let reserve = u(&view(t.id(), &e.w, "get_reserve", json!({ "creator": alice.id() })).await?);
    must("F5", "withdraw_reserve (8 % reserves + recovered 810 USDC)", alice.call(t.id(), "withdraw_reserve").args_json(json!({ "amount": reserve.to_string() })).deposit(yocto(1)).gas(tgas(100)).transact().await?)?;
    let usdc_after = u(&view(e.usdc.id(), &e.w, "ft_balance_of", json!({ "account_id": alice.id() })).await?);
    println!("[F5] alice USDC {usdc_before} -> {usdc_after} (+{}) = reserve {reserve}", usdc_after - usdc_before);
    anyhow::ensure!(usdc_after - usdc_before == reserve && reserve == 810 * USDC1 + 1_600_000 + 72 * USDC1);

    // ---------- exit: lock, ownership, double withdraw ----------
    must_fail("G1", "withdraw_lp during the lock", alice.call(t.id(), "withdraw_lp").args_json(json!({ "deposit_id": "0" })).deposit(yocto(1)).gas(tgas(100)).transact().await?, "ERR_LP_LOCKED")?;
    must_fail("G2", "bob withdraws alice's LP", bob.call(t.id(), "withdraw_lp").args_json(json!({ "deposit_id": "0" })).deposit(yocto(1)).gas(tgas(100)).transact().await?, "ERR_NOT_CREATOR")?;
    let unlock = u(&view(t.id(), &e.w, "get_deposit", json!({ "deposit_id": "0" })).await?["unlock_at"]) as u64;
    while e.w.view_block().await?.timestamp() < unlock {
        e.w.fast_forward(50).await?;
    }
    println!("[G3] sandbox time is past unlock_at {unlock}");
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "lp_unlocked_not_registered", "0").await?;
    must("G3", "alice mft_register for the pool shares", alice.call(e.reff.id(), "mft_register").args_json(json!({ "token_id": format!(":{pool_id}"), "account_id": alice.id() })).deposit(milli(10)).transact().await?)?;
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "lp_unlocked_registered", "0").await?;
    must("G4", "withdraw_lp after the lock", alice.call(t.id(), "withdraw_lp").args_json(json!({ "deposit_id": "0" })).deposit(yocto(1)).gas(tgas(100)).transact().await?)?;
    let alice_shares = u(&view(e.reff.id(), &e.w, "get_pool_shares", json!({ "pool_id": pool_id, "account_id": alice.id() })).await?);
    let t_shares = u(&view(e.reff.id(), &e.w, "get_pool_shares", json!({ "pool_id": pool_id, "account_id": t.id() })).await?);
    println!("[G4] Ref: alice holds {alice_shares} shares, Treasury {t_shares}");
    anyhow::ensure!(alice_shares == shares && t_shares == 0);
    snap(&e, t.id(), pool_id, alice.id(), &mut fx, "lp_withdrawn", "0").await?;
    must_fail("G5", "second withdraw_lp", alice.call(t.id(), "withdraw_lp").args_json(json!({ "deposit_id": "0" })).deposit(yocto(1)).gas(tgas(100)).transact().await?, "ERR_NO_CONFIRMED_LP")?;

    // ---------- the creator leaves the pool with Ref itself ----------
    let _ = must("H1", "alice remove_liquidity on Ref", alice.call(e.reff.id(), "remove_liquidity").args_json(json!({ "pool_id": pool_id, "shares": shares.to_string(), "min_amounts": ["1", "1"] })).deposit(yocto(1)).transact().await?)?;
    let deps = view(e.reff.id(), &e.w, "get_deposits", json!({ "account_id": alice.id() })).await?;
    println!("[H1] alice's Ref deposits after remove_liquidity: {deps}");

    // ---------- leftovers of deposit #0 ----------
    for tok in [e.usdc.id(), e.meme.id()] {
        let dd = view(t.id(), &e.w, "get_deposit", json!({ "deposit_id": "0" })).await?;
        let dust = if tok == e.usdc.id() { u(&dd["dust_usdc"]) } else { u(&dd["dust_base"]) };
        if dust > 0 {
            let _ = must("H2", &format!("withdraw_leftover {tok} ({dust})"), alice.call(t.id(), "withdraw_leftover").args_json(json!({ "deposit_id": "0", "token_id": tok })).deposit(yocto(1)).gas(tgas(150)).transact().await?)?;
        } else {
            println!("[H2] no {tok} leftover on deposit #0");
        }
    }

    // ---------- reconciliation against REAL balances ----------
    let a = view(t.id(), &e.w, "get_accounting", json!({})).await?;
    let t_usdc = u(&view(e.usdc.id(), &e.w, "ft_balance_of", json!({ "account_id": t.id() })).await?);
    let t_meme = u(&view(e.meme.id(), &e.w, "ft_balance_of", json!({ "account_id": t.id() })).await?);
    let ref_deps = view(e.reff.id(), &e.w, "get_deposits", json!({ "account_id": t.id() })).await?;
    let ref_usdc = ref_deps.get(e.usdc.id().as_str()).map(u).unwrap_or(0);
    let ref_meme = ref_deps.get(e.meme.id().as_str()).map(u).unwrap_or(0);
    println!("[R] accounting {a}");
    println!("[R] Treasury USDC on token {t_usdc} = reserve {} + community {} + pending {}", a["reserve_total"], a["community_total"], a["pending_budget_total"]);
    println!("[R] Treasury S2NMEME on token {t_meme} = base balances {}", a["base_balance_total"]);
    println!("[R] Treasury deposits on Ref: USDC {ref_usdc} (expected {}), S2NMEME {ref_meme} (expected {})", a["ref_expected_usdc"], a["ref_expected_base"]);
    anyhow::ensure!(t_usdc == u(&a["reserve_total"]) + u(&a["community_total"]) + u(&a["pending_budget_total"]), "USDC on token");
    anyhow::ensure!(t_meme == u(&a["base_balance_total"]), "base on token");
    anyhow::ensure!(ref_usdc == u(&a["ref_expected_usdc"]) && ref_meme == u(&a["ref_expected_base"]), "Ref deposits");
    anyhow::ensure!(u(&a["recorded_shares"]) == 0 && u(&a["total_received"]) == 920 * USDC1);
    fx.insert("accounting_final".into(), a.clone());
    fx.insert("_note".into(), json!("REAL TreasuryV4 / Ref views captured in a LOCAL near-workspaces sandbox (sandbox-tests/tests/v4_pilot.rs). Not testnet. Accounts are *.test.near."));
    std::fs::write("../packages/near-client/src/fixtures/v4_sandbox_views.json", serde_json::to_string_pretty(&Value::Object(fx))? + "
")?;
    println!("fixture written: packages/near-client/src/fixtures/v4_sandbox_views.json");
    println!("ALL V4.1 SANDBOX CHECKS PASSED (local sandbox, not testnet)");
    Ok(())
}
