// Discovery only: prints the init errors of the fetched wasm so the main run uses the exact arguments.
use serde_json::json;
#[tokio::test]
async fn probe_init_args() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    for (file, tries) in [
        ("res/ref_exchange.wasm", vec![json!({}), json!({"owner_id": "test.near", "exchange_fee": 0, "referral_fee": 0}), json!({"owner_id": "test.near", "boost_farm_id": "test.near", "burrowland_id": "test.near", "exchange_fee": 0, "referral_fee": 0})]),
        ("res/tidepool_usdc.wasm", vec![json!({}), json!({"owner_id": "test.near"}), json!({"owner_id": "test.near", "metadata": {"spec": "ft-1.0.0", "name": "x", "symbol": "X", "decimals": 6}})]),
    ] {
        for args in tries {
            let c = w.dev_deploy(&std::fs::read(file)?).await?;
            let r = c.call("new").args_json(args.clone()).max_gas().transact().await?;
            let why: Vec<String> = r.receipt_failures().iter().map(|o| format!("{:?}", (*o).clone().into_result().err())).collect();
            println!("{file} new({args}) -> ok={} {}", r.is_success(), why.join(" | ").chars().take(500).collect::<String>());
        }
    }
    Ok(())
}
