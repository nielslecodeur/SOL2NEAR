// V4.2A discovery only (LOCAL SANDBOX): prints the init errors of the real Rhea DCL / wrap.near wasm so the
// main run (v42_dcl.rs) uses their exact arguments. The DCL source is not public, so its argument names are read
// from its own deserialisation errors.
use serde_json::json;
#[tokio::test]
async fn probe_dcl_init_args() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    for (file, tries) in [
        ("res/dcl_mainnet.wasm", vec![json!({}), json!({"owner_id": "test.near"}), json!({"owner_id": "test.near", "wnear_id": "test.near"}), json!({"owner_id": "test.near", "wnear_id": "test.near", "farming_contract_id": "test.near"})]),
        ("res/wrap_near.wasm", vec![json!({}), json!({"owner_id": "test.near", "total_supply": "0"})]),
    ] {
        for args in tries {
            let c = w.dev_deploy(&std::fs::read(file)?).await?;
            let r = c.call("new").args_json(args.clone()).max_gas().transact().await?;
            let why: Vec<String> = r.receipt_failures().iter().map(|o| format!("{:?}", (*o).clone().into_result().err())).collect();
            println!("{file} new({args}) -> ok={} {}", r.is_success(), why.join(" | ").chars().take(400).collect::<String>());
        }
    }
    Ok(())
}
