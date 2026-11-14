#![allow(unused_must_use)]
//! V4.2A — LOCAL SANDBOX exploration of the REAL Rhea DCL wasm (dclv2.ref-labs.near v2.4.2, fetched read-only).
//! The DCL source is not public: this run measures its behaviour (argument names, return values, ownership,
//! fees, NFT transfer, taxes) instead of assuming it. Nothing here touches testnet or mainnet.
//! Tokens: wrap.near wasm, Tidepool USDC wasm (local copy), Nearly raw v1 token wasm ($NEARLY's code) and Nearly
//! tax v6 token wasm, all real code with LOCAL state. Pools and liquidity exist only in this sandbox.
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const E18: u128 = 1_000_000_000_000_000_000;
const E24: u128 = 1_000_000_000_000_000_000_000_000;
const USDC1: u128 = 1_000_000;

fn failure(r: &ExecutionFinalResult) -> String {
    r.receipt_failures().iter().map(|o| format!("{:?}", (*o).clone().into_result().err())).collect::<Vec<_>>().join(" | ")
}
fn short(s: String) -> String {
    let s = s.replace("\\\"", "\"");
    let k = s.find("ExecutionError(").map(|i| i + 15).unwrap_or(0);
    s[k..].chars().take(260).collect()
}
async fn call(n: &str, who: &Account, c: &AccountId, m: &str, args: Value, dep: NearToken, gas: u64) -> anyhow::Result<ExecutionFinalResult> {
    let r = who.call(c, m).args_json(args.clone()).deposit(dep).gas(Gas::from_tgas(gas)).transact().await?;
    let ret = r.clone().json::<Value>().map(|v| v.to_string()).unwrap_or_else(|_| "-".into());
    let logs: Vec<String> = r.logs().iter().map(|l| l.chars().take(220).collect()).collect();
    println!("[{n}] {} {c}.{m} -> {} ret={} {}", who.id(), if r.is_success() { "OK" } else { "FAILED" }, ret.chars().take(300).collect::<String>(),
        if r.is_success() { String::new() } else { short(failure(&r)) });
    for l in logs { println!("      log {l}"); }
    Ok(r)
}
async fn view(w: &Worker<Sandbox>, c: &AccountId, m: &str, args: Value) -> Value {
    match w.view(c, m).args_json(args).await { Ok(v) => v.json::<Value>().unwrap_or(Value::Null), Err(e) => json!(format!("VIEW_ERR {}", short(format!("{e:?}")))) }
}
async fn sub(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result()?)
}
fn y(v: u128) -> NearToken { NearToken::from_yoctonear(v) }
fn mn(v: u128) -> NearToken { NearToken::from_millinear(v) }

#[tokio::test]
async fn explore_real_dcl() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    let dcl: Contract = sub(&root, "dcl", 100).await?.deploy(&std::fs::read("res/dcl_mainnet.wasm")?).await?.into_result()?;
    let wrap: Contract = sub(&root, "wrap", 50).await?.deploy(&std::fs::read("res/wrap_near.wasm")?).await?.into_result()?;
    let usdc: Contract = sub(&root, "usdc", 20).await?.deploy(&std::fs::read("res/tidepool_usdc.wasm")?).await?.into_result()?;
    let lp = sub(&root, "lp", 2000).await?;
    let alice = sub(&root, "alice", 200).await?;
    let bob = sub(&root, "bob", 50).await?;
    let trader = sub(&root, "trader", 2000).await?;
    let factory = sub(&root, "factory", 20).await?;
    let raw: Contract = sub(&root, "rawmeme", 20).await?.deploy(&std::fs::read("res/nearly_token_raw_v1.wasm")?).await?.into_result()?;
    let tax: Contract = sub(&root, "taxmeme", 20).await?.deploy(&std::fs::read("res/nearly_token_tax_v6.wasm")?).await?.into_result()?;
    let d = dcl.id().clone();

    call("A1", &root, &d, "new", json!({"owner_id": root.id(), "wnear_id": wrap.id(), "farming_contract_id": root.id()}), y(0), 100).await?;
    call("A2", &root, wrap.id(), "new", json!({}), y(0), 100).await?;
    call("A3", &root, usdc.id(), "new", json!({"owner_id": root.id(), "name": "Tidepool USDC (LOCAL COPY)", "symbol": "USDC", "decimals": 6}), y(0), 100).await?;
    call("A4", &factory, raw.id(), "new", json!({"owner_id": lp.id(), "total_supply": (1_000_000_000 * E18).to_string(),
        "metadata": {"spec": "ft-1.0.0", "name": "RAWMEME (LOCAL TEST)", "symbol": "RAWMEME", "decimals": 18}}), y(0), 100).await?;
    call("A5", &factory, tax.id(), "new", json!({"owner_id": lp.id(), "total_supply": (1_000_000_000 * E18).to_string(),
        "metadata": {"spec": "ft-1.0.0", "name": "TAXMEME (LOCAL TEST)", "symbol": "TAXMEME", "decimals": 18},
        "tax": {"buy_bps": 300, "sell_bps": 400, "pairs": [d], "admin": factory.id(), "exempt": []}}), y(0), 100).await?;
    println!("metadata {}", view(&w, &d, "get_metadata", json!({})).await);
    println!("fee_tiers {}", view(&w, &d, "get_fee_tiers", json!({})).await);
    println!("storage_bounds {}", view(&w, &d, "storage_balance_bounds", json!({})).await);
    println!("raw get_tax {} / tax get_tax {}", view(&w, raw.id(), "get_tax", json!({})).await, view(&w, tax.id(), "get_tax", json!({})).await);

    // registrations
    for a in [&lp, &alice, &bob, &trader] {
        call("B1", a, &d, "storage_deposit", json!({}), mn(500), 30).await?;
        for t in [wrap.id(), usdc.id(), raw.id(), tax.id()] {
            a.call(t, "storage_deposit").args_json(json!({"account_id": a.id(), "registration_only": true})).deposit(mn(10)).transact().await?;
        }
    }
    for t in [wrap.id(), usdc.id(), raw.id(), tax.id()] {
        root.call(t, "storage_deposit").args_json(json!({"account_id": d, "registration_only": true})).deposit(mn(10)).transact().await?;
    }
    for (who, amt) in [(lp.id(), 100_000 * USDC1), (alice.id(), 1_000 * USDC1), (trader.id(), 100_000 * USDC1)] {
        root.call(usdc.id(), "mint").args_json(json!({"account_id": who, "amount": amt.to_string()})).transact().await?;
    }
    for a in [&lp, &trader] { call("B2", a, wrap.id(), "near_deposit", json!({}), NearToken::from_near(1500), 30).await?; }
    println!("user storage detail {}", view(&w, &d, "get_user_storage_detail", json!({"user_id": alice.id()})).await);
    for a in [&lp, &alice, &bob, &trader] {
        call("B3", a, &d, "register_tokens", json!({"token_ids": [wrap.id(), usdc.id(), raw.id(), tax.id()]}), mn(100), 30).await?;
    }
    println!("registered alice {}", view(&w, &d, "get_user_registered_tokens", json!({"account_id": alice.id()})).await);
    println!("alice storage after register {}", view(&w, &d, "get_user_storage_detail", json!({"user_id": alice.id()})).await);
    println!("alice storage_balance_of {}", view(&w, &d, "storage_balance_of", json!({"account_id": alice.id()})).await);
    println!("whitelisted {}", view(&w, &d, "get_whitelisted_tokens", json!({})).await);

    // pools: try arg names
    let p_raw = format!("{}|{}|10000", raw.id(), wrap.id());
    let p_usdc = format!("{}|{}|2000", usdc.id(), wrap.id());
    let p_tax = format!("{}|{}|10000", tax.id(), wrap.id());
    call("C1", &lp, &d, "create_pool", json!({}), mn(100), 50).await?;
    call("C2", &lp, &d, "create_pool", json!({"token_a": raw.id(), "token_b": wrap.id(), "fee": 10000, "init_point": 0}), mn(100), 50).await?;
    println!("pool raw {}", view(&w, &d, "get_pool", json!({"pool_id": p_raw})).await);
    // 1 USDC (1e6) = 0.5 NEAR (5e23) -> price y/x = 5e17 -> point = ln(5e17)/ln(1.0001) ≈ 404 000 (multiple of 40)
    call("C3", &lp, &d, "create_pool", json!({"token_a": usdc.id(), "token_b": wrap.id(), "fee": 2000, "init_point": 403960}), mn(100), 50).await?;
    println!("pool usdc {}", view(&w, &d, "get_pool", json!({"pool_id": p_usdc})).await);
    call("C4", &lp, &d, "create_pool", json!({"token_a": tax.id(), "token_b": wrap.id(), "fee": 10000, "init_point": 0}), mn(100), 50).await?;
    println!("pool tax {}", view(&w, &d, "get_pool", json!({"pool_id": p_tax})).await);

    // seed: deposit then add_liquidity from inner balance
    for (t, amt) in [(raw.id(), 100_000_000 * E18), (tax.id(), 100_000_000 * E18), (wrap.id(), 1_000 * E24), (usdc.id(), 50_000 * USDC1)] {
        call("D1", &lp, t, "ft_transfer_call", json!({"receiver_id": d, "amount": amt.to_string(), "msg": "\"Deposit\""}), y(1), 100).await?;
    }
    println!("lp assets {}", view(&w, &d, "list_user_assets", json!({"account_id": lp.id()})).await);
    let r = call("D2", &lp, &d, "add_liquidity", json!({"pool_id": p_raw, "left_point": -40000, "right_point": 40000,
        "amount_x": (50_000_000 * E18).to_string(), "amount_y": (300 * E24).to_string(), "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    println!("add_liquidity returns {:?}", r.json::<Value>().ok());
    call("D3", &lp, &d, "add_liquidity", json!({"pool_id": p_usdc, "left_point": 380000, "right_point": 428000,
        "amount_x": (20_000 * USDC1).to_string(), "amount_y": (300 * E24).to_string(), "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    call("D4", &lp, &d, "add_liquidity", json!({"pool_id": p_tax, "left_point": -40000, "right_point": 40000,
        "amount_x": (50_000_000 * E18).to_string(), "amount_y": (300 * E24).to_string(), "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    println!("lp assets after {}", view(&w, &d, "list_user_assets", json!({"account_id": lp.id()})).await);
    println!("lp liquidities {}", view(&w, &d, "list_liquidities", json!({"account_id": lp.id()})).await);
    println!("tax vault after seed (sell tax on deposit) get_tax {}", view(&w, tax.id(), "get_tax", json!({})).await);

    // quotes
    println!("quote usdc->wnear {}", view(&w, &d, "quote", json!({"pool_ids": [p_usdc], "input_token": usdc.id(), "output_token": wrap.id(), "input_amount": (10 * USDC1).to_string()})).await);
    println!("quote usdc->wnear->raw {}", view(&w, &d, "quote", json!({"pool_ids": [p_usdc, p_raw], "input_token": usdc.id(), "output_token": raw.id(), "input_amount": (10 * USDC1).to_string()})).await);

    // alice: HotZap with swaps only (no add) — does it leave the outputs in her inner balance?
    let hz_swaps = json!({"HotZap": {"swap_infos": [
        {"pool_ids": [p_usdc], "input_token": usdc.id(), "output_token": wrap.id(), "amount_in": (5 * USDC1).to_string(), "min_output_amount": "0"},
        {"pool_ids": [p_usdc, p_raw], "input_token": usdc.id(), "output_token": raw.id(), "amount_in": (5 * USDC1).to_string(), "min_output_amount": "0"}],
        "add_liquidity_infos": []}});
    call("E1", &alice, usdc.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (10 * USDC1).to_string(), "msg": hz_swaps.to_string()}), y(1), 200).await?;
    println!("alice assets after swaps-only HotZap {}", view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await);
    // alice: Deposit then a Swap-message ft_transfer_call (output goes to her wallet?)
    call("E2", &alice, usdc.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (20 * USDC1).to_string(), "msg": "\"Deposit\""}), y(1), 100).await?;
    let swap = json!({"Swap": {"pool_ids": [p_usdc, p_raw], "output_token": raw.id(), "min_output_amount": "0"}});
    call("E3", &alice, usdc.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (10 * USDC1).to_string(), "msg": swap.to_string()}), y(1), 200).await?;
    println!("alice raw wallet {} assets {}", view(&w, raw.id(), "ft_balance_of", json!({"account_id": alice.id()})).await, view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await);
    // alice HotZap with swaps + add (all in one receipt)
    let pool = view(&w, &d, "get_pool", json!({"pool_id": p_raw})).await;
    println!("pool raw now {pool}");
    let hz = json!({"HotZap": {"swap_infos": [
        {"pool_ids": [p_usdc], "input_token": usdc.id(), "output_token": wrap.id(), "amount_in": (5 * USDC1).to_string(), "min_output_amount": "0"},
        {"pool_ids": [p_usdc, p_raw], "input_token": usdc.id(), "output_token": raw.id(), "amount_in": (5 * USDC1).to_string(), "min_output_amount": "0"}],
        "add_liquidity_infos": [{"pool_id": p_raw, "left_point": -20000, "right_point": 20000, "amount_x": (1_000_000 * E18).to_string(), "amount_y": (2 * E24).to_string(), "min_amount_x": "0", "min_amount_y": "0"}]}});
    call("E4", &alice, usdc.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (10 * USDC1).to_string(), "msg": hz.to_string()}), y(1), 250).await?;
    println!("alice liquidities {}", view(&w, &d, "list_liquidities", json!({"account_id": alice.id()})).await);
    println!("alice assets {}", view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await);

    // HotZap with add amounts at 90 % of the quoted outputs: what happens to the rest?
    let q1 = view(&w, &d, "quote", json!({"pool_ids": [p_usdc], "input_token": usdc.id(), "output_token": wrap.id(), "input_amount": (5 * USDC1).to_string()})).await["amount"].as_str().unwrap().parse::<u128>().unwrap();
    let q2 = view(&w, &d, "quote", json!({"pool_ids": [p_usdc, p_raw], "input_token": usdc.id(), "output_token": raw.id(), "input_amount": (5 * USDC1).to_string()})).await["amount"].as_str().unwrap().parse::<u128>().unwrap();
    let hz2 = json!({"HotZap": {"swap_infos": [
        {"pool_ids": [p_usdc], "input_token": usdc.id(), "output_token": wrap.id(), "amount_in": (5 * USDC1).to_string(), "min_output_amount": (q1 * 99 / 100).to_string()},
        {"pool_ids": [p_usdc, p_raw], "input_token": usdc.id(), "output_token": raw.id(), "amount_in": (5 * USDC1).to_string(), "min_output_amount": (q2 * 99 / 100).to_string()}],
        "add_liquidity_infos": [{"pool_id": p_raw, "left_point": -20000, "right_point": 20000, "amount_x": (q2 * 9 / 10).to_string(), "amount_y": (q1 * 9 / 10).to_string(), "min_amount_x": "0", "min_amount_y": "0"}]}});
    call("E5", &alice, usdc.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (10 * USDC1).to_string(), "msg": hz2.to_string()}), y(1), 250).await?;
    println!("alice liquidities after HotZap90 {}", view(&w, &d, "list_liquidities", json!({"account_id": alice.id()})).await);
    println!("alice assets after HotZap90 {}", view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await);
    call("E6", &alice, wrap.id(), "near_deposit", json!({}), NearToken::from_near(10), 30).await?;
    call("E7", &alice, wrap.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (5 * E24).to_string(), "msg": "\"Deposit\""}), y(1), 100).await?;
    let rb = view(&w, raw.id(), "ft_balance_of", json!({"account_id": alice.id()})).await;
    call("E8", &alice, raw.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": rb, "msg": "\"Deposit\""}), y(1), 100).await?;
    // alice add_liquidity from inner balance -> lpt id return
    let assets = view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await;
    let ax = assets[raw.id().as_str()].as_str().unwrap_or("0").to_string();
    let ay = assets[wrap.id().as_str()].as_str().unwrap_or("0").to_string();
    println!("predict_add {}", view(&w, &d, "predict_add_liquidity", json!({"pool_id": p_raw, "left_point": -20000, "right_point": 20000, "amount_x": ax, "amount_y": ay})).await);
    let r = call("F1", &alice, &d, "add_liquidity", json!({"pool_id": p_raw, "left_point": -20000, "right_point": 20000, "amount_x": ax, "amount_y": ay, "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    let lpt: String = r.json().unwrap_or_default();
    println!("lpt {lpt}");
    println!("get_liquidity {}", view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await);
    println!("get_liquidity_view {}", view(&w, &d, "get_liquidity_view", json!({"lpt_id": lpt})).await);
    println!("nft_token {}", view(&w, &d, "nft_token", json!({"token_id": lpt})).await);
    println!("nft_metadata {}", view(&w, &d, "nft_metadata", json!({})).await);
    println!("nft_supply_for_owner {}", view(&w, &d, "nft_supply_for_owner", json!({"account_id": alice.id()})).await);
    println!("predict_remove {}", view(&w, &d, "predict_remove_liquidity", json!({"lpt_id": lpt, "amount": view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await["amount"]})).await);
    println!("alice assets after add {}", view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await);
    // an out-of-range position (above current price) and a bad range
    call("F2", &alice, &d, "add_liquidity", json!({"pool_id": p_raw, "left_point": 20001, "right_point": 30000, "amount_x": "1000", "amount_y": "0", "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    call("F3", &alice, &d, "add_liquidity", json!({"pool_id": p_raw, "left_point": 30000, "right_point": 20000, "amount_x": "1000", "amount_y": "0", "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    call("F4", &alice, usdc.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (10 * USDC1).to_string(), "msg": swap.to_string()}), y(1), 200).await?;
    call("F5", &alice, raw.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (1000 * E18).to_string(), "msg": "\"Deposit\""}), y(1), 100).await?;
    let r = call("F6", &alice, &d, "add_liquidity", json!({"pool_id": p_raw, "left_point": 20000, "right_point": 30000, "amount_x": (1000 * E18).to_string(), "amount_y": "0", "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    let lpt_oor: String = r.json().unwrap_or_default();
    // slippage: min_amount above what can be used
    call("F7", &alice, &d, "add_liquidity", json!({"pool_id": p_raw, "left_point": -20000, "right_point": 20000, "amount_x": "1000000", "amount_y": "1000000", "min_amount_x": "1000001", "min_amount_y": "0"}), y(0), 150).await?;
    // bob (not owner) tries to remove alice's liquidity
    call("F8", &bob, &d, "remove_liquidity", json!({"lpt_id": lpt.clone(), "amount": "1", "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;

    // trades to generate fees (round trip)
    for i in 0..3 {
        let s1 = json!({"Swap": {"pool_ids": [p_raw], "output_token": raw.id(), "min_output_amount": "0"}});
        call(&format!("G{i}a"), &trader, wrap.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (5 * E24).to_string(), "msg": s1.to_string()}), y(1), 200).await?;
        let s2 = json!({"Swap": {"pool_ids": [p_raw], "output_token": wrap.id(), "min_output_amount": "0"}});
        let bal = view(&w, raw.id(), "ft_balance_of", json!({"account_id": trader.id()})).await;
        call(&format!("G{i}b"), &trader, raw.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": bal, "msg": s2.to_string()}), y(1), 200).await?;
    }
    println!("pool raw after trades {}", view(&w, &d, "get_pool", json!({"pool_id": p_raw})).await);
    println!("alice liquidity (fees) {}", view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await);
    println!("alice OOR liquidity (fees) {}", view(&w, &d, "get_liquidity", json!({"lpt_id": lpt_oor})).await);
    // claim fees: remove 0 with skip_refund_transfer
    let before = view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await;
    call("H1", &alice, &d, "remove_liquidity", json!({"lpt_id": lpt, "amount": "0", "min_amount_x": "0", "min_amount_y": "0", "skip_refund_transfer": true}), y(0), 150).await?;
    println!("alice assets before {before} after claim {}", view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await);
    println!("alice liquidity after claim {}", view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await);
    call("H2", &alice, &d, "remove_liquidity", json!({"lpt_id": lpt, "amount": "0", "min_amount_x": "0", "min_amount_y": "0", "skip_refund_transfer": true}), y(0), 150).await?;
    println!("alice assets after 2nd claim {}", view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await);
    // remove_liquidity without skip_refund_transfer: does it transfer to wallet?
    call("H3", &alice, &d, "remove_liquidity", json!({"lpt_id": lpt_oor, "amount": "0", "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;

    // NFT transfer to bob
    call("I0", &alice, &d, "nft_transfer", json!({"receiver_id": bob.id(), "token_id": lpt}), y(0), 100).await?;
    call("I1", &alice, &d, "nft_transfer", json!({"receiver_id": bob.id(), "token_id": lpt}), y(1), 100).await?;
    println!("after nft_transfer get_liquidity {}", view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await);
    println!("nft_token {}", view(&w, &d, "nft_token", json!({"token_id": lpt})).await);
    call("I2", &alice, &d, "remove_liquidity", json!({"lpt_id": lpt, "amount": "1", "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    let liq = view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await;
    let amount = liq["amount"].clone();
    let half = (amount.as_str().unwrap_or("0").parse::<u128>().unwrap_or(0) / 2).to_string();
    call("I3", &bob, &d, "remove_liquidity", json!({"lpt_id": lpt, "amount": half, "min_amount_x": "0", "min_amount_y": "0", "skip_refund_transfer": true}), y(0), 150).await?;
    println!("bob after partial: liq {} assets {}", view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await, view(&w, &d, "list_user_assets", json!({"account_id": bob.id()})).await);
    let rest = view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await["amount"].clone();
    call("I4", &bob, &d, "remove_liquidity", json!({"lpt_id": lpt, "amount": rest, "min_amount_x": "0", "min_amount_y": "0", "skip_refund_transfer": true}), y(0), 150).await?;
    println!("bob after full: liq {} assets {}", view(&w, &d, "get_liquidity", json!({"lpt_id": lpt})).await, view(&w, &d, "list_user_assets", json!({"account_id": bob.id()})).await);
    let ba = view(&w, &d, "list_user_assets", json!({"account_id": bob.id()})).await;
    call("I5", &bob, &d, "withdraw_asset", json!({"token_id": raw.id(), "amount": ba[raw.id().as_str()].clone(), "skip_unwrap_near": true}), y(0), 150).await?;
    call("I6", &bob, &d, "withdraw_asset", json!({"token_id": wrap.id(), "skip_unwrap_near": true}), y(0), 150).await?;
    println!("bob wallet raw {} wnear {} assets {}", view(&w, raw.id(), "ft_balance_of", json!({"account_id": bob.id()})).await,
        view(&w, wrap.id(), "ft_balance_of", json!({"account_id": bob.id()})).await, view(&w, &d, "list_user_assets", json!({"account_id": bob.id()})).await);

    // TAX token: deposit (sell tax), add, withdraw (buy tax)
    call("J0", &lp, tax.id(), "ft_transfer", json!({"receiver_id": alice.id(), "amount": (10_000 * E18).to_string()}), y(1), 30).await?;
    println!("alice tax wallet {}", view(&w, tax.id(), "ft_balance_of", json!({"account_id": alice.id()})).await);
    call("J1", &alice, tax.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (10_000 * E18).to_string(), "msg": "\"Deposit\""}), y(1), 100).await?;
    println!("alice DCL tax asset (sent 10 000) {}", view(&w, &d, "get_user_asset", json!({"account_id": alice.id(), "token_id": tax.id()})).await);
    call("J2", &alice, &d, "withdraw_asset", json!({"token_id": tax.id(), "skip_unwrap_near": true}), y(0), 150).await?;
    println!("alice tax wallet after withdraw {} ; get_tax {}", view(&w, tax.id(), "ft_balance_of", json!({"account_id": alice.id()})).await, view(&w, tax.id(), "get_tax", json!({})).await);
    // tax LP: deposit tax + wNEAR, add, trade, claim, remove, withdraw
    call("K1", &lp, tax.id(), "ft_transfer", json!({"receiver_id": alice.id(), "amount": (10_000 * E18).to_string()}), y(1), 30).await?;
    call("K2", &alice, tax.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (10_000 * E18).to_string(), "msg": "\"Deposit\""}), y(1), 100).await?;
    call("K3", &alice, wrap.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (2 * E24).to_string(), "msg": "\"Deposit\""}), y(1), 100).await?;
    let ta = view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await;
    println!("alice assets before tax add {ta}");
    let r = call("K4", &alice, &d, "add_liquidity", json!({"pool_id": p_tax, "left_point": -20000, "right_point": 20000, "amount_x": ta[tax.id().as_str()].clone(), "amount_y": (2 * E24).to_string(), "min_amount_x": "0", "min_amount_y": "0"}), y(0), 150).await?;
    let tl: String = r.json().unwrap_or_default();
    for i in 0..2 {
        let s1 = json!({"Swap": {"pool_ids": [p_tax], "output_token": tax.id(), "min_output_amount": "0"}});
        call(&format!("K5{i}"), &trader, wrap.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": (5 * E24).to_string(), "msg": s1.to_string()}), y(1), 200).await?;
        let s2 = json!({"Swap": {"pool_ids": [p_tax], "output_token": wrap.id(), "min_output_amount": "0"}});
        let bal = view(&w, tax.id(), "ft_balance_of", json!({"account_id": trader.id()})).await;
        call(&format!("K6{i}"), &trader, tax.id(), "ft_transfer_call", json!({"receiver_id": d, "amount": bal, "msg": s2.to_string()}), y(1), 200).await?;
    }
    println!("tax lpt {}", view(&w, &d, "get_liquidity", json!({"lpt_id": tl})).await);
    let am = view(&w, &d, "get_liquidity", json!({"lpt_id": tl})).await["amount"].clone();
    println!("predict_remove tax {}", view(&w, &d, "predict_remove_liquidity", json!({"lpt_id": tl, "amount": am})).await);
    call("K7", &alice, &d, "remove_liquidity", json!({"lpt_id": tl, "amount": am, "min_amount_x": "0", "min_amount_y": "0", "skip_refund_transfer": true}), y(0), 150).await?;
    let ta = view(&w, &d, "list_user_assets", json!({"account_id": alice.id()})).await;
    println!("alice assets after tax remove {ta} ; lpt after full remove {}", view(&w, &d, "get_liquidity", json!({"lpt_id": tl})).await);
    let w0 = view(&w, tax.id(), "ft_balance_of", json!({"account_id": alice.id()})).await;
    call("K8", &alice, &d, "withdraw_asset", json!({"token_id": tax.id(), "amount": ta[tax.id().as_str()].clone(), "skip_unwrap_near": true}), y(0), 150).await?;
    println!("alice tax wallet before {w0} after {} (asked {})", view(&w, tax.id(), "ft_balance_of", json!({"account_id": alice.id()})).await, ta[tax.id().as_str()]);
    println!("contract storage report {}", view(&w, &d, "get_contract_storage_report", json!({})).await);
    println!("alice storage detail {}", view(&w, &d, "get_user_storage_detail", json!({"user_id": alice.id()})).await);
    Ok(())
}
