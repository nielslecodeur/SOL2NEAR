/** Read-only NEAR testnet access (JSON-RPC view calls). No wallet, no keys, no signing. */
import { FUEL_ACCOUNT_ID, NEAR_RPC_URL, REF_EXCHANGE_ID, TREASURY_ACCOUNT_ID } from "../../../packages/shared/src/accounts.ts";
import type { TreasuryAccounting, TreasuryDeposit } from "../../../packages/shared/src/treasury.ts";

export { FUEL_ACCOUNT_ID, TREASURY_ACCOUNT_ID };
export const explorerAccount = (id: string) => `https://testnet.nearblocks.io/address/${id}`;
export const explorerBlock = (h: string | number) => `https://testnet.nearblocks.io/blocks/${h}`;

export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const res = await fetch(NEAR_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "web", method: "query",
      params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) },
    }),
  });
  const json = await res.json();
  const err = json.error ?? json.result?.error;
  if (err) throw new Error(typeof err === "string" ? err : JSON.stringify(err.cause ?? err).slice(0, 200));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}

export async function isDeployed(account: string): Promise<boolean> {
  const res = await fetch(NEAR_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "web", method: "query", params: { request_type: "view_account", finality: "final", account_id: account } }),
  });
  const json = await res.json();
  return !!json.result && json.result.code_hash !== "11111111111111111111111111111111";
}

// Shapes of the FUEL views (contracts/fuel).
export interface Season {
  id: number; start: string; end: string; target_usdc: string; progress_usdc: string; positions: number;
  committed_creator: string; committed_community: string; status: "Open" | "Success" | "Failed";
  burned: string; level_after: number | null; closed_at: string | null;
}
export interface Buckets {
  total_supply: string; contract_balance: string; pol_available: string; pol_committed: string; pol_distributed: string;
  community_reserve: string; burn_reserve: string; burned_total: string; team_locked: string; team_released: string;
}
export interface Reactor {
  level: number; now: string; current_season_id: number; current_season: Season; seasons_touched: number[];
  buckets: Buckets; config: { season_duration_ns: string; season_target_usdc: string; season_burn: string; vault_cap: string; min_lock_ns: string; pool_id: number };
}
export interface FuelPosition {
  position: {
    position_id: string; creator_id: string; vault_id: string; pool_id: number; usdc_in_lp: string; lp_shares: string;
    confirmed_at: string; confirmed_block: string; unlock_at: string; season_id: number; reward_total: string;
    creator_reward: string; community_reward: string; claimed: boolean; ref_treasury_shares: string; treasury_recorded_shares: string;
  };
  reward_status: "Pending" | "Locked" | "Claimable" | "Claimed" | "Forfeited" | "NoReward";
}

export interface Snapshot {
  source: "testnet" | "demo";
  deployed: { treasury: boolean; fuel: boolean };
  deposits: TreasuryDeposit[];
  accounting: TreasuryAccounting | null;
  positions: Record<string, FuelPosition | null>;
  reactor: Reactor | null;
  seasons: Season[];
  refTreasuryShares: string | null;
}

/** Everything the UI shows for one creator, read live from testnet. */
export async function loadTestnet(creator: string): Promise<Snapshot> {
  const [treasury, fuel] = await Promise.all([isDeployed(TREASURY_ACCOUNT_ID), isDeployed(FUEL_ACCOUNT_ID)]);
  const snap: Snapshot = { source: "testnet", deployed: { treasury, fuel }, deposits: [], accounting: null, positions: {}, reactor: null, seasons: [], refTreasuryShares: null };
  if (treasury) {
    const cfg = await view<{ config: { pool_id: number } }>(TREASURY_ACCOUNT_ID, "get_config");
    [snap.deposits, snap.accounting, snap.refTreasuryShares] = await Promise.all([
      creator ? view<TreasuryDeposit[]>(TREASURY_ACCOUNT_ID, "get_creator_deposits", { creator }) : Promise.resolve([]),
      view<TreasuryAccounting>(TREASURY_ACCOUNT_ID, "get_accounting"),
      view<string>(REF_EXCHANGE_ID, "get_pool_shares", { pool_id: cfg.config.pool_id, account_id: TREASURY_ACCOUNT_ID }),
    ]);
  }
  if (fuel) {
    snap.reactor = await view<Reactor>(FUEL_ACCOUNT_ID, "get_reactor");
    const ids = snap.reactor.seasons_touched;
    snap.seasons = (await Promise.all(ids.map((id) => view<Season | null>(FUEL_ACCOUNT_ID, "get_season", { season_id: id })))).filter((s): s is Season => !!s);
    for (const d of snap.deposits) snap.positions[d.id] = await view<FuelPosition | null>(FUEL_ACCOUNT_ID, "get_position", { position_id: d.id });
  }
  return snap;
}
