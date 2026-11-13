/**
 * V4.0 Pool Explorer — live, READ-ONLY reads of the registry pools.
 *
 * Mainnet reference pools are read through a separate read-only RPC client. It is never given to the wallet
 * code (near/wallet.ts), and every mainnet entry is OBSERVE_ONLY by the network check: no mainnet call can be
 * signed from this app. Testnet reads use the same client as the rest of the dashboard.
 */
import {
  addAmountsInPoolOrder, assessPool, normalizeClassic, normalizeDcl, POOL_REGISTRY, previewSwap, priceImpactBps, treasuryTarget,
  type Assessment, type LivePool, type PoolDescriptor, type RawClassicPool, type RawDclPool, type TokenMeta, type TreasuryTarget,
} from "../../../../packages/near-client/src/index.ts";
import { DEFAULT_SLIPPAGE_BPS, impactLevel, type ImpactLevel } from "../near/actions.ts";
import { TREASURY_ACCOUNT_ID } from "../near/config.ts";
import { nearRpc, NEAR_RPC_URLS, type NearRpc } from "../near/rpc.ts";

/** Public mainnet providers (CORS open), used ONLY for view calls on reference pools. */
export const MAINNET_READ_ONLY_RPCS = ["https://free.rpc.fastnear.com", "https://near.drpc.org"];

export interface PoolRow { d: PoolDescriptor; live: LivePool | Error; a: Assessment }
export interface Catalog { readAt: number; treasury: TreasuryTarget | null; treasuryError: string | null; rows: PoolRow[] }

export function poolReaders(testnet: NearRpc = nearRpc(NEAR_RPC_URLS), mainnet: NearRpc = nearRpc(MAINNET_READ_ONLY_RPCS)) {
  const rpcOf = (d: PoolDescriptor) => (d.network === "near-testnet" ? testnet : mainnet);
  const metaCache = new Map<string, Promise<TokenMeta | null>>();
  const meta = (d: PoolDescriptor, token: string) => {
    const k = `${d.network}:${token}`;
    if (!metaCache.has(k)) metaCache.set(k, rpcOf(d).view<TokenMeta>(token, "ft_metadata").then((m) => ({ symbol: m.symbol, decimals: m.decimals }), () => null));
    return metaCache.get(k)!;
  };

  async function readPool(d: PoolDescriptor): Promise<LivePool> {
    const rpc = rpcOf(d);
    const [ma, mb] = await Promise.all([meta(d, d.tokenAContractId), meta(d, d.tokenBContractId)]);
    const m = { [d.tokenAContractId]: ma, [d.tokenBContractId]: mb };
    if (d.kind === "CLASSIC") {
      const id = Number(d.poolId);
      const [raw, vol] = await Promise.all([
        rpc.view<RawClassicPool>(d.dexContractId, "get_pool", { pool_id: id }),
        rpc.view<{ input: string }[]>(d.dexContractId, "get_pool_volumes", { pool_id: id }).catch(() => null),
      ]);
      // ft_metadata of the tokens the pool REALLY holds, so an identity mismatch is shown with real symbols
      for (const t of raw.token_account_ids) if (!(t in m)) m[t] = await meta(d, t);
      return normalizeClassic(raw, vol, m);
    }
    const raw = await rpc.view<RawDclPool>(d.dexContractId, "get_pool", { pool_id: d.poolId });
    return normalizeDcl(raw, m);
  }

  async function readCatalog(): Promise<Catalog> {
    let treasury: TreasuryTarget | null = null;
    let treasuryError: string | null = null;
    try {
      treasury = treasuryTarget(await testnet.view(TREASURY_ACCOUNT_ID, "get_config"));
    } catch (e) {
      treasuryError = (e as Error).message;
    }
    const rows = await Promise.all(POOL_REGISTRY.map(async (d) => {
      const live = await readPool(d).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
      return { d, live, a: assessPool(d, live, treasury) };
    }));
    return { readAt: Date.now(), treasury, treasuryError, rows };
  }

  /**
   * Read-only quote for the selected pool: the LP plan the Treasury would use (same near-client code as execute_lp),
   * cross-checked with Ref's own `get_return` for the swap leg. Nothing is signed.
   */
  async function preflight(d: PoolDescriptor, treasury: TreasuryTarget, lpBudget: bigint): Promise<Preflight> {
    const rpc = rpcOf(d);
    const pool = await rpc.view<RawClassicPool>(d.dexContractId, "get_pool", { pool_id: Number(d.poolId) });
    const snap = { token_account_ids: pool.token_account_ids as [string, string], amounts: pool.amounts as [string, string], total_fee: pool.total_fee };
    const usdc = treasury.usdcToken;
    const other = snap.token_account_ids.find((t) => t !== usdc)!;
    const p = previewSwap(lpBudget, snap, usdc, DEFAULT_SLIPPAGE_BPS);
    const refReturn = await rpc.view<string>(d.dexContractId, "get_return", { pool_id: Number(d.poolId), token_in: usdc, amount_in: p.swapAmountIn.toString(), token_out: other });
    const bps = priceImpactBps(snap, usdc, p.swapAmountIn, p.expectedOut);
    return {
      readAt: Date.now(), lpBudget, swapIn: p.swapAmountIn, expectedOut: p.expectedOut, minOut: p.minSwapOut, refReturn: BigInt(refReturn),
      usdcLeft: p.usdcLeft, poolFeeIn: p.poolFeeIn, feeBps: pool.total_fee, impactBps: bps, level: impactLevel(bps),
      addAmounts: addAmountsInPoolOrder(snap, usdc, p.usdcLeft, p.expectedOut), otherToken: other,
    };
  }

  return { readCatalog, readPool, preflight };
}

export interface Preflight {
  readAt: number;
  lpBudget: bigint;
  swapIn: bigint;
  expectedOut: bigint;
  minOut: bigint;
  /** Ref's own get_return for the same swap: must equal expectedOut (the formula is proven to match). */
  refReturn: bigint;
  usdcLeft: bigint;
  poolFeeIn: bigint;
  feeBps: number;
  impactBps: number;
  level: ImpactLevel;
  addAmounts: [bigint, bigint];
  otherToken: string;
}

const SELECTION_KEY = "sol2near:v4-pool";
export function loadSelection(): string | null {
  try { return localStorage.getItem(SELECTION_KEY); } catch { return null; }
}
export function saveSelection(key: string | null) {
  try { key ? localStorage.setItem(SELECTION_KEY, key) : localStorage.removeItem(SELECTION_KEY); } catch { /* not persisted */ }
}
