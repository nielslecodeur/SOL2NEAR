/**
 * V4.1B data sources for the TreasuryV4 pilot. Exactly two, both READ ONLY:
 *
 * - "testnet": live public reads of the PLANNED pilot accounts (V41_PILOT). While they are not deployed the
 *   adapter reports NOT_DEPLOYED and returns no pool, no quote and no position. Nothing is ever invented.
 * - "sandbox-snapshot": an explicit, bannered PREVIEW built from the real TreasuryV4 / Ref views captured in the
 *   LOCAL near-workspaces sandbox (packages/near-client/src/fixtures/v4_sandbox_views.json). Its network is
 *   "sandbox" and its accounts are *.test.near, so every signing / withdraw gate refuses it by construction.
 *
 * There is no test hook here: the production build cannot be pointed at fake contracts. Browser tests that need a
 * "deployed" pilot intercept the public RPC responses instead (apps/web/e2e).
 */
import sandboxViews from "../../../../packages/near-client/src/fixtures/v4_sandbox_views.json";
import {
  fuelEligibility, pilotDeployment, V41_PILOT,
  type FuelConfig, type FuelEligibility, type PilotDeployment, type V4InFlight, type V4PositionView,
} from "../../../../packages/near-client/src/index.ts";
import { FUEL_ACCOUNT_ID } from "../near/config.ts";
import { nearRpc, type NearRpc } from "../near/rpc.ts";

export type V4Source = "testnet" | "sandbox-snapshot";
export interface V4PoolState { token_account_ids: [string, string]; amounts: [string, string]; total_fee: number; shares_total_supply: string; pool_kind: string }
export interface V4AccountState { usdcBalance: bigint | null; usdcRegistered: boolean | null; baseRegistered: boolean | null; refRegistered: boolean | null; reserve: bigint; baseBalance: bigint }
export interface V4Ids { treasury: string; dex: string; usdc: string; base: string; poolId: number | null; usdcDecimals: number; baseDecimals: number; lockNs: bigint; minDeposit: bigint }

export interface V4Chain {
  source: V4Source;
  network: "testnet" | "sandbox";
  deployment(): Promise<PilotDeployment | { state: "SANDBOX_SNAPSHOT" }>;
  ids(): Promise<V4Ids>;
  fuel(): Promise<FuelEligibility>;
  nowNs(): Promise<bigint>;
  pool(): Promise<V4PoolState | null>;
  /** Ref get_return USDC -> base for the pool, or null without a live pool. */
  quote(amountIn: bigint): Promise<bigint | null>;
  adminFeeBps(): Promise<number | null>;
  positions(creator: string): Promise<V4PositionView[]>;
  inFlight(): Promise<V4InFlight | null>;
  refTreasuryShares(): Promise<bigint>;
  mftRegistered(account: string): Promise<boolean>;
  predictRemove(shares: string): Promise<[string, string] | null>;
  account(account: string): Promise<V4AccountState>;
}

const PLANNED_IDS = (poolId: number | null): V4Ids => ({
  treasury: V41_PILOT.treasuryId, dex: V41_PILOT.dex, usdc: V41_PILOT.usdcTokenId, base: V41_PILOT.baseTokenId, poolId,
  usdcDecimals: V41_PILOT.usdcDecimals, baseDecimals: V41_PILOT.baseDecimals, lockNs: V41_PILOT.lockNs, minDeposit: V41_PILOT.minDepositAtomic,
});

export function testnetChain(rpc: NearRpc = nearRpc()): V4Chain {
  let dep: Promise<PilotDeployment> | null = null;
  const deployment = () => (dep ??= pilotDeployment({ codeHash: (id) => rpc.codeHash(id), view: (c, m, a) => rpc.view(c, m, a) }));
  const poolId = async () => { const d = await deployment(); return d.state === "READY" ? d.poolId : null; };
  const ready = async () => (await deployment()).state === "READY";
  return {
    source: "testnet",
    network: "testnet",
    deployment,
    async ids() {
      const id = await poolId();
      if (id === null) return PLANNED_IDS(null);
      const c = await rpc.view<{ config: { min_deposit: string; lp_lock_duration_ns: string; pool: { usdc_decimals: number; base_decimals: number } } }>(V41_PILOT.treasuryId, "get_config");
      return { ...PLANNED_IDS(id), usdcDecimals: c.config.pool.usdc_decimals, baseDecimals: c.config.pool.base_decimals, lockNs: BigInt(c.config.lp_lock_duration_ns), minDeposit: BigInt(c.config.min_deposit) };
    },
    async fuel() {
      const r = await rpc.view<{ config: FuelConfig }>(FUEL_ACCOUNT_ID, "get_reactor");
      return fuelEligibility(r.config, V41_PILOT.treasuryId, await poolId());
    },
    nowNs: () => rpc.blockTimestampNs(),
    async pool() {
      const id = await poolId();
      return id === null ? null : rpc.view<V4PoolState>(V41_PILOT.dex, "get_pool", { pool_id: id });
    },
    async quote(amountIn) {
      const id = await poolId();
      if (id === null || amountIn <= 0n) return null;
      return BigInt(await rpc.view<string>(V41_PILOT.dex, "get_return", { pool_id: id, token_in: V41_PILOT.usdcTokenId, amount_in: amountIn.toString(), token_out: V41_PILOT.baseTokenId }));
    },
    async adminFeeBps() {
      return (await rpc.view<{ admin_fee_bps: number }>(V41_PILOT.dex, "metadata")).admin_fee_bps;
    },
    async positions(creator) {
      if (!(await ready()) || !creator) return [];
      const deps = await rpc.view<{ id: string }[]>(V41_PILOT.treasuryId, "get_creator_deposits", { creator });
      const views = await Promise.all(deps.map((d) => rpc.view<V4PositionView | null>(V41_PILOT.treasuryId, "get_position", { deposit_id: d.id })));
      return views.filter((v): v is V4PositionView => !!v);
    },
    async inFlight() {
      return (await ready()) ? rpc.view<V4InFlight | null>(V41_PILOT.treasuryId, "get_in_flight") : null;
    },
    async refTreasuryShares() {
      const id = await poolId();
      return id === null ? 0n : BigInt(await rpc.view<string>(V41_PILOT.dex, "get_pool_shares", { pool_id: id, account_id: V41_PILOT.treasuryId }));
    },
    async mftRegistered(account) {
      const id = await poolId();
      return id === null ? false : rpc.view<boolean>(V41_PILOT.dex, "mft_has_registered", { token_id: `:${id}`, account_id: account });
    },
    async predictRemove(shares) {
      const id = await poolId();
      return id === null || shares === "0" ? null : rpc.view<[string, string]>(V41_PILOT.dex, "predict_remove_liquidity", { pool_id: id, shares });
    },
    async account(account) {
      const usdcBal = rpc.view<string>(V41_PILOT.usdcTokenId, "ft_balance_of", { account_id: account });
      const usdcReg = rpc.view<unknown>(V41_PILOT.usdcTokenId, "storage_balance_of", { account_id: account });
      const deployed = await ready();
      const [bal, reg] = await Promise.all([usdcBal, usdcReg]);
      const [baseReg, refReg, reserve, baseBalance] = deployed
        ? await Promise.all([
            rpc.view<unknown>(V41_PILOT.baseTokenId, "storage_balance_of", { account_id: account }).then((x) => x !== null),
            rpc.view<unknown>(V41_PILOT.dex, "storage_balance_of", { account_id: account }).then((x) => x !== null),
            rpc.view<string>(V41_PILOT.treasuryId, "get_reserve", { creator: account }).then(BigInt),
            rpc.view<string>(V41_PILOT.treasuryId, "get_base_balance", { creator: account }).then(BigInt),
          ])
        : [null, null, 0n, 0n];
      return { usdcBalance: BigInt(bal), usdcRegistered: reg !== null, baseRegistered: baseReg, refRegistered: refReg, reserve, baseBalance };
    },
  };
}

// ---------- local sandbox snapshot (preview only) ----------

type Snap = {
  now_ns: string; position: V4PositionView; in_flight: V4InFlight | null; ref_treasury_shares: string; creator_mft_registered: boolean;
  predict_remove_liquidity: [string, string] | null; creator_reserve: string; creator_base_balance: string;
};
const views = sandboxViews as unknown as Record<string, Snap> & {
  config: { config: { min_deposit: string; lp_lock_duration_ns: string; pool: { dex: string; pool_id: number; usdc_token: string; base_token: string; usdc_decimals: number; base_decimals: number } } };
  pool_before_lp: V4PoolState; ref_metadata: { admin_fee_bps: number };
};

/** Lifecycle stages captured from the real contract in the local sandbox run, in order. */
export const SANDBOX_STAGES: { key: string; label: string }[] = [
  { key: "budget_allocated", label: "1 · deposit counted (20 USDC)" },
  { key: "parked_guard_slippage", label: "2 · plan refused by the slippage guard" },
  { key: "lp_confirmed_locked", label: "3 · LP confirmed, locked" },
  { key: "lp_unlocked_not_registered", label: "4 · lock over, creator not mft-registered" },
  { key: "lp_unlocked_registered", label: "5 · lock over, mft-registered" },
  { key: "lp_withdrawn", label: "6 · LP withdrawn to the creator" },
  { key: "parked_price_impact", label: "deposit #1 · refused by the price-impact guard" },
  { key: "aborted_with_leftovers", label: "deposit #1 · aborted, 810 USDC leftover in Ref" },
  { key: "aborted_recovered", label: "deposit #1 · leftover recovered to the reserve" },
];

export function sandboxChain(stage: string): V4Chain {
  const s = views[stage] ?? views.budget_allocated!;
  const c = views.config.config;
  return {
    source: "sandbox-snapshot",
    network: "sandbox",
    deployment: async () => ({ state: "SANDBOX_SNAPSHOT" as const }),
    ids: async () => ({
      treasury: "treasury-v4.test.near", dex: c.pool.dex, usdc: c.pool.usdc_token, base: c.pool.base_token, poolId: c.pool.pool_id,
      usdcDecimals: c.pool.usdc_decimals, baseDecimals: c.pool.base_decimals, lockNs: BigInt(c.lp_lock_duration_ns), minDeposit: BigInt(c.min_deposit),
    }),
    fuel: async () => ({ status: "FUEL_NOT_ELIGIBLE", reason: s.position.fuel_reason }),
    nowNs: async () => BigInt(s.now_ns),
    pool: async () => views.pool_before_lp,
    quote: async () => null,
    adminFeeBps: async () => views.ref_metadata.admin_fee_bps,
    positions: async () => [s.position],
    inFlight: async () => s.in_flight,
    refTreasuryShares: async () => BigInt(s.ref_treasury_shares),
    mftRegistered: async () => s.creator_mft_registered,
    predictRemove: async () => s.predict_remove_liquidity,
    account: async () => ({ usdcBalance: null, usdcRegistered: true, baseRegistered: true, refRegistered: true, reserve: BigInt(s.creator_reserve), baseBalance: BigInt(s.creator_base_balance) }),
  };
}

export const SANDBOX_CREATOR = "alice.test.near";
