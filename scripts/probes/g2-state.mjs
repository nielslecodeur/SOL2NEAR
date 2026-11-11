#!/usr/bin/env node
// READ-ONLY snapshot of everything batch A touches. No keys, no signing.
// Usage: node scripts/probes/g2-state.mjs [pool_id]
const RPC = process.env.NEAR_RPC_URL ?? "https://near-testnet.drpc.org";
const REF = "ref-finance-101.testnet";
const DEV = "sol2near-dev.testnet";
const USDC = "usdc.tidepool-sandbox.testnet";
const WNEAR = "wnear.tidepool-sandbox.testnet";
const poolArg = process.argv[2];

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "s", method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error.cause ?? j.error).slice(0, 200));
  return j.result;
}
async function view(account_id, method_name, args = {}) {
  const res = await rpc("query", { request_type: "call_function", finality: "final", account_id, method_name,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(res.result).toString());
}
const near = (y) => (Number(BigInt(y) / 10n ** 15n) / 1e9).toFixed(9);

const acc = await rpc("query", { request_type: "view_account", finality: "final", account_id: DEV });
const ref = await rpc("query", { request_type: "view_account", finality: "final", account_id: REF });
const md = await view(REF, "metadata");
const out = {
  block: acc.block_height,
  dev: { near: near(acc.amount), storage_bytes: acc.storage_usage },
  dev_tokens: {
    usdc: await view(USDC, "ft_balance_of", { account_id: DEV }),
    wnear: await view(WNEAR, "ft_balance_of", { account_id: DEV }),
  },
  ref_on_tokens: {
    usdc: await view(USDC, "storage_balance_of", { account_id: REF }),
    wnear: await view(WNEAR, "storage_balance_of", { account_id: REF }),
  },
  ref: { state: md.state, version: md.version, pool_count: md.pool_count, storage_bytes: ref.storage_usage },
  dev_on_ref: {
    storage: await view(REF, "storage_balance_of", { account_id: DEV }),
    registered_tokens: await view(REF, "get_user_whitelisted_tokens", { account_id: DEV }).catch(() => null),
    deposits: await view(REF, "get_deposits", { account_id: DEV }),
  },
};
if (poolArg !== undefined) {
  const id = Number(poolArg);
  out.pool = {
    id,
    info: await view(REF, "get_pool", { pool_id: id }),
    dev_shares: await view(REF, "get_pool_shares", { pool_id: id, account_id: DEV }),
    dev_mft: await view(REF, "mft_balance_of", { token_id: `:${id}`, account_id: DEV }),
    total_shares: await view(REF, "get_pool_total_shares", { pool_id: id }),
  };
}
console.log(JSON.stringify(out, null, 2));
