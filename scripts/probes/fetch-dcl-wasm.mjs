#!/usr/bin/env node
// V4.2A — READ-ONLY. Downloads the CODE of public contracts (NEAR RPC `view_code` / `view_global_contract_code`)
// so the local DCL sandbox run (sandbox-tests/tests/v42_dcl.rs) executes the same bytes as the live contracts.
// No account, key or transaction is involved. Writes sandbox-tests/res/<name>.wasm (git-ignored) and prints
// code_hash + SHA-256 for the report. Mainnet is used ONLY to copy code: no mainnet state or funds are touched.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const RPC = {
  mainnet: ["https://free.rpc.fastnear.com", "https://near.drpc.org"],
  testnet: ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"],
};
// name → [network, account | null, global code hash | null, expected SHA-256 or null]
const TARGETS = {
  // Rhea DCL as live on mainnet (v2.4.2 on 2026-11-14) — the exchange every Nearly pool lives on
  dcl_mainnet: ["mainnet", "dclv2.ref-labs.near", null, null],
  // wrap.near (wNEAR) — the pair asset of Nearly native launches
  wrap_near: ["mainnet", "wrap.near", null, null],
  // Nearly raw token v1 (global code; $NEARLY runs it). SHA-256 from github.com/sam3dsol/Nearlytrade README
  nearly_token_raw_v1: ["mainnet", null, "5qScjXG9uRG82Yrh36XZNZgVUYiqPtuC9ep5DvV42eGQ", "47d7973b0a3bf97a5008f03c7caf15d02fc05ac0c34c1878bdf7ebabf6857fc9"],
  // Nearly tax token v6 (global code; tax launches since 2026-10-05). SHA-256 from the same README
  nearly_token_tax_v6: ["mainnet", null, "8GXVnFTxx1d6tYnoqNiQ5YzzQpj1uyxG7u28LeCGmsER", "6bfc00b72948064a5c18c8081a1107a7f9e2b3f2068b5060d2f3711ec195a482"],
};

async function rpc(net, params) {
  let last;
  for (const url of RPC[net]) {
    try {
      const j = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) })).json();
      if (j.result?.code_base64) return j.result;
      last = j.error ?? j.result?.error;
    } catch (e) { last = e.message; }
  }
  throw new Error(`view_code failed: ${JSON.stringify(last)}`);
}

let bad = 0;
for (const [name, [net, account, hash, expect]] of Object.entries(TARGETS)) {
  const r = await rpc(net, account ? { request_type: "view_code", account_id: account } : { request_type: "view_global_contract_code", code_hash: hash });
  const bytes = Buffer.from(r.code_base64, "base64");
  const sha = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(new URL(`../../sandbox-tests/res/${name}.wasm`, import.meta.url), bytes);
  const ok = !expect || expect === sha;
  if (!ok) bad++;
  console.log(`${name.padEnd(20)} ${net} ${account ?? "global:" + hash} block ${r.block_height} code_hash ${r.hash ?? hash} sha256 ${sha} ${bytes.length} B ${expect ? (ok ? "= Nearly README" : "MISMATCH with Nearly README") : ""}`);
}
process.exit(bad ? 1 : 0);
