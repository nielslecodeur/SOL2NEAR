// READ-ONLY: computes the Treasury.execute_lp plan for a deposit from the LIVE Ref pool.
// Usage: node scripts/plan-lp.ts <pool_id> <lp_budget_usdc_atomic> [slippage_bps=100]
// Prints the JSON plan to pass to execute_lp. No keys, no signing.
import {
  addAmountsInPoolOrder, minAmountsFromPredict, previewSwap, toTreasuryPlan, type PoolSnapshot,
} from "../packages/near-client/src/lpPlan.ts";

const [poolArg, budgetArg, slipArg = "100"] = process.argv.slice(2);
if (!poolArg || !budgetArg) throw new Error("usage: node scripts/plan-lp.ts <pool_id> <lp_budget_usdc_atomic> [slippage_bps]");
const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
const USDC = "usdc.tidepool-sandbox.testnet";

const res = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: "plan", method: "query",
    params: { request_type: "call_function", finality: "final", account_id: "ref-finance-101.testnet", method_name: "get_pool",
      args_base64: Buffer.from(JSON.stringify({ pool_id: Number(poolArg) })).toString("base64") },
  }),
});
const json = await res.json();
if (json.error || json.result?.error) throw new Error(JSON.stringify(json.error ?? json.result.error));
const pool: PoolSnapshot = JSON.parse(Buffer.from(json.result.result).toString());

const slippage = Number(slipArg);
const p = previewSwap(BigInt(budgetArg), pool, USDC, slippage);
// After our swap the remaining USDC and the wNEAR received match the pool ratio, so add_liquidity
// uses ~all of both; the guard is "at least (1 - slippage) of what we provide".
const provided = addAmountsInPoolOrder(pool, USDC, p.usdcLeft, p.expectedOut);
const plan = toTreasuryPlan(p, minAmountsFromPredict([provided[0].toString(), provided[1].toString()], slippage));

console.log(JSON.stringify({
  pool: { tokens: pool.token_account_ids, amounts: pool.amounts, total_fee_bps: pool.total_fee },
  preview: { swap_usdc_in: p.swapAmountIn.toString(), expected_wnear_out: p.expectedOut.toString(), usdc_left_for_lp: p.usdcLeft.toString(), pool_fee_usdc: p.poolFeeIn.toString() },
  plan,
}, null, 2));
