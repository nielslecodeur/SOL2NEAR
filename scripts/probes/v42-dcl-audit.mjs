#!/usr/bin/env node
// V4.2A — READ-ONLY audit of Rhea DCL / Nearly on MAINNET and TESTNET (public RPC `view` calls only).
// No account, key, signature or transaction. Mainnet is read to classify REAL Nearly pools; nothing here can
// move funds. Writes packages/near-client/src/fixtures/v42_dcl_mainnet_<date>.json (the evidence behind
// docs/V4_2A_DCL_FEASIBILITY.md) and prints a summary.
//   node scripts/probes/v42-dcl-audit.mjs
import { writeFileSync } from "node:fs";

const RPC = {
  mainnet: ["https://free.rpc.fastnear.com", "https://near.drpc.org"],
  testnet: ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"],
};
async function q(net, params) {
  let last;
  for (const url of RPC[net]) {
    try {
      const j = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) })).json();
      if (j.result && !j.result.error) return j.result;
      last = j.error?.data ?? j.error ?? j.result?.error;
    } catch (e) { last = e.message; }
  }
  throw new Error(typeof last === "string" ? last : JSON.stringify(last));
}
async function view(net, account_id, method_name, args = {}) {
  const r = await q(net, { request_type: "call_function", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
}
const tryView = async (...a) => { try { return { ok: true, v: await view(...a) }; } catch (e) { return { ok: false, err: String(e.message).slice(0, 200) }; } };

const DCL = "dclv2.ref-labs.near", FACTORY = "nearlytrade.near", WNEAR = "wrap.near";
// native USDC on NEAR (Circle), the asset a mainnet bridge would deliver
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
// Nearly token code generations (github.com/sam3dsol/Nearlytrade README, verified byte for byte by fetch-dcl-wasm.mjs)
const NEARLY_CODE = {
  "5qScjXG9uRG82Yrh36XZNZgVUYiqPtuC9ep5DvV42eGQ": "raw v1 (no tax)", "B6EjqsNJXfQXYX1KkUaypN8z7KpYcBrf9JNwTVtWUUBY": "raw v2 (no tax)",
  "DFiuocosGQbx3raMt3ACEauZqLXXYzX77MJNf361385R": "raw v3 (no tax)", "54GH1DmZgArERRH2ed8zJBXT7UxdeumaZe8Du8dtYJrt": "raw v4 (no tax)",
  "1uGuBEpx3dFRDrr2wNzm5Vcb5sF3jWY3AKQ3Gopd6we": "tax v1", "YXJL2KYynDA52JPBpAP5qDZhJqCTfB6dR5Ee4jdEgDK": "tax v2",
  "Cct6RbLZAEs5WmKkPFr4qqTAWKKzPhE4aTJHVwNLeGBS": "tax v3", "4yLHirATwQvHfn99Vsb98mWMkvVZhjgeJ5ahx4WhC1MZ": "tax v4",
  "HS4R2isPS7hnnY8k2QbxnLHUx9Z9v9mNZnLsrGqwhChh": "tax v5", "8GXVnFTxx1d6tYnoqNiQ5YzzQpj1uyxG7u28LeCGmsER": "tax v6",
};
const out = { read_at: new Date().toISOString(), note: "READ-ONLY public RPC views. Mainnet values are observations, not SOL2NEAR positions.", contracts: {}, pools: [], routes: {}, testnet: {} };

// ---------- contracts ----------
for (const [net, acc] of [["mainnet", DCL], ["mainnet", FACTORY], ["mainnet", WNEAR], ["mainnet", USDC], ["testnet", "dclv2.ref-dev.testnet"]]) {
  const a = await q(net, { request_type: "view_account", account_id: acc });
  const keys = await q(net, { request_type: "view_access_key_list", account_id: acc });
  out.contracts[`${net}:${acc}`] = { code_hash: a.code_hash, global_contract_hash: a.global_contract_hash ?? null, storage_usage: a.storage_usage, access_keys: keys.keys.length,
    full_access_keys: keys.keys.filter((k) => k.access_key.permission === "FullAccess").length };
}
const meta = await view("mainnet", DCL, "get_metadata");
out.contracts[`mainnet:${DCL}`].metadata = meta;
out.contracts[`mainnet:${DCL}`].fee_tiers = await view("mainnet", DCL, "get_fee_tiers");
out.contracts[`mainnet:${DCL}`].storage_balance_bounds = await view("mainnet", DCL, "storage_balance_bounds");
out.contracts[`testnet:dclv2.ref-dev.testnet`].metadata = await view("testnet", "dclv2.ref-dev.testnet", "get_metadata");
out.contracts[`mainnet:${FACTORY}`].owner = (await tryView("mainnet", FACTORY, "get_owner")).v ?? null;
out.contracts[`mainnet:${FACTORY}`].tax_bounds = (await tryView("mainnet", FACTORY, "get_tax_bounds")).v ?? null;
out.contracts[`mainnet:${FACTORY}`].num_launches = (await tryView("mainnet", FACTORY, "get_num_launches")).v ?? null;
out.contracts[`mainnet:${FACTORY}`].source = (await tryView("mainnet", FACTORY, "contract_source_metadata")).v ?? null;

// ---------- candidates: Nearly wNEAR pools, by wNEAR held (pool totals) ----------
const all = [];
for (let i = 0; ; i += 500) {
  const b = await view("mainnet", DCL, "list_pools", { from_index: i, limit: 500 });
  all.push(...b);
  if (b.length < 500) break;
}
const nearly = all.filter((p) => /\.nearlytrade\.near$/.test(p.token_x) && p.token_y === WNEAR).sort((a, b) => (BigInt(b.total_y) > BigInt(a.total_y) ? 1 : -1));
out.dcl_pool_count = all.length;
out.nearly_wnear_pool_count = nearly.length;
// NEARLY itself first, then the deepest untaxed and the deepest taxed launch
const classify = async (token) => {
  const a = await q("mainnet", { request_type: "view_account", account_id: token });
  return { code: NEARLY_CODE[a.global_contract_hash] ?? `unknown (${a.global_contract_hash ?? a.code_hash})`, global: a.global_contract_hash ?? null, keys: (await q("mainnet", { request_type: "view_access_key_list", account_id: token })).keys.length };
};
const picks = [nearly.find((p) => p.token_x === "nearly-993927.nearlytrade.near")];
for (const p of nearly.slice(0, 40)) {
  if (picks.length >= 3) break;
  if (picks.includes(p)) continue;
  const c = await classify(p.token_x);
  const wantTax = picks.length === 2 && !picks.some((x) => x._code?.startsWith("tax"));
  if (!picks[1] && c.code.startsWith("raw") && p.token_x !== picks[0].token_x) { p._code = c.code; picks[1] = p; continue; }
  if (picks[1] && c.code.startsWith("tax")) { p._code = c.code; picks.push(p); }
  if (wantTax) continue;
}

// ---------- route: USDC → wNEAR on the DCL (the asset a mainnet bridge would deliver) ----------
const usdcPools = all.filter((p) => [p.token_x, p.token_y].includes(USDC) && [p.token_x, p.token_y].includes(WNEAR));
out.routes.usdc_wnear_dcl_pools = usdcPools.map((p) => ({ pool_id: p.pool_id, fee: p.fee, liquidity: p.liquidity, total_x: p.total_x, total_y: p.total_y, state: p.state }));
const usdcPool = usdcPools.sort((a, b) => (BigInt(b.liquidity) > BigInt(a.liquidity) ? 1 : -1))[0];
out.routes.usdc_pool_used = usdcPool?.pool_id ?? null;

for (const p of picks.filter(Boolean)) {
  const token = p.token_x;
  const cls = await classify(token);
  const m = await view("mainnet", token, "ft_metadata");
  const tax = await tryView("mainnet", token, "get_tax");
  const rules = await tryView("mainnet", token, "get_rules");
  const launch = (await tryView("mainnet", FACTORY, "get_launch_by_token", { token })).v ?? null;
  const pool = await view("mainnet", DCL, "get_pool", { pool_id: p.pool_id });
  const quotes = {};
  if (usdcPool) {
    for (const usd of [10, 100, 1000]) {
      const amt = String(usd * 1e6);
      const qx = await tryView("mainnet", DCL, "quote", { pool_ids: [usdcPool.pool_id, p.pool_id], input_token: USDC, output_token: token, input_amount: amt });
      const qy = await tryView("mainnet", DCL, "quote", { pool_ids: [usdcPool.pool_id], input_token: USDC, output_token: WNEAR, input_amount: amt });
      quotes[`${usd}_usdc`] = { to_token: qx.v?.amount ?? qx.err, to_wnear: qy.v?.amount ?? qy.err };
    }
    const small = await tryView("mainnet", DCL, "quote", { pool_ids: [usdcPool.pool_id, p.pool_id], input_token: USDC, output_token: token, input_amount: String(1e6 / 10) });
    quotes.small_0_1_usdc_to_token = small.v?.amount ?? small.err;
  }
  const lockers = (await tryView("mainnet", FACTORY, "get_lockers")).v ?? [];
  const locker = launch ? [...lockers].reverse().find(([from]) => Number(launch.id) >= Number(from))?.[1] ?? null : null;
  let locker_position = null;
  if (locker) {
    const lp = await tryView("mainnet", locker, "get_position", { pool_id: p.pool_id });
    locker_position = lp.ok ? lp.v : `get_position: ${lp.err.slice(0, 80)}`;
    if (lp.ok && lp.v?.lpt_id) {
      const liq = await tryView("mainnet", DCL, "get_liquidity", { lpt_id: lp.v.lpt_id });
      locker_position = { ...lp.v, dcl: liq.v ?? liq.err };
    } else {
      // older lockers (lock, lock2) have no get_position: scan the locker's DCL positions for this pool
      const rows = [];
      for (let i = 0; i < 4000; i += 100) {
        const b = await tryView("mainnet", DCL, "list_liquidities", { account_id: locker, from_index: i, limit: 100 });
        if (!b.ok) break;
        rows.push(...b.v.filter((r) => r.pool_id === p.pool_id));
        if (b.v.length < 100) break;
      }
      locker_position = rows.length ? { source: "list_liquidities scan", rows } : "not found in locker list";
    }
  }
  out.pools.push({
    pool_id: p.pool_id, dex: DCL, network: "mainnet", token_x: token, token_y: WNEAR,
    decimals: { x: m.decimals, y: 24 }, symbol: m.symbol, fee: pool.fee, point_delta: pool.point_delta, current_point: pool.current_point,
    price_wnear_per_token: Math.pow(1.0001, pool.current_point) * 10 ** (m.decimals - 24),
    liquidity_active: pool.liquidity, total_liquidity: pool.total_liquidity, liquidity_x: pool.liquidity_x, total_x: pool.total_x, total_y: pool.total_y,
    total_fee_x_charged: pool.total_fee_x_charged, total_fee_y_charged: pool.total_fee_y_charged,
    volume_x_in: pool.volume_x_in, volume_y_in: pool.volume_y_in, pool_tax: pool.tax, state: pool.state, whitelist: pool.whitelist,
    token_code: cls, token_get_tax: tax.ok ? tax.v : `absent (${tax.err.slice(0, 60)})`, token_rules: rules.ok ? rules.v : null,
    launch: launch && { id: launch.id, creator: launch.creator, symbol: launch.symbol }, locker, locker_position, quotes,
  });
}

// ---------- testnet: is there anything to test against? ----------
const td = [];
for (let i = 0; ; i += 500) {
  const b = await view("testnet", "dclv2.ref-dev.testnet", "list_pools", { from_index: i, limit: 500 });
  td.push(...b);
  if (b.length < 500) break;
}
const tp = ["usdc.tidepool-sandbox.testnet", "wnear.tidepool-sandbox.testnet"];
out.testnet = {
  dcl: "dclv2.ref-dev.testnet", pools: td.length,
  pools_with_tidepool_token: td.filter((p) => tp.includes(p.token_x) || tp.includes(p.token_y)).map((p) => p.pool_id),
  nearly_like_pools: td.filter((p) => /nearly/.test(p.pool_id)).length,
  meme_cooking_pools_with_liquidity: td.filter((p) => /meme-cooking/.test(p.pool_id) && BigInt(p.liquidity) > 0n).length,
};
const date = out.read_at.slice(0, 10);
writeFileSync(new URL(`../../packages/near-client/src/fixtures/v42_dcl_mainnet_${date}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ contracts: Object.fromEntries(Object.entries(out.contracts).map(([k, v]) => [k, { code_hash: v.code_hash, keys: v.access_keys, full: v.full_access_keys, version: v.metadata?.version }])),
  dcl_pools: out.dcl_pool_count, nearly_wnear_pools: out.nearly_wnear_pool_count, usdc_pool: out.routes.usdc_pool_used, testnet: out.testnet }, null, 1));
for (const p of out.pools) console.log(`\n${p.symbol} ${p.pool_id}\n  code ${p.token_code.code} · get_tax ${JSON.stringify(p.token_get_tax).slice(0, 140)} · pool tax ${p.pool_tax}\n  point ${p.current_point} price ${p.price_wnear_per_token.toExponential(4)} wNEAR · active liq ${p.liquidity_active} total liq ${p.total_liquidity} · totals ${p.total_x} / ${p.total_y}\n  fees charged x ${p.total_fee_x_charged} y ${p.total_fee_y_charged}\n  launch ${JSON.stringify(p.launch)} locker ${p.locker} position ${JSON.stringify(p.locker_position).slice(0, 260)}\n  quotes ${JSON.stringify(p.quotes)}`);
