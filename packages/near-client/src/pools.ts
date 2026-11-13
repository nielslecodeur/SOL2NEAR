/**
 * V4.0 — Pool Registry (allowlist) and read-only compatibility checks for NEAR memecoin pools.
 *
 * READ ONLY. Nothing here signs, builds a transaction or changes what the deployed Treasury does: the
 * deployed Treasury (`treasury.sol2near-dev.testnet`) has its Ref pool fixed at deployment (pool 2951).
 *
 * Rules (docs/SOL2NEAR_V4_Memecoin_Liquidity_Router.md §5.3):
 * - a token is identified by its exact NEP-141 contract id, never by ticker or logo;
 * - every entry is OBSERVE_ONLY unless curated ELIGIBLE, and a curated ELIGIBLE entry is still downgraded
 *   to OBSERVE_ONLY as soon as one live check fails (unreadable state, other tokens, empty pool, …);
 * - a pool that is not in the registry is never fundable;
 * - discovery data (reserves, volumes, fees) describes the pool; it proves no deposit and no FUEL right.
 *
 * Every identifier below was read on-chain on 2026-11-13 (scan: `node scripts/probes/v4-pool-scan.ts`,
 * raw reads: src/fixtures/v4_pools_2026-11-13.json). Live values are always re-read: the fixture is for tests.
 */

export type PoolNetwork = "near-testnet" | "near-mainnet";
export type PoolKind = "CLASSIC" | "DCL";
export type TaxPolicy = "NONE_VERIFIED" | "KNOWN_TAX" | "UNKNOWN";
export type PoolStatus = "OBSERVE_ONLY" | "ELIGIBLE" | "SUSPENDED";
/** Curation label, with its evidence in `categoryEvidence`. Not an on-chain fact. */
export type PoolCategory = "MEMECOIN" | "PILOT_NOT_MEMECOIN";

export interface PoolDescriptor {
  /** Stable key: `<network>:<dex>:<poolId>`. */
  key: string;
  network: PoolNetwork;
  dexContractId: string;
  /** Classic: the numeric pool index as a string. DCL: `tokenX|tokenY|fee`. */
  poolId: string;
  kind: PoolKind;
  tokenAContractId: string;
  tokenBContractId: string;
  tokenADecimals: number;
  tokenBDecimals: number;
  tokenTaxPolicy: TaxPolicy;
  /** Curated status. The effective status also depends on the live checks (assessPool). */
  status: PoolStatus;
  category: PoolCategory;
  categoryEvidence: string;
  taxEvidence: string;
  /** Why the Treasury's USDC can (or cannot) reach both assets of this pool, from the dated scan. */
  routeEvidence: string;
  /** When the identifiers were read on-chain. */
  verifiedAt: string;
}

const CLASSIC_TESTNET = "ref-finance-101.testnet";
const CLASSIC_MAINNET = "v2.ref-finance.near";
const DCL_MAINNET = "dclv2.ref-labs.near";
const SCAN = "2026-11-13";
const NO_TESTNET_ROUTE =
  "No route: on ref-finance-101.testnet (2963 pools) usdc.tidepool-sandbox.testnet and wnear.tidepool-sandbox.testnet appear only in pool 2951, and no pool of dclv2.ref-dev.testnet (11690) holds a Tidepool token. The Treasury's USDC cannot reach wrap.testnet or this token.";
const MAINNET_ROUTE =
  "Mainnet only: the Treasury, Tidepool USDC and the whole SOL2NEAR flow are on testnet. No mainnet route is used or offered.";

const key = (network: PoolNetwork, dex: string, poolId: string) => `${network}:${dex}:${poolId}`;

/** Versioned allowlist. v1 = V4.0 (2026-11-13). Short on purpose: verified entries only, no filler. */
export const POOL_REGISTRY_VERSION = 1;
export const POOL_REGISTRY: readonly PoolDescriptor[] = [
  {
    key: key("near-testnet", CLASSIC_TESTNET, "2951"),
    network: "near-testnet", dexContractId: CLASSIC_TESTNET, poolId: "2951", kind: "CLASSIC",
    tokenAContractId: "usdc.tidepool-sandbox.testnet", tokenBContractId: "wnear.tidepool-sandbox.testnet",
    tokenADecimals: 6, tokenBDecimals: 24, tokenTaxPolicy: "NONE_VERIFIED", status: "ELIGIBLE",
    category: "PILOT_NOT_MEMECOIN",
    categoryEvidence: "USDC/wNEAR test pool created by SOL2NEAR in G2 (tx BXcJeRyX…7f7B). It is the pilot pool, not a memecoin pool.",
    taxEvidence: "Tidepool sandbox NEP-141 (contract_source_metadata → github.com/Watchmeecryt/tidepool). Observed, not audited: every real transfer in G2, G6 and G7 moved the exact amount (ft_transfer_call returned the full amount; Treasury shares = Ref shares).",
    routeEvidence: "Direct: the Treasury holds this pool's USDC and swaps part of it to wNEAR inside the same pool (execute_lp, proven C2, G6-LP, G6-LP2).",
    verifiedAt: SCAN,
  },
  {
    key: key("near-testnet", CLASSIC_TESTNET, "2131"),
    network: "near-testnet", dexContractId: CLASSIC_TESTNET, poolId: "2131", kind: "CLASSIC",
    tokenAContractId: "mev-33.factory.v9.meme-cooking.testnet", tokenBContractId: "wrap.testnet",
    tokenADecimals: 18, tokenBDecimals: 24, tokenTaxPolicy: "UNKNOWN", status: "OBSERVE_ONLY",
    category: "MEMECOIN",
    categoryEvidence: "Issued by the meme.cooking TESTNET factory (factory.v9.meme-cooking.testnet). The testnet meme-cooking pool with the most wrap.testnet on Ref Classic (scan 2026-11-13). A test token, not a mainnet memecoin.",
    taxEvidence: "No tax view is known for this contract (code hash 5hQRLy7L…DX81, no source link). Not verified, so treated as UNKNOWN.",
    routeEvidence: NO_TESTNET_ROUTE,
    verifiedAt: SCAN,
  },
  {
    key: key("near-testnet", CLASSIC_TESTNET, "2190"),
    network: "near-testnet", dexContractId: CLASSIC_TESTNET, poolId: "2190", kind: "CLASSIC",
    tokenAContractId: "shitzu-0.factory.v10.meme-cooking.testnet", tokenBContractId: "wrap.testnet",
    tokenADecimals: 18, tokenBDecimals: 24, tokenTaxPolicy: "UNKNOWN", status: "OBSERVE_ONLY",
    category: "MEMECOIN",
    categoryEvidence: "Issued by the meme.cooking TESTNET factory (factory.v10.meme-cooking.testnet). Test token named after a mainnet memecoin: it is NOT token.0xshitzu.near.",
    taxEvidence: "No tax view is known for this contract (code hash AKwqzUW7…iECT, no source link). Not verified, so treated as UNKNOWN.",
    routeEvidence: NO_TESTNET_ROUTE,
    verifiedAt: SCAN,
  },
  {
    key: key("near-mainnet", CLASSIC_MAINNET, "5462"),
    network: "near-mainnet", dexContractId: CLASSIC_MAINNET, poolId: "5462", kind: "CLASSIC",
    tokenAContractId: "chill-129.meme-cooking.near", tokenBContractId: "wrap.near",
    tokenADecimals: 18, tokenBDecimals: 24, tokenTaxPolicy: "UNKNOWN", status: "OBSERVE_ONLY",
    category: "MEMECOIN",
    categoryEvidence: "Issued by the meme.cooking mainnet launchpad (chill-129.meme-cooking.near). The memecoin Classic pool with the most wNEAR on v2.ref-finance.near (scan 2026-11-13).",
    taxEvidence: "No tax view is known (code hash FKMtu667…RZps, no source link). Not verified, so treated as UNKNOWN.",
    routeEvidence: MAINNET_ROUTE,
    verifiedAt: SCAN,
  },
  {
    key: key("near-mainnet", CLASSIC_MAINNET, "4276"),
    network: "near-mainnet", dexContractId: CLASSIC_MAINNET, poolId: "4276", kind: "CLASSIC",
    tokenAContractId: "wrap.near", tokenBContractId: "blackdragon.tkn.near",
    tokenADecimals: 24, tokenBDecimals: 24, tokenTaxPolicy: "UNKNOWN", status: "OBSERVE_ONLY",
    category: "MEMECOIN",
    categoryEvidence: "BLACKDRAGON, issued through the tkn.near token factory; its largest Ref Classic wNEAR pool (scan 2026-11-13).",
    taxEvidence: "No tax view is known (code hash 4AVV1KUV…mBKD, no source link). Not verified, so treated as UNKNOWN.",
    routeEvidence: MAINNET_ROUTE,
    verifiedAt: SCAN,
  },
  {
    key: key("near-mainnet", DCL_MAINNET, "nearly-993927.nearlytrade.near|wrap.near|10000"),
    network: "near-mainnet", dexContractId: DCL_MAINNET, poolId: "nearly-993927.nearlytrade.near|wrap.near|10000", kind: "DCL",
    tokenAContractId: "nearly-993927.nearlytrade.near", tokenBContractId: "wrap.near",
    tokenADecimals: 18, tokenBDecimals: 24, tokenTaxPolicy: "UNKNOWN", status: "OBSERVE_ONLY",
    category: "MEMECOIN",
    categoryEvidence: "Nearly launch token (nearlytrade.near), launched on a RHEA DCL pool, fee tier 1 %. The Nearly pool with the most wNEAR on dclv2.ref-labs.near (scan 2026-11-13).",
    taxEvidence: "The DCL pool's own `tax` field reads null, but per the V4 spec (citing nearly.trade/docs, not re-verified here) Nearly tokens can be taxed at TOKEN level, including on LP adds/removes and fee claims. The token runs a global contract (5qScjXG9…42eGQ) with no known tax view: UNKNOWN.",
    routeEvidence: MAINNET_ROUTE,
    verifiedAt: SCAN,
  },
];

// ---------- live state, normalised from the DEX views ----------

export interface TokenMeta { symbol: string; decimals: number }

export type LivePool =
  | {
      kind: "CLASSIC";
      /** get_pool.pool_kind: only SIMPLE_POOL has the x*y=k shares the Treasury handles. */
      poolKind: string;
      tokens: [string, string];
      amounts: [string, string];
      /** get_pool.total_fee, in bps. */
      feeBps: number;
      sharesTotalSupply: string;
      /** get_pool_volumes: cumulative swap input per token since the pool's creation (Ref counter). */
      volumeIn: [string, string] | null;
      meta: Record<string, TokenMeta | null>;
    }
  | {
      kind: "DCL";
      tokens: [string, string];
      /** DCL fee is in 1e-6 units (10000 = 1 %): bps = fee / 100. */
      feeBps: number;
      state: string;
      liquidity: string;
      totals: [string, string];
      volumeIn: [string, string];
      /** DCL pool-level tax (v2.4); token-level taxes are NOT visible here. */
      poolTax: unknown;
      meta: Record<string, TokenMeta | null>;
    };

export interface RawClassicPool { pool_kind: string; token_account_ids: string[]; amounts: string[]; total_fee: number; shares_total_supply: string }
export interface RawDclPool { token_x: string; token_y: string; fee: number; state: string; liquidity: string; total_x: string; total_y: string; volume_x_in: string; volume_y_in: string; tax?: unknown }

export function normalizeClassic(raw: RawClassicPool, volumes: { input: string }[] | null, meta: Record<string, TokenMeta | null>): LivePool {
  if (raw.token_account_ids.length !== 2 || raw.amounts.length !== 2) {
    // Stable / rated pools may hold more than 2 tokens: kept, the kind check refuses them.
    return { kind: "CLASSIC", poolKind: `${raw.pool_kind} (${raw.token_account_ids.length} tokens)`, tokens: [raw.token_account_ids[0] ?? "", raw.token_account_ids[1] ?? ""], amounts: ["0", "0"], feeBps: raw.total_fee, sharesTotalSupply: raw.shares_total_supply, volumeIn: null, meta };
  }
  return {
    kind: "CLASSIC", poolKind: raw.pool_kind, tokens: [raw.token_account_ids[0]!, raw.token_account_ids[1]!],
    amounts: [raw.amounts[0]!, raw.amounts[1]!], feeBps: raw.total_fee, sharesTotalSupply: raw.shares_total_supply,
    volumeIn: volumes && volumes.length === 2 ? [volumes[0]!.input, volumes[1]!.input] : null, meta,
  };
}

export function normalizeDcl(raw: RawDclPool, meta: Record<string, TokenMeta | null>): LivePool {
  return {
    kind: "DCL", tokens: [raw.token_x, raw.token_y], feeBps: raw.fee / 100, state: raw.state, liquidity: raw.liquidity,
    totals: [raw.total_x, raw.total_y], volumeIn: [raw.volume_x_in, raw.volume_y_in], poolTax: raw.tax ?? null, meta,
  };
}

// ---------- assessment ----------

/** What the deployed Treasury can fund, read from its get_config (never assumed). */
export interface TreasuryTarget {
  network: "near-testnet";
  dexContractId: string;
  poolId: string;
  usdcToken: string;
}

export type CheckId = "network" | "readable" | "identity" | "kind" | "liquidity" | "tax" | "usdc_route" | "treasury_pool";
export interface Check { id: CheckId; ok: boolean; detail: string }
export interface Assessment {
  key: string;
  /** Effective status: ELIGIBLE only if curated ELIGIBLE and every check passes. */
  status: PoolStatus;
  checks: Check[];
  /** Failed checks, in order: why the pool cannot be funded. Empty only when ELIGIBLE. */
  reasons: string[];
}

/**
 * Pure. `live` is the normalised live state, or the read error. `treasury` is the deployed Treasury's target,
 * or null if it could not be read (then nothing is fundable).
 */
export function assessPool(d: PoolDescriptor, live: LivePool | Error, treasury: TreasuryTarget | null): Assessment {
  const checks: Check[] = [];
  const add = (id: CheckId, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  add("network", d.network === "near-testnet",
    d.network === "near-testnet" ? "NEAR testnet, same network as the Treasury." : "Mainnet pool: SOL2NEAR runs on testnet only. Shown as a reference, never fundable here.");

  if (live instanceof Error) {
    add("readable", false, `Live state could not be read: ${live.message}`);
  } else {
    add("readable", true, `Read live from ${d.dexContractId}.`);
    const want = [d.tokenAContractId, d.tokenBContractId];
    const sameTokens = live.tokens[0] === want[0] && live.tokens[1] === want[1];
    const decOk = [d.tokenADecimals, d.tokenBDecimals].every((dec, i) => live.meta[want[i]!]?.decimals === dec);
    add("identity", sameTokens && decOk, !sameTokens
      ? `Pool now holds ${live.tokens.join(" / ")}, registry expects ${want.join(" / ")}.`
      : decOk ? "Exact contract ids and decimals match the registry (ft_metadata)." : "ft_metadata decimals differ from the registry, or could not be read.");

    if (live.kind === "CLASSIC") {
      add("kind", d.kind === "CLASSIC" && live.poolKind === "SIMPLE_POOL", live.poolKind === "SIMPLE_POOL"
        ? "Ref Classic simple pool: fungible LP shares, the model the Treasury handles."
        : `Ref pool kind ${live.poolKind}: not the simple x*y=k pool the Treasury's execute_lp uses.`);
      const filled = live.amounts.every((a) => BigInt(a) > 0n) && BigInt(live.sharesTotalSupply) > 0n;
      add("liquidity", filled, filled ? "Both reserves and the share supply are > 0." : "Empty pool: a reserve or the share supply is 0.");
    } else {
      add("kind", false, "RHEA DCL pool: positions are NFTs with a price range, not fungible shares. The deployed Treasury handles Classic shares only; DCL is V4.2.");
      const running = live.state === "Running" && BigInt(live.liquidity) > 0n;
      add("liquidity", running, running ? "Running, with active liquidity at the current price." : `State ${live.state}, liquidity ${live.liquidity}.`);
    }

    const poolTaxed = live.kind === "DCL" && live.poolTax !== null;
    const taxOk = d.tokenTaxPolicy === "NONE_VERIFIED" && !poolTaxed;
    add("tax", taxOk, poolTaxed ? `The DCL pool itself charges a tax: ${JSON.stringify(live.poolTax)}.`
      : taxOk ? `No transfer tax: ${d.taxEvidence}` : `Tax policy ${d.tokenTaxPolicy}: ${d.taxEvidence}`);
  }

  const hasUsdc = !!treasury && (d.tokenAContractId === treasury.usdcToken || d.tokenBContractId === treasury.usdcToken);
  add("usdc_route", hasUsdc, hasUsdc ? d.routeEvidence : treasury ? d.routeEvidence : "Treasury config could not be read.");

  const isTarget = !!treasury && d.network === treasury.network && d.dexContractId === treasury.dexContractId && d.poolId === treasury.poolId;
  add("treasury_pool", isTarget, isTarget
    ? `This is the pool fixed in the deployed Treasury (get_config.pool_id = ${treasury!.poolId}).`
    : treasury
      ? `The deployed Treasury can only fund pool ${treasury.poolId} on ${treasury.dexContractId} (fixed at deployment). Another pool needs a separate TreasuryV4 (V4.1).`
      : "Treasury config could not be read.");

  const reasons = checks.filter((c) => !c.ok).map((c) => c.detail);
  const status: PoolStatus = d.status === "SUSPENDED" ? "SUSPENDED"
    : d.status === "ELIGIBLE" && reasons.length === 0 ? "ELIGIBLE" : "OBSERVE_ONLY";
  if (status === "OBSERVE_ONLY" && reasons.length === 0) reasons.push("Not on the allowlist for funding (curated OBSERVE_ONLY).");
  if (status === "SUSPENDED") reasons.unshift("Suspended in the registry: no new funding.");
  return { key: d.key, status, checks, reasons };
}

export const findDescriptor = (poolKey: string, registry: readonly PoolDescriptor[] = POOL_REGISTRY) =>
  registry.find((d) => d.key === poolKey) ?? null;

export type Selection = { ok: true; descriptor: PoolDescriptor } | { ok: false; reason: string };

/**
 * The only way to select a pool for funding: it must be in the registry AND assessed ELIGIBLE from live data.
 * An unknown key (e.g. a pool typed by hand or a stale stored selection) is refused.
 */
export function selectPool(poolKey: string, assessments: ReadonlyMap<string, Assessment>, registry: readonly PoolDescriptor[] = POOL_REGISTRY): Selection {
  const d = findDescriptor(poolKey, registry);
  if (!d) return { ok: false, reason: `Pool ${poolKey} is not in the SOL2NEAR registry: never fundable.` };
  const a = assessments.get(poolKey);
  if (!a) return { ok: false, reason: "Not assessed from live data yet." };
  if (a.status !== "ELIGIBLE") return { ok: false, reason: `${a.status}: ${a.reasons[0] ?? ""}` };
  return { ok: true, descriptor: d };
}

/** Treasury target from the deployed Treasury's get_config (exchange, pool and USDC token are all read). */
export function treasuryTarget(cfg: { config: { usdc_token: string; pool_id: number; ref_exchange: string } }): TreasuryTarget {
  return { network: "near-testnet", dexContractId: cfg.config.ref_exchange, poolId: String(cfg.config.pool_id), usdcToken: cfg.config.usdc_token };
}
