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
async fn probe_predict_hotzap() -> anyhow::Result<()> {
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

    // discover predict_hotzap arguments from its own deserialisation errors
    let vals = |f: &str| -> Value {
        match f {
            "token_id" | "input_token" | "token_in" => json!(usdc.id()),
            "amount_in" | "amount" | "input_amount" | "amount_in_total" => json!((10 * USDC1).to_string()),
            "swap_infos" => json!([{"pool_ids": [p_usdc], "input_token": usdc.id(), "output_token": wrap.id(), "amount_in": (5 * USDC1).to_string(), "min_output_amount": "0"},
                {"pool_ids": [p_usdc, p_raw], "input_token": usdc.id(), "output_token": raw.id(), "amount_in": (5 * USDC1).to_string(), "min_output_amount": "0"}]),
            "add_liquidity_infos" => json!([{"pool_id": p_raw, "left_point": -20000, "right_point": 20000, "amount_x": (1 * E18).to_string(), "amount_y": (1 * E24 / 1000).to_string(), "min_amount_x": "0", "min_amount_y": "0"}]),
            _ => json!(null),
        }
    };
    let mut args = serde_json::Map::new();
    for _ in 0..12 {
        match w.view(&d, "predict_hotzap").args_json(Value::Object(args.clone())).await {
            Ok(v) => {
                println!("predict_hotzap({}) = {}", Value::Object(args.clone()), String::from_utf8_lossy(&v.result));
                break;
            }
            Err(e) => {
                let m = format!("{e:?}");
                println!("predict_hotzap({}) ERR {}", Value::Object(args.clone()), short(m.clone()));
                let Some(i) = m.find("missing field `") else { break };
                let f = &m[i + 15..];
                let f = &f[..f.find('`').unwrap()];
                args.insert(f.to_string(), vals(f));
            }
        }
    }
    Ok(())
}
