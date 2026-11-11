#!/usr/bin/env node
// READ-ONLY testnet verification for SOL2NEAR. No keys, no signing, no transaction.
// Usage: node scripts/probes/verify-testnet.mjs            (Node >= 20)
// Optional env: SOLANA_REFUND_ADDRESS (base58, used only in a dry quote), NEAR_RPC_URL, LP_POOL_ID
//
// Prints one line per check: PASS / FAIL / INFO, then exits 1 if any FAIL.

const TIDEPOOL = "https://www.usetidepool.tech";
const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
const REF = "ref-finance-101.testnet";
const USDC = "usdc.tidepool-sandbox.testnet";
const WNEAR = "wnear.tidepool-sandbox.testnet";
const SOL_USDC = "nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet";
const TREASURY = "treasury.sol2near-dev.testnet";
const DEV = "sol2near-dev.testnet";
// Dry quotes never create a deposit address; this placeholder is the Solana devnet USDC mint itself.
const REFUND = process.env.SOLANA_REFUND_ADDRESS ?? "7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr";
const POOL_ID = process.env.LP_POOL_ID ? Number(process.env.LP_POOL_ID) : null;
const UA = { "user-agent": "sol2near-verify/0.1" };

let failures = 0;
const out = (tag, msg) => console.log(`${tag.padEnd(4)} ${msg}`);
const pass = (m) => out("PASS", m);
const info = (m) => out("INFO", m);
const fail = (m) => { failures++; out("FAIL", m); };

async function http(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...UA, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
}

async function rpc(method, params) {
  const r = await http("POST", RPC, { jsonrpc: "2.0", id: "v", method, params });
  if (r.json?.error) throw new Error(JSON.stringify(r.json.error).slice(0, 200));
  return r.json.result;
}

async function view(account_id, method_name, args = {}) {
  const res = await rpc("query", {
    request_type: "call_function", finality: "final", account_id, method_name,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(res.result).toString());
}

async function check(name, fn) {
  try { await fn(); } catch (e) { fail(`${name}: ${e.message}`); }
}

await check("tidepool health", async () => {
  const { json } = await http("GET", `${TIDEPOOL}/v0/health`);
  json?.network === "testnet" ? pass(`Tidepool network=testnet (community sandbox, not official NEAR Intents)`) : fail(`Tidepool network=${json?.network}`);
  json?.bridges?.chains?.sol?.ok ? pass("Tidepool Solana devnet route ok=true") : fail("Tidepool Solana devnet route not ok");
});

await check("tidepool tokens", async () => {
  const { json } = await http("GET", `${TIDEPOOL}/v0/tokens`);
  const sol = json.find((t) => t.assetId === SOL_USDC);
  const near = json.find((t) => t.assetId === `nep141:${USDC}`);
  sol?.decimals === 6 ? pass(`SOL devnet USDC listed (mint ${sol.contractAddress}, 6 decimals)`) : fail("SOL devnet USDC not listed");
  near?.decimals === 6 ? pass("NEAR testnet USDC listed (6 decimals)") : fail("NEAR testnet USDC not listed");
});

await check("tidepool dry quote", async () => {
  const req = {
    dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100,
    originAsset: SOL_USDC, depositType: "ORIGIN_CHAIN",
    destinationAsset: `nep141:${USDC}`, amount: "1000000",
    refundTo: REFUND, refundType: "ORIGIN_CHAIN",
    recipient: DEV, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const { status, json, text } = await http("POST", `${TIDEPOOL}/v0/quote`, req);
  if (status !== 200) return fail(`dry quote HTTP ${status}: ${text.slice(0, 160)}`);
  const q = json.quote;
  const fee = BigInt(q.amountIn) - BigInt(q.amountOut);
  pass(`dry quote 1 USDC SPL -> ${q.amountOutFormatted} USDC NEAR (min ${q.minAmountOut}), quoted cost ${fee} atomic, ~${q.timeEstimate}s`);
  q.depositAddress ? fail("dry quote returned a deposit address") : pass("dry quote has no deposit address (nothing can be sent)");
});

await check("ref exchange", async () => {
  const m = await view(REF, "metadata");
  m.state === "Running" ? pass(`Ref ${REF} v${m.version} state=Running, pools=${m.pool_count}`) : fail(`Ref state=${m.state}`);
  const wl = await view(REF, "get_whitelisted_tokens");
  info(`Tidepool USDC globally whitelisted on Ref: ${wl.includes(USDC)} (register_tokens needed if false)`);
});

await check("usdc token", async () => {
  const md = await view(USDC, "ft_metadata");
  md.decimals === 6 ? pass(`${USDC}: "${md.name}", 6 decimals`) : fail(`${USDC} decimals=${md.decimals}`);
  for (const acct of [REF, TREASURY]) {
    const sb = await view(USDC, "storage_balance_of", { account_id: acct });
    info(`${USDC} storage for ${acct}: ${sb ? "registered" : "not registered"}`);
  }
  const sbw = await view(WNEAR, "storage_balance_of", { account_id: REF });
  info(`${WNEAR} storage for ${REF}: ${sbw ? "registered" : "not registered"}`);
});

await check("treasury", async () => {
  const acc = await rpc("query", { request_type: "view_account", finality: "final", account_id: TREASURY });
  const deployed = acc.code_hash !== "11111111111111111111111111111111";
  info(`${TREASURY}: balance ${(Number(BigInt(acc.amount) / 10n ** 21n) / 1000).toFixed(3)} NEAR, contract ${deployed ? `deployed (code_hash ${acc.code_hash})` : "NOT deployed"}`);
  if (deployed) {
    const c = await view(TREASURY, "get_config");
    info(`Treasury ready=${c.ready} pool_id=${c.config.pool_id} split=${c.lp_bps}/${c.reserve_bps}/${c.community_bps}`);
    const a = await view(TREASURY, "get_accounting");
    info(`Treasury accounting ${JSON.stringify(a)}`);
  }
});

if (POOL_ID !== null) {
  await check("lp pool", async () => {
    const p = await view(REF, "get_pool", { pool_id: POOL_ID });
    info(`pool ${POOL_ID}: ${p.pool_kind} ${p.token_account_ids.join("/")} amounts ${p.amounts.join("/")} fee ${p.total_fee} bps`);
    const s = await view(REF, "get_pool_shares", { pool_id: POOL_ID, account_id: TREASURY });
    BigInt(s) > 0n ? pass(`Treasury holds ${s} LP shares of pool ${POOL_ID}`) : info(`Treasury holds 0 LP shares of pool ${POOL_ID}`);
  });
} else {
  info("LP_POOL_ID not set: no SOL2NEAR pool created yet (gate G2)");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
