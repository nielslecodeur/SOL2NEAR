// V4.0 registry + assessment, on REAL reads saved by `node scripts/probes/v4-pool-scan.ts --write-fixture`
// (2026-11-13). Variants derived from them are marked SYNTHETIC. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessPool, findDescriptor, normalizeClassic, normalizeDcl, POOL_REGISTRY, selectPool, treasuryTarget,
  type Assessment, type LivePool, type PoolDescriptor, type RawClassicPool, type RawDclPool, type TokenMeta,
} from "./pools.ts";
import { previewSwap, priceImpactBps } from "./lpPlan.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/v4_pools_2026-11-13.json", import.meta.url), "utf8"));
const target = treasuryTarget(fx.treasuryConfig);
const PILOT = "near-testnet:ref-finance-101.testnet:2951";
const MEV = "near-testnet:ref-finance-101.testnet:2131";
const CHILL = "near-mainnet:v2.ref-finance.near:5462";
const NEARLY = "near-mainnet:dclv2.ref-labs.near:nearly-993927.nearlytrade.near|wrap.near|10000";

function liveOf(d: PoolDescriptor): LivePool {
  const r = fx.pools[d.key] as { raw: unknown; volumes: { input: string }[] | null; meta: Record<string, TokenMeta | null> };
  return d.kind === "CLASSIC" ? normalizeClassic(r.raw as RawClassicPool, r.volumes, r.meta) : normalizeDcl(r.raw as RawDclPool, r.meta);
}
const d = (k: string) => findDescriptor(k)!;
const failed = (a: Assessment) => a.checks.filter((c) => !c.ok).map((c) => c.id);
const all = () => new Map(POOL_REGISTRY.map((x) => [x.key, assessPool(x, liveOf(x), target)]));

test("registry: unique keys, every entry has a fixture read, keys match their fields, nothing ELIGIBLE but the pilot", () => {
  assert.equal(new Set(POOL_REGISTRY.map((x) => x.key)).size, POOL_REGISTRY.length);
  for (const x of POOL_REGISTRY) {
    assert.ok(fx.pools[x.key]?.raw, `fixture read for ${x.key}`);
    assert.equal(x.key, `${x.network}:${x.dexContractId}:${x.poolId}`);
    assert.equal(x.network === "near-testnet", /\.testnet$/.test(x.dexContractId), "network matches the DEX account");
    for (const t of [x.tokenAContractId, x.tokenBContractId]) assert.equal(x.network === "near-testnet", /\.testnet$/.test(t), `no testnet/mainnet mix in ${x.key}`);
  }
  assert.deepEqual(POOL_REGISTRY.filter((x) => x.status === "ELIGIBLE").map((x) => x.key), [PILOT]);
});

test("Treasury target comes from the real get_config: ref-finance-101.testnet, pool 2951, Tidepool USDC", () => {
  assert.deepEqual(target, { network: "near-testnet", dexContractId: "ref-finance-101.testnet", poolId: "2951", usdcToken: "usdc.tidepool-sandbox.testnet" });
});

test("pilot pool 2951 (real read): every check passes -> ELIGIBLE; 30 bps fee read from get_pool", () => {
  const live = liveOf(d(PILOT));
  const a = assessPool(d(PILOT), live, target);
  assert.equal(a.status, "ELIGIBLE");
  assert.deepEqual(a.reasons, []);
  assert.equal(live.feeBps, 30);
  assert.equal(d(PILOT).category, "PILOT_NOT_MEMECOIN");
});

test("testnet memecoin pool 2131 (real read): Classic and filled, but tax UNKNOWN, no USDC route, not the Treasury pool -> OBSERVE_ONLY", () => {
  const a = assessPool(d(MEV), liveOf(d(MEV)), target);
  assert.equal(a.status, "OBSERVE_ONLY");
  assert.deepEqual(failed(a), ["tax", "usdc_route", "treasury_pool"]);
  assert.match(a.reasons.join(" "), /appear only in pool 2951/);
});

test("mainnet pools are never fundable: network check fails first (Classic CHILL and DCL NEARLY, real reads)", () => {
  const c = assessPool(d(CHILL), liveOf(d(CHILL)), target);
  assert.equal(c.status, "OBSERVE_ONLY");
  assert.equal(failed(c)[0], "network");
  const n = assessPool(d(NEARLY), liveOf(d(NEARLY)), target);
  assert.deepEqual(failed(n), ["network", "kind", "tax", "usdc_route", "treasury_pool"]);
  assert.match(n.reasons.join(" "), /NFTs/);
});

test("DCL fee is converted from 1e-6 units: NEARLY fee 10000 -> 100 bps (1 %); pool-level tax null", () => {
  const live = liveOf(d(NEARLY));
  assert.equal(live.kind, "DCL");
  assert.equal(live.feeBps, 100);
  assert.equal(live.kind === "DCL" && live.poolTax, null);
});

test("SYNTHETIC: a DCL pool-level tax is reported as such", () => {
  const live = liveOf(d(NEARLY));
  const taxed = { ...live, poolTax: { creator: "x.near", tax_rate: 5, protocol_portion: 2000 } } as LivePool;
  assert.match(assessPool(d(NEARLY), taxed, target).checks.find((c) => c.id === "tax")!.detail, /pool itself charges a tax/);
});

test("SYNTHETIC: a curated ELIGIBLE pool is downgraded as soon as one live check fails (no stale trust)", () => {
  const live = liveOf(d(PILOT));
  if (live.kind !== "CLASSIC") throw new Error("pilot is Classic");
  const cases: [string, LivePool | Error, string][] = [
    ["unreadable", new Error("every provider failed"), "readable"],
    ["imposter token", { ...live, tokens: ["usdc.fake.testnet", live.tokens[1]] }, "identity"],
    ["decimals changed", { ...live, meta: { ...live.meta, "usdc.tidepool-sandbox.testnet": { symbol: "USDC", decimals: 18 } } }, "identity"],
    ["metadata unreadable", { ...live, meta: { ...live.meta, "wnear.tidepool-sandbox.testnet": null } }, "identity"],
    ["emptied", { ...live, amounts: ["0", live.amounts[1]] }, "liquidity"],
    ["became stable swap", { ...live, poolKind: "STABLE_SWAP" }, "kind"],
  ];
  for (const [name, l, check] of cases) {
    const a = assessPool(d(PILOT), l, target);
    assert.equal(a.status, "OBSERVE_ONLY", name);
    assert.ok(failed(a).includes(check as never), `${name} fails ${check}`);
  }
  // Treasury config unreadable: nothing is fundable
  assert.equal(assessPool(d(PILOT), live, null).status, "OBSERVE_ONLY");
  // Treasury pointing elsewhere (SYNTHETIC config)
  assert.deepEqual(failed(assessPool(d(PILOT), live, { ...target, poolId: "9999" })), ["treasury_pool"]);
});

test("SYNTHETIC: a SUSPENDED entry stays SUSPENDED even with healthy live data", () => {
  const a = assessPool({ ...d(PILOT), status: "SUSPENDED" }, liveOf(d(PILOT)), target);
  assert.equal(a.status, "SUSPENDED");
  assert.match(a.reasons[0]!, /Suspended/);
});

test("selection: only the ELIGIBLE pool is selectable; OBSERVE_ONLY and unknown pools are refused (spec E2E #1 and #4)", () => {
  const as = all();
  assert.equal(selectPool(PILOT, as).ok, true);
  for (const k of [MEV, CHILL, NEARLY]) {
    const s = selectPool(k, as);
    assert.equal(s.ok, false, k);
    assert.match((s as { reason: string }).reason, /^OBSERVE_ONLY/);
  }
  const unknown = selectPool("near-testnet:ref-finance-101.testnet:2190x", as);
  assert.equal(unknown.ok, false);
  assert.match((unknown as { reason: string }).reason, /not in the SOL2NEAR registry/);
  assert.equal(selectPool(PILOT, new Map()).ok, false, "not assessed yet -> refused");
});

test("preflight on the real pilot read reuses the proven LP plan: 1.8 USDC budget, impact from the same formula", () => {
  const live = liveOf(d(PILOT));
  if (live.kind !== "CLASSIC") throw new Error("pilot is Classic");
  const pool = { token_account_ids: live.tokens, amounts: live.amounts, total_fee: live.feeBps };
  const p = previewSwap(1_800_000n, pool, target.usdcToken, 100);
  assert.ok(p.swapAmountIn > 0n && p.swapAmountIn < 1_800_000n);
  const bps = priceImpactBps(pool, target.usdcToken, p.swapAmountIn, p.expectedOut);
  assert.ok(bps > 30 && bps < 300, `impact ${bps} bps includes the 30 bps fee and stays small for 1.8 USDC`);
});
