/**
 * V4.3A Creator Portal — pure model shared by the guided UI, its tests and the release docs:
 * - what is really available, with the kind of evidence behind it (never mixed);
 * - which pools each mode may offer;
 * - the contribution simulator (bridge quote → NEAR → 90/8/2 → pool leg), every row tagged with its basis;
 * - one common position shape for V3 Classic (live testnet), V4.1 Classic and V4.2A DCL, each keeping its own proof.
 * No RPC, no signing here.
 */
import { DCL_FUEL_STATUS, dclPositionState, dclStatusName, rangeStatus, type DclPositionView } from "./dcl.ts";
import { splitV4, positionState, statusName, type V4PositionView } from "./v4Position.ts";

// ---------------- evidence ----------------

/** The only labels the UI may use for where a fact comes from. */
export type Evidence =
  | "TESTNET_TX" // executed on NEAR testnet, tx hash re-verified (scripts/probes/verify-g6-g7.mjs, verify-testnet.mjs)
  | "DEVNET_BRIDGE" // Solana devnet → Tidepool → NEAR testnet, executed once (G7)
  | "LIVE_READ" // public view calls right now (testnet or mainnet), no transaction
  | "SANDBOX" // local neard sandbox with real contract code, local state
  | "SIMULATION" // computed from live views / quotes, nothing executed
  | "NOT_AVAILABLE";

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  TESTNET_TX: "Executed on NEAR testnet",
  DEVNET_BRIDGE: "Bridged once: Solana devnet → NEAR testnet",
  LIVE_READ: "Live read (no transaction)",
  SANDBOX: "Local sandbox only (real code, local state)",
  SIMULATION: "Simulation (nothing executed)",
  NOT_AVAILABLE: "Not available",
};

export interface Feature { id: string; label: string; evidence: Evidence; proof: string }

/** Feature status as it really is (2026-11-14). Every TESTNET_TX / DEVNET_BRIDGE row names re-verifiable transactions. */
export const FEATURES: Feature[] = [
  { id: "bridge", label: "Bridge USDC Solana devnet → NEAR testnet (Phantom + Tidepool community sandbox)", evidence: "DEVNET_BRIDGE", proof: "G7: Solana bGUicpgy…887R → NEAR J58H2uyu…RFqf (1.9948 USDC)" },
  { id: "deposit", label: "Deposit USDC into the Treasury, 90/8/2 split on-chain (NEAR wallet)", evidence: "TESTNET_TX", proof: "C1 AsD2o2aV…ZWzw, G6-D FaBKjLRU…haHV, G7-TREAS J7uMjikj…Bdhz" },
  { id: "lp_classic_2951", label: "LP into Ref Classic pool 2951 (USDC/wNEAR — not a memecoin), shares held by the Treasury", evidence: "TESTNET_TX", proof: "C2 4F2wXqzm…SSHA, G6-LP CniqxoxZ…bRdN, G6-LP2 CundGCKW…pHyD" },
  { id: "fuel", label: "FUEL: Proof-of-Liquidity admission, season close, single claim (pool 2951 only)", evidence: "TESTNET_TX", proof: "C4 CoAgrgQE…Lk6o, C6 6g13fiwv…hXxu (C7 second claim rejected), G6-CLAIM 8CRvXVJg…A7F8" },
  { id: "g8", label: "One operation reconciled end to end (Solana → Treasury → LP → FUEL)", evidence: "NOT_AVAILABLE", proof: "G8 not done: deposit #3 (bridged) has no LP, its 29 % price impact is refused by the guard" },
  { id: "exit_v3", label: "Withdraw LP from the deployed V3 Treasury", evidence: "NOT_AVAILABLE", proof: "withdraw_lp exists in code, never exercised on-chain: not offered" },
  { id: "pool_explorer", label: "Pool Explorer: verified pools, live checks, selection guard", evidence: "LIVE_READ", proof: "V4.0 registry, testnet + mainnet views" },
  { id: "v41_classic_pilot", label: "TreasuryV4 Classic memecoin pilot (S2NMEME sandbox token): LP, lock, exit, recovery", evidence: "SANDBOX", proof: "docs/v4/sandbox-run.log against the real Ref + Tidepool USDC wasm; NOT deployed" },
  { id: "v42_dcl", label: "TreasuryDCL: concentrated-liquidity position for a Nearly-type memecoin, fees, NFT exit", evidence: "SANDBOX", proof: "docs/v4/v42-dcl-sandbox-run.log against the real Rhea DCL v2.4.2 + Nearly token wasm; NOT deployed" },
  { id: "nearly_pools", label: "Real Nearly memecoin pools (NEARLY, NEARKAT, DRAGON): classification and reference simulation", evidence: "LIVE_READ", proof: "mainnet view calls only; nothing executable" },
  { id: "memecoin_execution", label: "Fund a real NEAR memecoin pool", evidence: "NOT_AVAILABLE", proof: "no testnet memecoin pool reachable from Tidepool USDC; Nearly pools are mainnet" },
  { id: "creator_fees", label: "Automatic capture of Pump.fun / Bags creator fees", evidence: "NOT_AVAILABLE", proof: "not built: the creator sends USDC they control, by hand" },
  { id: "phantom_only", label: "One wallet (Phantom only) for the whole journey", evidence: "NOT_AVAILABLE", proof: "the NEAR side needs a NEAR wallet signature; a Phantom-only flow needs a new custody / delegation design" },
];

// ---------------- modes and pool choice ----------------

export type PortalMode = "LIVE_TESTNET" | "EXPLORE_MEMECOINS";

export interface PoolOffer { key: string; label: string; selectable: boolean; executable: boolean; why: string }

/**
 * LIVE_TESTNET: only pools assessed ELIGIBLE from live data (today: Ref #2951, the deployed Treasury's pool) are selectable,
 * and they are executable through the deployed contracts. EXPLORE_MEMECOINS: nothing is ever executable.
 */
export function poolOffers(mode: PortalMode, rows: { key: string; label: string; status: string; reason?: string; network: string }[]): PoolOffer[] {
  return rows.map((r) => {
    if (mode === "EXPLORE_MEMECOINS")
      return { key: r.key, label: r.label, selectable: false, executable: false, why: "Explore mode: read-only, execution not available yet" };
    const ok = r.status === "ELIGIBLE" && r.network === "near-testnet";
    return { key: r.key, label: r.label, selectable: ok, executable: ok, why: ok ? "deployed Treasury pool, all live checks pass" : r.reason ?? "not compatible" };
  });
}

// ---------------- contribution simulator ----------------

export type Basis = "quote" | "live view" | "contract rule" | "measured" | "user input" | "unavailable";
export interface SimRow { n: number; label: string; value: string; basis: Basis; warn?: boolean }

export interface BridgeQuoteLike { amountIn: string; amountOut: string; minAmountOut: string; timeEstimateSec?: number; quotedAt: number }
export interface ClassicLeg { swapIn: bigint; expectedOut: bigint; minOut: bigint; usdcLeft: bigint; feeBps: number; poolFeeIn: bigint; impactBps: number; level: string; refReturn: bigint; otherSymbol: string; otherDecimals: number }

const fmt = (v: bigint, dec: number, dp = 6) => {
  const s = v.toString().padStart(dec + 1, "0");
  const i = s.slice(0, s.length - dec), f = s.slice(s.length - dec).slice(0, dp).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
};
export const QUOTE_STALE_MS = 60_000;

/**
 * Live testnet contribution (Classic pool 2951): the 14 rows of the checkpoint. Values only come from the bridge quote,
 * live pool views, contract rules or measured transactions; a missing input makes its rows "unavailable", never guessed.
 */
export function simulateLiveContribution(o: {
  sourceUsdc: bigint;
  quote: BridgeQuoteLike | null;
  quoteError?: string;
  now: number;
  classic: ClassicLeg | null;
  treasuryMinDeposit: bigint | null;
  creatorUsdcStorage: boolean | null;
}): { rows: SimRow[]; received: bigint | null; stale: boolean; blocking: string[] } {
  const rows: SimRow[] = [];
  const blocking: string[] = [];
  const q = o.quote;
  const stale = !!q && o.now - q.quotedAt > QUOTE_STALE_MS;
  rows.push({ n: 1, label: "Source amount (Solana devnet, Phantom)", value: `${fmt(o.sourceUsdc, 6)} USDC`, basis: "user input" });
  if (q) {
    rows.push({ n: 2, label: "Bridge quote (Tidepool, dry)", value: `${fmt(BigInt(q.amountIn), 6)} → ${fmt(BigInt(q.amountOut), 6)} USDC, cost ${fmt(BigInt(q.amountIn) - BigInt(q.amountOut), 6)} USDC${q.timeEstimateSec ? `, ~${q.timeEstimateSec} s` : ""}${stale ? " — STALE, refresh before signing" : ""}`, basis: "quote", warn: stale });
    rows.push({ n: 3, label: "Received on NEAR testnet (guaranteed minimum)", value: `${fmt(BigInt(q.minAmountOut), 6)} USDC`, basis: "quote" });
  } else {
    rows.push({ n: 2, label: "Bridge quote (Tidepool, dry)", value: `unavailable${o.quoteError ? ` (${o.quoteError})` : ""}`, basis: "unavailable", warn: true });
    rows.push({ n: 3, label: "Received on NEAR testnet", value: "unknown without a quote: nothing below is computed", basis: "unavailable", warn: true });
    blocking.push("no bridge quote");
  }
  const received = q ? BigInt(q.minAmountOut) : null;
  if (stale) blocking.push("quote older than 60 s");
  if (received !== null && o.treasuryMinDeposit !== null && received < o.treasuryMinDeposit)
    blocking.push(`guaranteed minimum ${fmt(received, 6)} USDC is below the Treasury minimum deposit ${fmt(o.treasuryMinDeposit, 6)}`);
  if (received !== null) {
    const s = splitV4(received);
    rows.push({ n: 4, label: "Split 90/8/2 (on-chain rule)", value: `LP ${fmt(s.lp, 6)} · creator reserve ${fmt(s.reserve, 6)} · community ${fmt(s.community, 6)} USDC`, basis: "contract rule" });
    rows.push({ n: 5, label: "LP budget", value: `${fmt(s.lp, 6)} USDC`, basis: "contract rule" });
  }
  const c = o.classic;
  if (c && received !== null) {
    rows.push({ n: 6, label: "Conversion route", value: `inside Ref Classic pool 2951: USDC → ${c.otherSymbol}, then add both sides (one pool, no extra hop)`, basis: "live view" });
    rows.push({ n: 7, label: "Tokens estimated", value: `swap ${fmt(c.swapIn, 6)} USDC → ${fmt(c.expectedOut, c.otherDecimals)} ${c.otherSymbol} (Ref get_return ${c.refReturn === c.expectedOut ? "= plan" : "differs"}); LP gets ${fmt(c.usdcLeft, 6)} USDC + ${fmt(c.expectedOut, c.otherDecimals)} ${c.otherSymbol}`, basis: "live view" });
    rows.push({ n: 8, label: "DEX fee", value: `${c.feeBps} bps of the swapped part ≈ ${fmt(c.poolFeeIn, 6)} USDC`, basis: "live view" });
    rows.push({ n: 9, label: "Slippage guard", value: `min ${fmt(c.minOut, c.otherDecimals)} ${c.otherSymbol}; price impact ${(c.impactBps / 100).toFixed(2)} % (${c.level})`, basis: "live view", warn: c.level !== "ok" });
    if (c.level === "block") blocking.push("price impact ≥ 20 %: the LP would not be offered");
  } else {
    for (const [n, label] of [[6, "Conversion route"], [7, "Tokens estimated"], [8, "DEX fee"], [9, "Slippage guard"]] as const)
      rows.push({ n, label, value: "unavailable (needs the quote and a live pool read)", basis: "unavailable" });
  }
  rows.push({ n: 10, label: "Known token taxes", value: "none observed on Tidepool USDC / wNEAR (G2–G7 transfers); not a source audit", basis: "measured" });
  rows.push({ n: 11, label: "LP position", value: "Ref Classic shares, held by treasury.sol2near-dev.testnet for you, locked 600 s; shares are read from Ref after the LP (not estimated here)", basis: "contract rule" });
  rows.push({ n: 12, label: "Gas and storage", value: `Solana fee in SOL (shown by Phantom) · NEAR: ${o.creatorUsdcStorage === false ? "USDC storage registration 0.00125 NEAR (missing on your account) · " : o.creatorUsdcStorage ? "USDC storage already registered · " : ""}deposit 1 yocto + gas · execute_lp burnt 37 Tgas ≈ 0.0034 NEAR (G6-LP2)`, basis: "measured" });
  rows.push({ n: 13, label: "Capital possibly unused", value: c ? "8 % creator reserve and 2 % community stay in the Treasury; LP dust from Ref rounding returns as dust (a few atomic units in G6)" : "unavailable", basis: c ? "measured" : "unavailable" });
  rows.push({ n: 14, label: "Pool risks", value: "USDC/wNEAR test pool, shallow (≈ 80 USDC): large amounts move the price; no yield is promised; the V3 exit is not offered yet", basis: "live view", warn: true });
  return { rows, received, stale, blocking };
}

// ---------------- unified positions ----------------

export type PositionEvidence = "TESTNET_CONFIRMED" | "TESTNET_PENDING" | "SANDBOX_PREVIEW" | "NOT_DEPLOYED";
export interface UnifiedPosition {
  key: string;
  kind: "CLASSIC" | "DCL";
  evidence: PositionEvidence;
  version: "V3" | "V4.1" | "V4.2A";
  creator: string;
  pool: string;
  contracts: string[];
  netArrived: string;
  deployed: string;
  residual: string;
  proof: { type: "LP_SHARES"; shares: string; verified: boolean } | { type: "DCL_POSITION"; lptId: string | null; range: [number, number] | null; liquidity: string; standard: "NEP-171 (nft_token / nft_transfer, measured)" };
  onchainHolder: string;
  holderCheck: string;
  economicOwner: string;
  lock: string;
  withdraw: string;
  feesObserved: string;
  feesClaimable: string;
  fuel: string;
  state: string;
  history: string[];
}

const usd = (a: string) => `${fmt(BigInt(a), 6)} USDC`;
const nsIso = (ns: string | null) => (ns ? new Date(Number(BigInt(ns) / 1_000_000n)).toISOString() : "—");

/** V3 Treasury deposit (deployed, live testnet) + its FUEL position. */
export function fromV3Deposit(
  d: { id: string; creator: string; amount: string; lp_budget: string; reserve: string; community: string; status: string | object; lp_shares: string; lp_verified: boolean; usdc_swapped: string; usdc_in_lp: string; wnear_in_lp: string; dust_usdc: string; dust_wnear: string; unlock_at: string | null; pool_id: number | null; lp_confirmed_block: string | null; created_at: string; last_error: string | null },
  fuel: { reward_status: string } | null,
  treasury: string,
  nowNs: bigint,
): UnifiedPosition {
  const st = typeof d.status === "string" ? d.status : Object.keys(d.status)[0]!;
  const confirmed = st === "LpConfirmed" && d.lp_verified;
  const locked = d.unlock_at ? nowNs < BigInt(d.unlock_at) : null;
  return {
    key: `v3:${d.id}`, kind: "CLASSIC", evidence: confirmed ? "TESTNET_CONFIRMED" : "TESTNET_PENDING", version: "V3",
    creator: d.creator, pool: `Ref Classic #${d.pool_id ?? 2951} USDC/wNEAR (not a memecoin)`, contracts: [treasury, "ref-finance-101.testnet"],
    netArrived: usd(d.amount),
    deployed: confirmed ? `${usd(d.usdc_in_lp)} + ${fmt(BigInt(d.wnear_in_lp), 24, 6)} wNEAR in the pool (${usd(d.usdc_swapped)} swapped)` : `0 — LP budget ${usd(d.lp_budget)} waiting (${st})`,
    residual: `reserve ${usd(d.reserve)} · community ${usd(d.community)} · dust ${d.dust_usdc} USDC / ${d.dust_wnear} wNEAR atomic`,
    proof: { type: "LP_SHARES", shares: d.lp_shares, verified: d.lp_verified },
    onchainHolder: treasury, holderCheck: d.lp_verified ? "Ref get_pool_shares(Treasury) ≥ recorded shares (verify_liquidity)" : "not verified",
    economicOwner: d.creator,
    lock: d.unlock_at ? `${locked ? "locked until" : "lock ended"} ${nsIso(d.unlock_at)}` : "no LP yet",
    withdraw: "Not offered: V3 withdraw_lp exists in the contract but was never exercised on-chain",
    feesObserved: "Classic: swap fees accrue inside the share value, inseparable from price moves",
    feesClaimable: "no separate fee claim in a Classic pool",
    fuel: fuel ? `FUEL ${fuel.reward_status} (deployed FUEL, pool 2951)` : "not registered in FUEL",
    state: d.last_error ? `${st} — ${d.last_error}` : st,
    history: [`deposit #${d.id} created ${nsIso(d.created_at)}`, ...(d.lp_confirmed_block ? [`LP confirmed at block ${d.lp_confirmed_block}`] : [])],
  };
}

/** V4.1 TreasuryV4 position view (Classic). */
export function fromV4View(v: V4PositionView, treasury: string, evidence: PositionEvidence, nowNs: bigint): UnifiedPosition {
  const d = v.deposit;
  const s = positionState(v, null, nowNs);
  return {
    key: `v41:${treasury}:${d.id}`, kind: "CLASSIC", evidence, version: "V4.1",
    creator: d.creator, pool: `${d.dex} #${d.pool_id ?? "?"} (USDC / ${d.base_token})`, contracts: [treasury, d.dex],
    netArrived: usd(d.amount), deployed: `${usd(d.usdc_in_lp)} + ${d.base_in_lp} base atomic`,
    residual: `dust ${d.dust_usdc} / ${d.dust_base} atomic · returned to reserve ${usd(d.usdc_returned_to_reserve)}`,
    proof: { type: "LP_SHARES", shares: d.lp_shares, verified: d.lp_verified },
    onchainHolder: treasury, holderCheck: d.lp_verified ? "Ref get_pool_shares(TreasuryV4) ≥ recorded" : "not verified",
    economicOwner: d.creator, lock: v.locked ? `locked until ${nsIso(d.unlock_at)}` : d.unlock_at ? "lock ended" : "no LP yet",
    withdraw: v.lp_withdrawable ? "withdraw_lp: Ref mft_transfer of the shares to the creator (after mft_register)" : "not withdrawable now",
    feesObserved: "Classic: inside the share value (predict_remove_liquidity shows fees AND price moves)", feesClaimable: "no separate fee claim",
    fuel: v.fuel_status, state: `${s.state} (${statusName(d.status)})`, history: d.marks.map((m) => `${m.stage} @ block ${m.block}`),
  };
}

/** V4.2A TreasuryDCL position view. The position is a DCL position with a NEP-171 interface (nft_token / nft_transfer measured on v2.4.2). */
export function fromDclView(v: DclPositionView, evidence: PositionEvidence, nowNs: bigint, currentPoint: number | null): UnifiedPosition {
  const d = v.deposit;
  const st = dclPositionState(v, nowNs);
  const range: [number, number] | null = d.left_point !== null && d.right_point !== null ? [d.left_point, d.right_point] : null;
  const rs = range && currentPoint !== null ? rangeStatus(currentPoint, range[0], range[1]) : null;
  const withdrawn = dclStatusName(d.status) === "PositionWithdrawn";
  return {
    key: `v42:${v.treasury_id}:${d.id}`, kind: "DCL", evidence, version: "V4.2A",
    creator: d.creator, pool: `${d.pool_id} (Rhea DCL)`, contracts: [v.treasury_id, d.dex],
    netArrived: usd(d.amount),
    deployed: d.lpt_id ? `${usd(d.usdc_used)} used by the zap → position x ${d.position_x} / y ${d.position_y} atomic` : `0 (${dclStatusName(d.status)})`,
    residual: `in the DEX account: x ${d.dex_x} / y ${d.dex_y} / usdc ${d.dex_usdc} atomic · unused budget back to the reserve ${usd(d.usdc_unused_to_reserve)}`,
    proof: { type: "DCL_POSITION", lptId: d.lpt_id, range, liquidity: d.liquidity, standard: "NEP-171 (nft_token / nft_transfer, measured)" },
    onchainHolder: withdrawn ? d.creator : v.treasury_id,
    holderCheck: withdrawn ? "DCL nft_token owner = creator after withdraw_position (checked by the contract)" : "DCL get_liquidity_view owner = Treasury at confirmation",
    economicOwner: d.creator,
    lock: v.locked ? `locked until ${nsIso(d.unlock_at)}` : d.unlock_at ? "lock ended" : "no position yet",
    withdraw: withdrawn
      ? "done: the creator owns the position; removing liquidity is a separate DCL call by the creator"
      : "after the lock: withdraw_position transfers the position (ownership), it does NOT remove liquidity; leftovers + claimed fees: withdraw_dex_balance then withdraw_token",
    feesObserved: `claimed so far: x ${d.fees_claimed_x} / y ${d.fees_claimed_y} atomic (DCL return values)${rs ? ` · ${rs.inRange ? "in range: earning" : "OUT OF RANGE: earning nothing"}` : ""}`,
    feesClaimable: withdrawn ? "with the creator now (claim on the DCL directly)" : "claim_fees books what the DCL returns; not estimated here",
    fuel: DCL_FUEL_STATUS, state: st.state, history: d.marks.map((m) => `${m.stage} @ block ${m.block}`),
  };
}
