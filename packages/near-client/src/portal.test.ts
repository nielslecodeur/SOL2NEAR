// V4.3A Creator Portal model — on REAL data: testnet deposits of the G6/G7 creator (read-only views), the V4.1 and
// V4.2A sandbox views. Inputs marked SYNTHETIC are hand-built to exercise one rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEATURES, fromDclView, fromV3Deposit, fromV4View, poolOffers, QUOTE_STALE_MS, simulateLiveContribution, type ClassicLeg } from "./portal.ts";
import type { DclPositionView } from "./dcl.ts";
import type { V4PositionView } from "./v4Position.ts";

const v3 = JSON.parse(readFileSync(new URL("./fixtures/v3_creator_testnet_2026-11-14.json", import.meta.url), "utf8"));
const dcl = JSON.parse(readFileSync(new URL("./fixtures/v42_dcl_sandbox_views.json", import.meta.url), "utf8"));
const v4 = JSON.parse(readFileSync(new URL("./fixtures/v4_sandbox_views.json", import.meta.url), "utf8"));

test("feature table: every executed claim names its transactions; memecoin execution, G8, V3 exit, Phantom-only and creator-fee capture are NOT available", () => {
  for (const f of FEATURES) if (f.evidence === "TESTNET_TX" || f.evidence === "DEVNET_BRIDGE") assert.match(f.proof, /…/, f.id);
  const na = FEATURES.filter((f) => f.evidence === "NOT_AVAILABLE").map((f) => f.id);
  for (const id of ["memecoin_execution", "g8", "exit_v3", "phantom_only", "creator_fees"]) assert.ok(na.includes(id), id);
  assert.equal(FEATURES.find((f) => f.id === "v42_dcl")!.evidence, "SANDBOX");
  assert.equal(FEATURES.find((f) => f.id === "nearly_pools")!.evidence, "LIVE_READ");
});

test("pool offers: live mode selects only an ELIGIBLE testnet pool; explore mode never executes", () => {
  const rows = [
    { key: "2951", label: "USDC/wNEAR", status: "ELIGIBLE", network: "near-testnet" },
    { key: "2131", label: "MEV/wNEAR", status: "OBSERVE_ONLY", reason: "no USDC route", network: "near-testnet" },
    { key: "nearly", label: "NEARLY", status: "ELIGIBLE", network: "near-mainnet" }, // SYNTHETIC: even if a mainnet row were ELIGIBLE
  ];
  const live = poolOffers("LIVE_TESTNET", rows);
  assert.deepEqual(live.map((o) => o.selectable), [true, false, false]);
  assert.equal(live[1]!.why, "no USDC route");
  const ex = poolOffers("EXPLORE_MEMECOINS", rows);
  assert.ok(ex.every((o) => !o.selectable && !o.executable && /execution not available yet/.test(o.why)));
});

const leg: ClassicLeg = { swapIn: 44_819_000n, expectedOut: 7_673_000_000_000_000_000_000n, minOut: 7_596_000_000_000_000_000_000n, usdcLeft: 45_181_000n, feeBps: 30, poolFeeIn: 134_457n, impactBps: 5300, level: "block", refReturn: 7_673_000_000_000_000_000_000n, otherSymbol: "wNEAR", otherDecimals: 24 };
const smallLeg: ClassicLeg = { ...leg, swapIn: 896_381n, expectedOut: 153_464_000_000_000_000_000_000n, minOut: 151_929_000_000_000_000_000_000n, usdcLeft: 903_619n, poolFeeIn: 2_689n, impactBps: 139, level: "ok", refReturn: 153_464_000_000_000_000_000_000n };

test("simulator, live testnet: 14 rows, every value from a quote / live view / rule / measurement; split on the guaranteed minimum", () => {
  // the G7 quote shape: 2 USDC in, 1.9948 out (SYNTHETIC copy of the real values)
  const now = 1_000_000;
  const r = simulateLiveContribution({ sourceUsdc: 2_000_000n, quote: { amountIn: "2000000", amountOut: "1994800", minAmountOut: "1994800", timeEstimateSec: 30, quotedAt: now }, now, classic: smallLeg, treasuryMinDeposit: 1_000_000n, creatorUsdcStorage: false });
  assert.deepEqual(r.rows.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(r.received, 1_994_800n);
  assert.match(r.rows[3]!.value, /LP 1\.79532 · creator reserve 0\.159584 · community 0\.039896/);
  assert.match(r.rows.find((x) => x.n === 12)!.value, /0\.00125 NEAR \(missing/);
  assert.deepEqual(r.blocking, []);
  assert.ok(r.rows.every((x) => x.basis !== "unavailable"));
});

test("simulator: no quote → nothing downstream is computed; stale quote and below-minimum are blocking; large impact blocks the LP", () => {
  const none = simulateLiveContribution({ sourceUsdc: 100_000_000n, quote: null, quoteError: "fetch failed", now: 0, classic: null, treasuryMinDeposit: 1_000_000n, creatorUsdcStorage: null });
  assert.equal(none.received, null);
  assert.ok(none.rows.filter((x) => [3, 6, 7, 8, 9, 13].includes(x.n)).every((x) => x.basis === "unavailable"));
  assert.ok(!none.rows.some((x) => /LP \d/.test(x.value)), "no split without a received amount");
  assert.deepEqual(none.blocking, ["no bridge quote"]);
  const q = { amountIn: "1000000", amountOut: "997400", minAmountOut: "997400", quotedAt: 0 };
  const stale = simulateLiveContribution({ sourceUsdc: 1_000_000n, quote: q, now: QUOTE_STALE_MS + 1, classic: smallLeg, treasuryMinDeposit: 1_000_000n, creatorUsdcStorage: true });
  assert.equal(stale.stale, true);
  assert.ok(stale.blocking.includes("quote older than 60 s"));
  assert.ok(stale.blocking.some((b) => /below the Treasury minimum deposit 1/.test(b)), "0.9974 < 1 USDC (the G7 lesson)");
  const big = simulateLiveContribution({ sourceUsdc: 100_000_000n, quote: { amountIn: "100000000", amountOut: "99740000", minAmountOut: "99740000", quotedAt: 0 }, now: 0, classic: leg, treasuryMinDeposit: 1_000_000n, creatorUsdcStorage: true });
  assert.ok(big.blocking.some((b) => /20 %/.test(b)));
});

test("V3 positions from REAL testnet deposits: #1 and #2 confirmed with verified shares, #3 (the bridged funds) still waiting; no exit offered", () => {
  const now = 2_000_000_000_000_000_000n;
  const ps = v3.deposits.map((d: { id: string }) => fromV3Deposit(d as never, v3.fuel[d.id], "treasury.sol2near-dev.testnet", now));
  assert.deepEqual(ps.map((p: { evidence: string }) => p.evidence), ["TESTNET_CONFIRMED", "TESTNET_CONFIRMED", "TESTNET_PENDING"]);
  assert.equal(ps[1].fuel, "FUEL Claimed (deployed FUEL, pool 2951)");
  assert.equal(ps[0].fuel, "not registered in FUEL", "deposit 1 was rejected by FUEL (window closed, G6-REJ)");
  assert.match(ps[2].deployed, /^0 — LP budget 79\.19532 USDC waiting/);
  for (const p of ps) {
    assert.equal(p.proof.type, "LP_SHARES");
    assert.match(p.withdraw, /^Not offered/);
    assert.equal(p.onchainHolder, "treasury.sol2near-dev.testnet");
    assert.equal(p.economicOwner, "lowarena9362.testnet");
  }
});

test("DCL position (sandbox views): ownership transfer, liquidity removal, fee claim and leftovers are separate; out of range earns nothing", () => {
  const c = fromDclView(dcl.position_confirmed as DclPositionView, "SANDBOX_PREVIEW", 0n, dcl.points.position_confirmed);
  assert.equal(c.kind, "DCL");
  assert.equal(c.proof.type, "DCL_POSITION");
  assert.equal(c.onchainHolder, "treasury-dcl.test.near");
  assert.match(c.withdraw, /transfers the position \(ownership\), it does NOT remove liquidity/);
  assert.match(c.feesObserved, /in range: earning/);
  const o = fromDclView(dcl.out_of_range as DclPositionView, "SANDBOX_PREVIEW", 0n, dcl.points.out_of_range);
  assert.match(o.feesObserved, /OUT OF RANGE: earning nothing/);
  const w = fromDclView(dcl.position_withdrawn as DclPositionView, "SANDBOX_PREVIEW", 0n, dcl.points.position_withdrawn);
  assert.equal(w.onchainHolder, "alice.test.near");
  assert.match(w.withdraw, /removing liquidity is a separate DCL call/);
  for (const p of [c, o, w]) assert.equal(p.fuel, "FUEL_NOT_ELIGIBLE");
});

test("V4.1 position (sandbox views) keeps the Classic share proof and FUEL_NOT_ELIGIBLE", () => {
  const p = fromV4View(v4.lp_confirmed_locked.position as V4PositionView, "treasury-v4.test.near", "SANDBOX_PREVIEW", 0n);
  assert.equal(p.proof.type, "LP_SHARES");
  assert.equal(p.fuel, "FUEL_NOT_ELIGIBLE");
  assert.equal(p.version, "V4.1");
});
