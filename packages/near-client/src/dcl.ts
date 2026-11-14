/**
 * V4.2A — Rhea DCL / Nearly: candidate registry, live classification, concentrated-liquidity math, plan builder
 * (mirror of contracts/treasury-dcl guards), position states. PURE functions: no RPC, no signing.
 *
 * Every DCL fact used here was measured on the REAL dclv2.ref-labs.near v2.4.2 wasm in a local sandbox
 * (sandbox-tests/tests/v42_dcl_explore.rs, v42_dcl.rs) or read on mainnet with public views
 * (scripts/probes/v42-dcl-audit.mjs). Nothing here makes a mainnet pool executable: SOL2NEAR runs on testnet,
 * and no testnet DCL pool holds a Tidepool token (audit 2026-11-14).
 */
import { splitV4 } from "./v4Position.ts";

export const DCL_REGISTRY_VERSION = 1;
export const DCL_FUEL_STATUS = "FUEL_NOT_ELIGIBLE" as const;
export const POINT_MIN = -800_000;
export const POINT_MAX = 800_000;

export type DclVerdict =
  | "FEASIBLE_FOR_LOCAL_DCL_TEST"
  | "OBSERVE_ONLY"
  | "BLOCKED_TAX"
  | "BLOCKED_LIQUIDITY"
  | "BLOCKED_ROUTE"
  | "BLOCKED_CONTRACT";

/** Native USDC on NEAR mainnet (Circle). Tidepool test USDC (`usdc.tidepool-sandbox.testnet`) is a different token on another network. */
export const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const MAINNET_USDC_WNEAR_DCL = `${MAINNET_USDC}|wrap.near|100`;

/** Nearly token code generations (global contract hashes) from github.com/sam3dsol/Nearlytrade, byte-checked by fetch-dcl-wasm.mjs. */
export const NEARLY_TOKEN_CODE: Record<string, { gen: string; taxed: boolean }> = {
  "5qScjXG9uRG82Yrh36XZNZgVUYiqPtuC9ep5DvV42eGQ": { gen: "raw v1", taxed: false },
  B6EjqsNJXfQXYX1KkUaypN8z7KpYcBrf9JNwTVtWUUBY: { gen: "raw v2", taxed: false },
  DFiuocosGQbx3raMt3ACEauZqLXXYzX77MJNf361385R: { gen: "raw v3", taxed: false },
  "54GH1DmZgArERRH2ed8zJBXT7UxdeumaZe8Du8dtYJrt": { gen: "raw v4", taxed: false },
  "1uGuBEpx3dFRDrr2wNzm5Vcb5sF3jWY3AKQ3Gopd6we": { gen: "tax v1", taxed: true },
  YXJL2KYynDA52JPBpAP5qDZhJqCTfB6dR5Ee4jdEgDK: { gen: "tax v2", taxed: true },
  Cct6RbLZAEs5WmKkPFr4qqTAWKKzPhE4aTJHVwNLeGBS: { gen: "tax v3", taxed: true },
  "4yLHirATwQvHfn99Vsb98mWMkvVZhjgeJ5ahx4WhC1MZ": { gen: "tax v4", taxed: true },
  HS4R2isPS7hnnY8k2QbxnLHUx9Z9v9mNZnLsrGqwhChh: { gen: "tax v5", taxed: true },
  "8GXVnFTxx1d6tYnoqNiQ5YzzQpj1uyxG7u28LeCGmsER": { gen: "tax v6", taxed: true },
};

/** A real Nearly DCL pool examined in V4.2A. Mainnet, observe only by construction. */
export interface DclCandidate {
  key: string;
  network: "near-mainnet";
  dex: string;
  poolId: string;
  tokenX: string;
  tokenY: string;
  symbol: string;
  xDecimals: number;
  yDecimals: number;
  fee: number;
  pointDelta: number;
  /** Global contract hash the token account runs (view_account), mapped through NEARLY_TOKEN_CODE. */
  tokenCodeHash: string;
  launchId: number;
  launchCreator: string;
  /** The Nearly locker that owns the launch position (cannot remove it, only claim its fees). */
  locker: string;
  lockerLptId: string;
  lockerRange: [number, number];
  /** USDC → wNEAR leg; the memecoin is reached through [usdcPool, poolId]. */
  usdcPool: string;
  verifiedAt: string;
}

export const NEARLY_DCL_CANDIDATES: DclCandidate[] = [
  {
    key: "dcl:nearly", network: "near-mainnet", dex: "dclv2.ref-labs.near", poolId: "nearly-993927.nearlytrade.near|wrap.near|10000",
    tokenX: "nearly-993927.nearlytrade.near", tokenY: "wrap.near", symbol: "NEARLY", xDecimals: 18, yDecimals: 24, fee: 10000, pointDelta: 200,
    tokenCodeHash: "5qScjXG9uRG82Yrh36XZNZgVUYiqPtuC9ep5DvV42eGQ", launchId: 3, launchCreator: "nearlytrade.near",
    locker: "lock.nearlytrade.near", lockerLptId: "nearly-993927.nearlytrade.near|wrap.near|10000#13969", lockerRange: [200, 500000],
    usdcPool: MAINNET_USDC_WNEAR_DCL, verifiedAt: "2026-11-14",
  },
  {
    key: "dcl:nearkat", network: "near-mainnet", dex: "dclv2.ref-labs.near", poolId: "nearkat-630f25.nearlytrade.near|wrap.near|10000",
    tokenX: "nearkat-630f25.nearlytrade.near", tokenY: "wrap.near", symbol: "NEARKAT", xDecimals: 18, yDecimals: 24, fee: 10000, pointDelta: 200,
    tokenCodeHash: "5qScjXG9uRG82Yrh36XZNZgVUYiqPtuC9ep5DvV42eGQ", launchId: 14, launchCreator: "8d4736b0fa6c66969e5498fa4337261d45cd4461f841c03891a9533d958c7e40",
    locker: "lock.nearlytrade.near", lockerLptId: "nearkat-630f25.nearlytrade.near|wrap.near|10000#14010", lockerRange: [200, 500000],
    usdcPool: MAINNET_USDC_WNEAR_DCL, verifiedAt: "2026-11-14",
  },
  {
    key: "dcl:dragon", network: "near-mainnet", dex: "dclv2.ref-labs.near", poolId: "dragon-3.nearlytrade.near|wrap.near|10000",
    tokenX: "dragon-3.nearlytrade.near", tokenY: "wrap.near", symbol: "DRAGON", xDecimals: 18, yDecimals: 24, fee: 10000, pointDelta: 200,
    tokenCodeHash: "YXJL2KYynDA52JPBpAP5qDZhJqCTfB6dR5Ee4jdEgDK", launchId: 1502, launchCreator: "littlefrog7181.near",
    locker: "lock2.nearlytrade.near", lockerLptId: "dragon-3.nearlytrade.near|wrap.near|10000#16181", lockerRange: [200, 500000],
    usdcPool: MAINNET_USDC_WNEAR_DCL, verifiedAt: "2026-11-14",
  },
];

/** DCL `get_pool` (fields used). */
export interface RawDclPoolFull {
  pool_id: string;
  token_x: string;
  token_y: string;
  fee: number;
  point_delta: number;
  current_point: number;
  liquidity: string;
  liquidity_x?: string;
  total_liquidity?: string;
  total_x: string;
  total_y: string;
  total_fee_x_charged?: string;
  total_fee_y_charged?: string;
  state: string;
  tax: unknown;
}

/** Live reads used to classify a candidate. `tax` = the token's `get_tax` view (absent on raw tokens). */
export interface DclLive {
  pool: RawDclPoolFull;
  tokenGlobalHash: string | null;
  tax: { kind: "ABSENT" } | { kind: "READ"; buy_bps: number; sell_bps: number } | { kind: "UNREADABLE"; error: string };
  /** DCL quotes USDC → memecoin along [usdcPool, poolId]: reference size and 1/1000 of it (impact). */
  quoteRef: bigint | null;
  quoteSmall: bigint | null;
  refUsdc: bigint;
  dexState: string;
}

export interface DclCheck { id: "network" | "contract" | "tax" | "liquidity" | "route" | "ownership"; ok: boolean; detail: string }
export interface DclAssessment { verdict: DclVerdict; executable: false; checks: DclCheck[]; reasons: string[]; impactBps: number | null }

export const DCL_LIMITS = { maxImpactBpsAtRef: 300, refUsdc: 100_000_000n } as const;

export function impactBps(quoteBig: bigint, quoteSmall: bigint): number {
  const ideal = quoteSmall * 1000n;
  if (ideal === 0n) return 10_000;
  return quoteBig >= ideal ? 0 : Number(((ideal - quoteBig) * 10_000n) / ideal);
}

/**
 * Verdict for the LOCAL test question "can TreasuryDCL hold an additional position in a pool like this one?".
 * It never makes a pool executable (`executable` is the literal false): every candidate is on mainnet.
 */
export function assessDcl(c: DclCandidate, live: DclLive | Error): DclAssessment {
  const checks: DclCheck[] = [];
  checks.push({ id: "network", ok: false, detail: "mainnet pool: SOL2NEAR funds are testnet (Tidepool USDC), never routed to mainnet" });
  if (live instanceof Error) {
    checks.push({ id: "contract", ok: false, detail: `unreadable now (${live.message}): nothing is concluded from a failed read` });
    return finish(checks, "OBSERVE_ONLY", null);
  }
  const p = live.pool;
  const identity = p.pool_id === c.poolId && p.token_x === c.tokenX && p.token_y === c.tokenY && p.fee === c.fee && p.point_delta === c.pointDelta;
  const contractOk = identity && p.state === "Running" && live.dexState === "Running" && (p.tax === null || p.tax === undefined);
  checks.push({
    id: "contract", ok: contractOk,
    detail: !identity ? "pool identity differs from the registry" : p.state !== "Running" || live.dexState !== "Running" ? `state ${p.state} / DCL ${live.dexState}`
      : p.tax != null ? "DCL pool-level tax set" : `Running, fee tier ${p.fee / 10_000} %, point_delta ${p.point_delta}, no pool tax`,
  });
  const code = live.tokenGlobalHash ? NEARLY_TOKEN_CODE[live.tokenGlobalHash] : undefined;
  let taxOk = false;
  let taxDetail: string;
  if (!code) taxDetail = `token code ${live.tokenGlobalHash ?? "not a global contract"} is not a known Nearly generation: tax behaviour unknown`;
  else if (live.tokenGlobalHash !== c.tokenCodeHash) taxDetail = `token code changed (${code.gen}, registry says ${NEARLY_TOKEN_CODE[c.tokenCodeHash]?.gen})`;
  else if (live.tax.kind === "UNREADABLE") taxDetail = `get_tax unreadable: ${live.tax.error}`;
  else if (live.tax.kind === "READ" && (live.tax.buy_bps > 0 || live.tax.sell_bps > 0))
    taxDetail = `${code.gen}: buy ${live.tax.buy_bps} / sell ${live.tax.sell_bps} bps on every DCL transfer (deposit, withdraw, fee collection)`;
  else if (code.taxed && live.tax.kind !== "READ") taxDetail = `${code.gen} code but get_tax not readable`;
  else { taxOk = true; taxDetail = `${code.gen}: ${live.tax.kind === "ABSENT" ? "no get_tax method (raw token, no transfer tax in its source)" : "tax 0 / 0"}`; }
  checks.push({ id: "tax", ok: taxOk, detail: taxDetail });
  const routeOk = live.quoteRef !== null && live.quoteRef > 0n && live.quoteSmall !== null && live.quoteSmall > 0n;
  checks.push({ id: "route", ok: routeOk, detail: routeOk ? `USDC → wNEAR (${c.usdcPool.split("|").slice(1).join(" fee ")}) → ${c.symbol} quoted by the DCL` : "no DCL quote from mainnet USDC" });
  const imp = routeOk ? impactBps(live.quoteRef!, live.quoteSmall!) : null;
  const liqOk = imp !== null && imp <= DCL_LIMITS.maxImpactBpsAtRef && BigInt(p.liquidity) > 0n;
  checks.push({ id: "liquidity", ok: liqOk, detail: imp === null ? "no quote" : `price impact of a ${Number(live.refUsdc) / 1e6} USDC acquisition: ${(imp / 100).toFixed(2)} % (limit ${DCL_LIMITS.maxImpactBpsAtRef / 100} %)` });
  checks.push({ id: "ownership", ok: true, detail: `launch position ${c.lockerLptId.split("#")[1]} is owned by ${c.locker} (Nearly); an additional position gets its own NEP-171 id and owner` });
  const verdict: DclVerdict = !contractOk ? "BLOCKED_CONTRACT" : !taxOk ? "BLOCKED_TAX" : !routeOk ? "BLOCKED_ROUTE" : !liqOk ? "BLOCKED_LIQUIDITY" : "FEASIBLE_FOR_LOCAL_DCL_TEST";
  return finish(checks, verdict, imp);
}
function finish(checks: DclCheck[], verdict: DclVerdict, imp: number | null): DclAssessment {
  return { verdict, executable: false, checks, reasons: checks.filter((k) => !k.ok).map((k) => `${k.id}: ${k.detail}`), impactBps: imp };
}

// ---------------- concentrated-liquidity math ----------------

/** Human price of X in Y at a DCL point: 1.0001^point, scaled by decimals. */
export function pointToPrice(point: number, xDecimals: number, yDecimals: number): number {
  return Math.pow(1.0001, point) * Math.pow(10, xDecimals - yDecimals);
}
export function priceToPoint(price: number, xDecimals: number, yDecimals: number): number {
  return Math.round(Math.log(price / Math.pow(10, xDecimals - yDecimals)) / Math.log(1.0001));
}
/** A range strictly containing `current`, on the point_delta grid, ±halfWidth points (≈ ×/÷ 1.0001^halfWidth). */
export function rangeAround(current: number, halfWidth: number, pointDelta: number): [number, number] {
  let l = Math.floor((current - halfWidth) / pointDelta) * pointDelta;
  let r = Math.floor((current + halfWidth) / pointDelta) * pointDelta + pointDelta;
  if (l >= current) l -= pointDelta;
  if (r <= current) r += pointDelta;
  return [Math.max(l, POINT_MIN), Math.min(r, POINT_MAX)];
}

export interface RangeStatus { inRange: boolean; holds: "X" | "Y" | "X+Y"; earnsFees: boolean; explain: string }
/** Measured on the real DCL (sandbox K3/K5): above the range the position is all Y and earns nothing; below, all X. */
export function rangeStatus(current: number, left: number, right: number, symX = "X", symY = "Y"): RangeStatus {
  if (current >= right)
    return { inRange: false, holds: "Y", earnsFees: false, explain: `price above the range: the position is entirely ${symY} (it sold its ${symX} as the price rose) and earns no fee until the price comes back below ${right}` };
  if (current < left)
    return { inRange: false, holds: "X", earnsFees: false, explain: `price below the range: the position is entirely ${symX} (it bought ${symX} as the price fell) and earns no fee until the price comes back above ${left}` };
  return { inRange: true, holds: "X+Y", earnsFees: true, explain: "price inside the range: the position holds both assets and earns its share of the fees on swaps that cross its points" };
}

// ---------------- plan (mirror of contracts/treasury-dcl plan.rs) ----------------

export interface DclGuards { maxSlippageBps: number; maxPriceImpactBps: number; maxPlanTtlNs: bigint; minRangeWidth: number; maxRangeWidth: number }
export interface DclPlanArgs {
  usdc_to_x: string; usdc_to_y: string; min_x_out: string; min_y_out: string; left_point: number; right_point: number;
  amount_x: string; amount_y: string; min_amount_x: string; min_amount_y: string; deadline_ns: string;
}
const bps = (v: bigint, b: number) => (v / 10_000n) * BigInt(b) + ((v % 10_000n) * BigInt(b)) / 10_000n;

/** Same rules and error codes as `check_plan` in contracts/treasury-dcl/src/plan.rs (for the review screen only: the contract decides). */
export function checkDclPlan(p: DclPlanArgs, budget: bigint, nowNs: bigint, g: DclGuards, pointDelta: number): string | null {
  const [tx, ty, mx, my, ax, ay, nx, ny] = [p.usdc_to_x, p.usdc_to_y, p.min_x_out, p.min_y_out, p.amount_x, p.amount_y, p.min_amount_x, p.min_amount_y].map(BigInt);
  if (tx === 0n || ty === 0n) return "ERR_PLAN_SWAP_ZERO";
  if (tx + ty > budget) return "ERR_PLAN_OVER_BUDGET";
  if (mx === 0n || my === 0n) return "ERR_PLAN_NO_SLIPPAGE_GUARD";
  if (p.left_point >= p.right_point) return "ERR_RANGE_ORDER";
  if (p.left_point < POINT_MIN || p.right_point > POINT_MAX) return "ERR_RANGE_BOUNDS";
  if (p.left_point % pointDelta !== 0 || p.right_point % pointDelta !== 0) return "ERR_RANGE_NOT_ON_POINT_DELTA";
  const w = p.right_point - p.left_point;
  if (w < g.minRangeWidth || w > g.maxRangeWidth) return "ERR_RANGE_WIDTH";
  if (ax === 0n || ay === 0n) return "ERR_PLAN_AMOUNT_ZERO";
  if (ax > mx || ay > my) return "ERR_PLAN_AMOUNT_ABOVE_MIN_OUT";
  const floor = 10_000 - 2 * g.maxSlippageBps;
  if (nx < bps(ax, floor) || ny < bps(ay, floor)) return "ERR_PLAN_MIN_AMOUNTS_TOO_LOOSE";
  if (nx > ax || ny > ay) return "ERR_PLAN_MIN_AMOUNTS_ABOVE_AMOUNTS";
  const d = BigInt(p.deadline_ns);
  if (d <= nowNs) return "ERR_PLAN_EXPIRED";
  if (d > nowNs + g.maxPlanTtlNs) return "ERR_PLAN_DEADLINE_TOO_FAR";
  return null;
}

/** DCL `predict_hotzap` as measured: `[[{need_x, need_y, liquidity_amount}], {token: left}]` → out = left + need. */
export interface HotzapPrediction { outX: bigint; outY: bigint; needX: bigint; needY: bigint; liquidity: bigint }
export function parsePredictHotzap(v: unknown, tokenX: string, tokenY: string): HotzapPrediction | null {
  try {
    const a = v as [[{ need_x: string; need_y: string; liquidity_amount: string }], Record<string, string>];
    const n = a[0][0];
    const left = (t: string) => BigInt(a[1][t] ?? "0");
    return { outX: left(tokenX) + BigInt(n.need_x), outY: left(tokenY) + BigInt(n.need_y), needX: BigInt(n.need_x), needY: BigInt(n.need_y), liquidity: BigInt(n.liquidity_amount) };
  } catch {
    return null;
  }
}

/**
 * The plan the dashboard prepares, with the SAME algorithm as the sandbox run (sandbox-tests/tests/v42_dcl.rs):
 * bisection on the USDC share of the X leg until both sides use the same fraction of their simulated swap output
 * (the X leg buys through the target pool and moves its price), then min_out = output − half the slippage budget.
 * `predict(toX, toY, capX, capY)` must call DCL `predict_hotzap`; `quote(toX, toY)` the two legs' own quotes.
 */
export async function buildDclPlan(o: {
  spend: bigint; left: number; right: number; slippageBps: number; deadlineNs: bigint;
  quote: (toX: bigint, toY: bigint) => Promise<[bigint, bigint]>;
  predict: (toX: bigint, toY: bigint, capX: bigint, capY: bigint) => Promise<HotzapPrediction>;
}): Promise<{ plan: DclPlanArgs; prediction: HotzapPrediction; shareX: number; iterations: number }> {
  let lo = 0.02, hi = 0.98, f = 0.5, it = 0;
  let last: HotzapPrediction | null = null;
  for (; it < 16; it++) {
    f = (lo + hi) / 2;
    const toX = BigInt(Math.floor(Number(o.spend) * f));
    const toY = o.spend - toX;
    const [qx, qy] = await o.quote(toX, toY);
    const first = await o.predict(toX, toY, qx / 2n, qy / 2n);
    // caps 5 bps under the first simulation's outputs: on a live chain the second view can run one block later,
    // with slightly lower outputs, and caps above the outputs make the DCL answer "E101: insufficient balance"
    // (seen on mainnet NEARLY in the V4.3A e2e run)
    last = await o.predict(toX, toY, (first.outX * 9_995n) / 10_000n, (first.outY * 9_995n) / 10_000n);
    const ux = Number(last.needX) / Number(last.outX), uy = Number(last.needY) / Number(last.outY);
    if (Math.abs(ux - uy) < 0.0002) break;
    if (ux > uy) lo = f; else hi = f;
  }
  const toX = BigInt(Math.floor(Number(o.spend) * f));
  const minX = (last!.outX * BigInt(10_000 - o.slippageBps / 2)) / 10_000n;
  const minY = (last!.outY * BigInt(10_000 - o.slippageBps / 2)) / 10_000n;
  const floor = BigInt(10_000 - 2 * o.slippageBps);
  return {
    plan: {
      usdc_to_x: String(toX), usdc_to_y: String(o.spend - toX), min_x_out: String(minX), min_y_out: String(minY),
      left_point: o.left, right_point: o.right, amount_x: String(minX), amount_y: String(minY),
      min_amount_x: String((minX * floor) / 10_000n + 1n), min_amount_y: String((minY * floor) / 10_000n + 1n), deadline_ns: String(o.deadlineNs),
    },
    prediction: last!, shareX: f, iterations: it + 1,
  };
}

/** Estimator (review screen): 90/8/2 on the USDC amount, then what a plan would put in the position and leave over. */
export interface DclEstimate {
  usdcIn: bigint; lpBudget: bigint; reserve: bigint; community: bigint;
  spend: bigint; unusedToReserve: bigint;
  intoPositionX: bigint; intoPositionY: bigint; leftoverX: bigint; leftoverY: bigint;
  leftoverShareBps: number;
}
export function estimateDcl(usdcIn: bigint, spend: bigint, pr: HotzapPrediction): DclEstimate {
  const s = splitV4(usdcIn);
  const lx = pr.outX - pr.needX, ly = pr.outY - pr.needY;
  const share = pr.outX + pr.outY === 0n ? 0 : Number(((lx * 10_000n) / (pr.outX || 1n) + (ly * 10_000n) / (pr.outY || 1n)) / 2n);
  return { usdcIn, lpBudget: s.lp, reserve: s.reserve, community: s.community, spend, unusedToReserve: s.lp - spend, intoPositionX: pr.needX, intoPositionY: pr.needY, leftoverX: lx, leftoverY: ly, leftoverShareBps: share };
}

// ---------------- TreasuryDCL position states (from its views) ----------------

export type DclContractStatus =
  | "BudgetAllocated" | "PreflightPending" | { ZapPending: { sent: string } } | { LookupPending: { used: string } } | { ConfirmPending: { used: string } }
  | "PositionConfirmed" | "FeeClaimPending" | "TransferPending" | "PositionWithdrawn" | "Aborted";
export interface DclDepositView {
  id: string; creator: string; amount: string; lp_budget: string; reserve: string; community: string; status: DclContractStatus;
  dex: string; pool_id: string; token_x: string; token_y: string; usdc_used: string; usdc_unused_to_reserve: string;
  lpt_id: string | null; left_point: number | null; right_point: number | null; liquidity: string; position_x: string; position_y: string;
  dex_x: string; dex_y: string; dex_usdc: string; fees_claimed_x: string; fees_claimed_y: string; recovered_x: string; recovered_y: string; recovered_usdc: string;
  unlock_at: string | null; last_error: string | null; marks: { stage: string; block: string; at: string }[];
}
export interface DclPositionView { deposit: DclDepositView; locked: boolean; withdrawable: boolean; fees_claimable: boolean; fuel_status: string; fuel_reason: string; treasury_id: string }

export type DclUiState =
  | "DEPOSIT_CONFIRMED" | "PREFLIGHT_PENDING" | "ZAP_PENDING" | "POSITION_PENDING" | "POSITION_LOCKED" | "POSITION_WITHDRAWABLE"
  | "FEE_CLAIM_PENDING" | "TRANSFER_PENDING" | "WITHDRAWN" | "ABORTED" | "RECOVERY_REQUIRED";

export function dclStatusName(s: DclContractStatus): string {
  return typeof s === "string" ? s : Object.keys(s)[0]!;
}
/** UI state from TreasuryDCL views only (+ chain time). A failed step shows RECOVERY_REQUIRED with the contract's own error. */
export function dclPositionState(v: DclPositionView, nowNs: bigint): { state: DclUiState; detail: string } {
  const d = v.deposit;
  const n = dclStatusName(d.status);
  if (d.last_error && n === "BudgetAllocated") return { state: "RECOVERY_REQUIRED", detail: `last attempt refused: ${d.last_error}. The LP budget is still in the Treasury: re-plan, or abort` };
  if (d.last_error && /reconcile/.test(d.last_error)) return { state: "RECOVERY_REQUIRED", detail: `${d.last_error} (anyone may call reconcile 10 min after the last progress)` };
  switch (n) {
    case "BudgetAllocated": return { state: "DEPOSIT_CONFIRMED", detail: "90/8/2 split done; LP budget waiting for a plan" };
    case "PreflightPending": return { state: "PREFLIGHT_PENDING", detail: "DCL get_pool + predict_hotzap + quotes being checked" };
    case "ZapPending": return { state: "ZAP_PENDING", detail: "USDC HotZap sent to the DCL" };
    case "LookupPending": case "ConfirmPending": return { state: "POSITION_PENDING", detail: "looking up the new position on the DCL" };
    case "PositionConfirmed": {
      const unlock = d.unlock_at ? BigInt(d.unlock_at) : null;
      return unlock !== null && nowNs < unlock
        ? { state: "POSITION_LOCKED", detail: `locked until ${new Date(Number(unlock / 1_000_000n)).toISOString()}` }
        : { state: "POSITION_WITHDRAWABLE", detail: "lock over: the creator may take the position NFT" };
    }
    case "FeeClaimPending": return { state: "FEE_CLAIM_PENDING", detail: "remove_liquidity(0) in flight" };
    case "TransferPending": return { state: "TRANSFER_PENDING", detail: "nft_transfer to the creator in flight" };
    case "PositionWithdrawn": return { state: "WITHDRAWN", detail: "the position NFT belongs to the creator" };
    default: return { state: "ABORTED", detail: "aborted before any position" };
  }
}

/** USDC side of a deposit must reconcile: used by the DCL + returned to the reserve = LP budget (contract invariant). */
export function dclUsdcReconciles(d: DclDepositView): boolean {
  const n = dclStatusName(d.status);
  if (n === "BudgetAllocated" || n === "PreflightPending" || n === "ZapPending") return true;
  return BigInt(d.usdc_used) + BigInt(d.usdc_unused_to_reserve) === BigInt(d.lp_budget);
}

/** What a FUEL version would need before any DCL position could be rewarded (V4.2A: none of it exists). */
export const DCL_FUEL_REQUIREMENTS = [
  "read the position from TreasuryDCL get_position AND DCL get_liquidity: owner = TreasuryDCL, same lpt_id, pool allowlisted",
  "measure liquidity actually deployed (DCL liquidity units at confirmation and now), not the quote or the USDC budget",
  "measure holding time from position_confirmed to now, and stop counting at position_withdrawn",
  "one reward key per lpt_id and per funding deposit, so re-registering or splitting a position cannot double count",
  "refuse closed or transferred positions (get_liquidity null or owner ≠ TreasuryDCL)",
  "track capital already rewarded per creator across withdraw → re-deposit, so recycling the same USDC cannot multiply FUEL",
] as const;
