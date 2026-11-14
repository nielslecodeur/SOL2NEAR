#!/usr/bin/env node
// H1/H3 — READ-ONLY mainnet REFERENCE simulation of a SOL2NEAR contribution to the real NEARLY / wNEAR Rhea DCL pool.
// View calls only (no account, no key, no transaction), ALL pinned to ONE final block so the snapshot is consistent.
// It runs the SAME planner the dashboard uses (packages/near-client buildDclPlan: Rhea's own `quote` + `predict_hotzap`).
//   node scripts/probes/nearly-reference-sim.mjs [usdc=100] [halfWidth=20000]
// Writes packages/near-client/src/fixtures/nearly_reference_sim.json (shown by the public demo as a RECORDED simulation).
import { writeFileSync } from "node:fs";
import {
  buildDclPlan, estimateDcl, MAINNET_USDC, NEARLY_DCL_CANDIDATES, parsePredictHotzap, pointToPrice, rangeAround,
} from "../../packages/near-client/src/index.ts";

const RPCS = ["https://free.rpc.fastnear.com", "https://near.drpc.org"];
const c = NEARLY_DCL_CANDIDATES.find((x) => x.key === "dcl:nearly");
const usdc = BigInt(Math.round(Number(process.argv[2] ?? "100") * 1e6));
const half = Number(process.argv[3] ?? "20000");

async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); last = `${url} 429`; continue; }
        const j = await r.json();
        if (j.result && !j.result.error) return j.result;
        last = JSON.stringify(j.error ?? j.result?.error).slice(0, 300);
        break;
      } catch (e) { last = e.message; }
    }
  }
  throw new Error(`${method}: ${last}`);
}
const head = await rpc("block", { finality: "final" });
const block_id = head.header.height;
const view = async (account, method, args) => {
  const r = await rpc("query", { request_type: "call_function", block_id, account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
};

const pool = await view(c.dex, "get_pool", { pool_id: c.poolId });
const [left, right] = rangeAround(pool.current_point, half, c.pointDelta);
const route = { x: [c.usdcPool, c.poolId], y: [c.usdcPool] };
const spend = (usdc * 9000n) / 10_000n;
const quote = async (toX, toY) => {
  const a = await view(c.dex, "quote", { pool_ids: route.x, input_token: MAINNET_USDC, output_token: c.tokenX, input_amount: String(toX) });
  const b = await view(c.dex, "quote", { pool_ids: route.y, input_token: MAINNET_USDC, output_token: c.tokenY, input_amount: String(toY) });
  return [BigInt(a.amount), BigInt(b.amount)];
};
const predict = async (toX, toY, capX, capY) => {
  const v = await view(c.dex, "predict_hotzap", {
    token_in: MAINNET_USDC, amount_in: String(toX + toY),
    swap_infos: [
      { pool_ids: route.x, input_token: MAINNET_USDC, output_token: c.tokenX, amount_in: String(toX), min_output_amount: "0" },
      { pool_ids: route.y, input_token: MAINNET_USDC, output_token: c.tokenY, amount_in: String(toY), min_output_amount: "0" },
    ],
    add_liquidity_infos: [{ pool_id: c.poolId, left_point: left, right_point: right, amount_x: String(capX), amount_y: String(capY), min_amount_x: "0", min_amount_y: "0" }],
  });
  const p = parsePredictHotzap(v, c.tokenX, c.tokenY);
  if (!p) throw new Error("predict_hotzap: unexpected result " + JSON.stringify(v).slice(0, 200));
  return p;
};
const r = await buildDclPlan({ spend, left, right, slippageBps: 100, deadlineNs: 0n, quote, predict });
const est = estimateDcl(usdc, spend, r.prediction);
// price impact of the X leg alone, from the same block: big quote vs 1/1000 quote scaled
const toX = BigInt(r.plan.usdc_to_x);
const [qBig] = await quote(toX, 1n);
const [qSmall] = await quote(toX / 1000n || 1n, 1n);
const impactBps = qSmall === 0n ? null : Number(10_000n - (qBig * 10_000n) / (qSmall * 1000n));
const s = (v) => (typeof v === "bigint" ? v.toString() : v);
const out = {
  label: "MAINNET REFERENCE SIMULATION (view calls only)",
  not: ["no transaction", "no SOL2NEAR contract on mainnet", "SOL2NEAR moves testnet USDC only", "not a quote you can execute"],
  network: "near-mainnet", block_height: block_id, block_hash: head.header.hash, block_time_utc: new Date(Number(BigInt(head.header.timestamp_nanosec) / 1_000_000n)).toISOString(),
  rpc: RPCS, dex: c.dex, pool_id: c.poolId, token_x: c.tokenX, token_y: c.tokenY, usdc: MAINNET_USDC, route_x: route.x, route_y: route.y,
  pool: { current_point: pool.current_point, price_wnear_per_nearly: pointToPrice(pool.current_point, 18, 24), liquidity_active: pool.liquidity, total_liquidity: pool.total_liquidity, fee: pool.fee, point_delta: pool.point_delta, state: pool.state, total_x: pool.total_x, total_y: pool.total_y },
  input: { usdc_atomic: s(usdc), half_width_points: half, slippage_bps: 100 },
  range: { left_point: left, right_point: right, price_left: pointToPrice(left, 18, 24), price_right: pointToPrice(right, 18, 24) },
  split_90_8_2: { lp_budget: s(est.lpBudget), reserve: s(est.reserve), community: s(est.community) },
  plan: Object.fromEntries(Object.entries(r.plan).map(([k, v]) => [k, s(v)])),
  share_to_nearly: r.shareX, iterations: r.iterations,
  prediction: { out_x: s(r.prediction.outX), out_y: s(r.prediction.outY), need_x: s(r.prediction.needX), need_y: s(r.prediction.needY), liquidity: s(r.prediction.liquidity) },
  estimate: { into_position_x: s(est.intoPositionX), into_position_y: s(est.intoPositionY), leftover_x: s(est.leftoverX), leftover_y: s(est.leftoverY), leftover_share_bps: est.leftoverShareBps },
  nearly_leg_price_impact_bps: impactBps,
  method: "packages/near-client buildDclPlan (bisection on the USDC split with Rhea predict_hotzap; min outs = predicted − ½ slippage) + estimateDcl (90/8/2 split)",
};
writeFileSync(new URL("../../packages/near-client/src/fixtures/nearly_reference_sim.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`block ${block_id}: ${Number(usdc) / 1e6} USDC → ${(Number(r.prediction.needX) / 1e18).toFixed(2)} NEARLY + ${(Number(r.prediction.needY) / 1e24).toFixed(4)} wNEAR into [${left}, ${right}], NEARLY-leg impact ${impactBps} bps`);
