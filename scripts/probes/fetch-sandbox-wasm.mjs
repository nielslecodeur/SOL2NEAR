#!/usr/bin/env node
// READ-ONLY: downloads the CODE of public testnet contracts through the NEAR RPC `view_code` query, so the
// V4.1 local sandbox run (sandbox-tests/) executes the same Ref and Tidepool USDC wasm as testnet.
// Writes sandbox-tests/res/<name>.wasm (git-ignored) and prints code_hash + SHA-256 for the report.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
// sandbox-tests/res/ is git-ignored, so it does not exist in a fresh clone (found in the G9 public-clone check)
mkdirSync(new URL("../../sandbox-tests/res/", import.meta.url), { recursive: true });
const RPC = ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"];
const TARGETS = { ref_exchange: "ref-finance-101.testnet", tidepool_usdc: "usdc.tidepool-sandbox.testnet" };
for (const [name, account] of Object.entries(TARGETS)) {
  let r;
  for (const url of RPC) {
    try {
      const j = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_code", finality: "final", account_id: account } }) })).json();
      if (j.result?.code_base64) { r = j.result; break; }
    } catch {}
  }
  if (!r) throw new Error(`view_code failed for ${account}`);
  const bytes = Buffer.from(r.code_base64, "base64");
  writeFileSync(new URL(`../../sandbox-tests/res/${name}.wasm`, import.meta.url), bytes);
  console.log(`${name.padEnd(14)} ${account} block ${r.block_height} code_hash ${r.hash} sha256 ${createHash("sha256").update(bytes).digest("hex")} ${bytes.length} B`);
}
