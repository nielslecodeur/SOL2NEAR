// V4.0 READ-ONLY pool scan. No keys, no signing, view calls only (testnet + mainnet public RPC).
// Usage:
//   node scripts/probes/v4-pool-scan.ts               # route evidence + registry checks against live data
//   node scripts/probes/v4-pool-scan.ts --rank        # + rank wNEAR pools on testnet/mainnet (Classic) and mainnet DCL
//   node scripts/probes/v4-pool-scan.ts --write-fixture   # + save the raw reads to packages/near-client/src/fixtures/
import { writeFileSync } from "node:fs";
import {
  assessPool, normalizeClassic, normalizeDcl, POOL_REGISTRY, treasuryTarget,
  type LivePool, type RawClassicPool, type RawDclPool, type TokenMeta,
} from "../../packages/near-client/src/pools.ts";

const RPC: Record<"testnet" | "mainnet", string[]> = {
  testnet: ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"],
  mainnet: ["https://free.rpc.fastnear.com", "https://near.drpc.org"],
};
const args = new Set(process.argv.slice(2));

async function view<T>(net: "testnet" | "mainnet", account_id: string, method_name: string, a: object = {}): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) for (const url of RPC[net]) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id, method_name, args_base64: Buffer.from(JSON.stringify(a)).toString("base64") } }) });
      const j = await r.json();
      const e = j.error ?? j.result?.error;
      if (!e) return JSON.parse(Buffer.from(j.result.result).toString()) as T;
      last = new Error(JSON.stringify(e).slice(0, 200));
      if (!/rate|429|timeout|free plan/i.test(String(last))) throw last;
    } catch (e) { last = e; if (!/rate|429|timeout|fetch failed|free plan/i.test(String(e))) throw e; }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw last;
}

async function allClassic(net: "testnet" | "mainnet", ex: string) {
  const n = await view<number>(net, ex, "get_number_of_pools");
  const out: (RawClassicPool & { id: number })[] = [];
  for (let i = 0; i < n; i += 500) (await view<RawClassicPool[]>(net, ex, "get_pools", { from_index: i, limit: 500 })).forEach((p, k) => out.push({ id: i + k, ...p }));
  return out;
}
async function allDcl(net: "testnet" | "mainnet", ex: string) {
  const out: (RawDclPool & { pool_id: string })[] = [];
  for (let i = 0; ; i += 200) { const b = await view<(RawDclPool & { pool_id: string })[]>(net, ex, "list_pools", { from_index: i, limit: 200 }); out.push(...b); if (b.length < 200) break; }
  return out;
}

// 1. Route evidence: where can the Treasury's USDC go on testnet?
const cfg = await view<{ config: { usdc_token: string; pool_id: number; ref_exchange: string } }>("testnet", "treasury.sol2near-dev.testnet", "get_config");
const target = treasuryTarget(cfg);
console.log(`Treasury get_config: usdc_token=${target.usdcToken} pool_id=${target.poolId}`);
const tc = await allClassic("testnet", "ref-finance-101.testnet");
const td = await allDcl("testnet", "dclv2.ref-dev.testnet");
for (const t of [target.usdcToken, "wnear.tidepool-sandbox.testnet"]) {
  console.log(`testnet Classic pools holding ${t}: [${tc.filter((p) => p.token_account_ids.includes(t)).map((p) => p.id).join(", ")}] of ${tc.length}`);
  console.log(`testnet DCL pools holding ${t}: [${td.filter((p) => p.token_x === t || p.token_y === t).map((p) => p.pool_id).join(", ")}] of ${td.length}`);
}

// 2. Optional ranking (evidence for the candidates' choice)
if (args.has("--rank")) {
  const rank = (pools: (RawClassicPool & { id: number })[], w: string, re: RegExp) => pools
    .filter((p) => p.pool_kind === "SIMPLE_POOL" && p.token_account_ids.length === 2 && p.token_account_ids.includes(w) && p.token_account_ids.some((t) => re.test(t)))
    .map((p) => ({ id: p.id, token: p.token_account_ids.find((t) => t !== w)!, w: BigInt(p.amounts[p.token_account_ids.indexOf(w)]!) }))
    .sort((a, b) => (b.w > a.w ? 1 : -1)).slice(0, 5);
  console.log("testnet meme-cooking Classic pools by wrap.testnet reserve:", rank(tc, "wrap.testnet", /meme-cooking/).map((r) => `#${r.id} ${r.token} ${r.w / 10n ** 24n} wNEAR`));
  const mc = await allClassic("mainnet", "v2.ref-finance.near");
  console.log("mainnet launchpad-token Classic pools by wNEAR reserve:", rank(mc, "wrap.near", /meme-cooking|tkn\.near|nearlytrade/).map((r) => `#${r.id} ${r.token} ${r.w / 10n ** 24n} wNEAR`));
  const md = await allDcl("mainnet", "dclv2.ref-labs.near");
  console.log("mainnet Nearly DCL pools by wNEAR:", md.filter((p) => /nearlytrade/.test(p.pool_id) && /wrap\.near/.test(p.pool_id))
    .map((p) => ({ id: p.pool_id, w: BigInt(p.token_x === "wrap.near" ? p.total_x : p.total_y) })).sort((a, b) => (b.w > a.w ? 1 : -1)).slice(0, 5).map((r) => `${r.id} ${r.w / 10n ** 24n} wNEAR`));
}

// 3. Registry entries against live state
const fixture: Record<string, unknown> = { readAt: new Date().toISOString(), treasuryConfig: cfg, pools: {} as Record<string, unknown> };
for (const d of POOL_REGISTRY) {
  const net = d.network === "near-testnet" ? "testnet" : "mainnet";
  const meta: Record<string, TokenMeta | null> = {};
  for (const t of [d.tokenAContractId, d.tokenBContractId]) {
    try { const m = await view<TokenMeta & { name: string }>(net, t, "ft_metadata"); meta[t] = { symbol: m.symbol, decimals: m.decimals }; } catch { meta[t] = null; }
  }
  let live: LivePool | Error; let raw: unknown; let volumes: unknown = null;
  try {
    if (d.kind === "CLASSIC") {
      raw = await view<RawClassicPool>(net, d.dexContractId, "get_pool", { pool_id: Number(d.poolId) });
      volumes = await view<{ input: string }[]>(net, d.dexContractId, "get_pool_volumes", { pool_id: Number(d.poolId) }).catch(() => null);
      live = normalizeClassic(raw as RawClassicPool, volumes as { input: string }[] | null, meta);
    } else {
      raw = await view<RawDclPool>(net, d.dexContractId, "get_pool", { pool_id: d.poolId });
      live = normalizeDcl(raw as RawDclPool, meta);
    }
  } catch (e) { live = e as Error; }
  (fixture.pools as Record<string, unknown>)[d.key] = { raw, volumes, meta };
  const a = assessPool(d, live, target);
  console.log(`\n${a.status.padEnd(12)} ${d.key}  (${d.kind}, ${d.category})`);
  if (!(live instanceof Error)) console.log(`  tokens ${live.tokens.map((t) => `${meta[t]?.symbol ?? "?"}=${t}`).join(" / ")}  fee ${live.feeBps} bps`);
  for (const c of a.checks) console.log(`  ${c.ok ? "PASS" : "FAIL"} ${c.id}: ${c.detail.slice(0, 160)}`);
}
if (args.has("--write-fixture")) {
  const file = new URL("../../packages/near-client/src/fixtures/v4_pools_2026-11-13.json", import.meta.url);
  writeFileSync(file, JSON.stringify(fixture, null, 1) + "\n");
  console.log(`\nfixture written: ${file.pathname}`);
}
