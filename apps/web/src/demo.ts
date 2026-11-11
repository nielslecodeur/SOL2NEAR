/**
 * SIMULATED / DEMO DATA — not read from any chain. Shapes match the real contract views so the
 * same screens render both. Every screen shows a "SIMULATED" banner when this source is used.
 */
import type { BridgeResult, CrosschainClient } from "../../../packages/shared/src/crosschain.ts";
import type { TreasuryDeposit } from "../../../packages/shared/src/treasury.ts";
import type { FuelPosition, Season, Snapshot } from "./chain.ts";

const MIN = 60n * 1_000_000_000n;
const now = BigInt(Date.now()) * 1_000_000n;
const t = (offsetMin: number) => (now + BigInt(offsetMin) * MIN).toString();
const F = (n: number) => (BigInt(Math.round(n * 100)) * 10n ** 16n).toString(); // FUEL, 2 decimals of precision

const base = {
  creator: "demo-creator.testnet", plan: null, lp_shares: "0", lp_verified: false, usdc_in_lp: "0", wnear_in_lp: "0",
  dust_usdc: "0", dust_wnear: "0", unlock_at: null, pool_id: null, lp_confirmed_at: null, lp_confirmed_block: null, last_error: null,
};

const deposits: TreasuryDeposit[] = [
  { ...base, id: "0", amount: "20000000", lp_budget: "18000000", reserve: "1600000", community: "400000", status: "LpConfirmed",
    lp_shares: "1873120000000000000000000", lp_verified: true, usdc_in_lp: "8960000", wnear_in_lp: "2401000000000000000000000",
    dust_usdc: "12", dust_wnear: "7", unlock_at: t(-5), pool_id: 3001, lp_confirmed_at: t(-15), lp_confirmed_block: "277270100",
    created_at: t(-20), updated_at: t(-15) },
  { ...base, id: "1", amount: "5000000", lp_budget: "4500000", reserve: "400000", community: "100000",
    status: { SwapPending: { usdc: "4500000" } }, created_at: t(-2), updated_at: t(-1) },
  { ...base, id: "2", amount: "3000000", lp_budget: "2700000", reserve: "240000", community: "60000",
    status: { InRef: { usdc: "2700000" } }, last_error: "swap_failed", created_at: t(-40), updated_at: t(-39) },
];

const season = (id: number, status: Season["status"], progress: number, burned = 0): Season => ({
  id, start: t(-30 * (3 - id) - 30), end: t(-30 * (3 - id)), target_usdc: "10000000", progress_usdc: String(progress * 1_000_000),
  positions: progress ? 2 : 0, committed_creator: "0", committed_community: "0", status, burned: F(burned),
  level_after: status === "Open" ? null : id === 1 ? 0 : id === 0 ? 1 : 1, closed_at: status === "Open" ? null : t(-30 * (3 - id)),
});

const position0: FuelPosition = {
  position: { position_id: "0", creator_id: "demo-creator.testnet", vault_id: "demo-creator.testnet", pool_id: 3001,
    usdc_in_lp: "8960000", lp_shares: "1873120000000000000000000", confirmed_at: t(-15), confirmed_block: "277270100",
    unlock_at: t(-5), season_id: 3, reward_total: F(8.96), creator_reward: F(7.16), community_reward: F(1.8), claimed: false,
    ref_treasury_shares: "1873120000000000000000000", treasury_recorded_shares: "1873120000000000000000000" },
  reward_status: "Pending",
};

export function demoSnapshot(): Snapshot {
  return {
    source: "demo",
    deployed: { treasury: true, fuel: true },
    deposits,
    accounting: { total_received: "28000000", reserve_total: "2240000", community_total: "560000", pending_budget_total: "0",
      ref_expected_usdc: "7200012", ref_expected_wnear: "7", recorded_shares: "1873120000000000000000000", deposits_count: "3" },
    positions: { "0": position0, "1": null, "2": null },
    reactor: {
      level: 1, now: now.toString(), current_season_id: 3,
      current_season: { ...season(3, "Open", 8.96), committed_creator: F(7.16), committed_community: F(1.8), start: t(-20), end: t(10) },
      seasons_touched: [0, 1, 2, 3],
      // Same invariants as the contract: PoL buckets sum to 600 000, contract balance = sum of held buckets.
      buckets: { total_supply: F(999_990), contract_balance: F(650_965.2), pol_available: F(599_960.04), pol_committed: F(8.96),
        pol_distributed: F(24.8), community_reserve: F(6.2), burn_reserve: F(990), burned_total: F(10),
        team_locked: F(50_000), team_released: "0" },
      config: { season_duration_ns: (30n * MIN).toString(), season_target_usdc: "10000000", season_burn: F(10),
        vault_cap: F(2000), min_lock_ns: (10n * MIN).toString(), pool_id: 3001 },
    },
    seasons: [season(0, "Success", 12), season(1, "Failed", 3, 10), season(2, "Success", 19)],
    refTreasuryShares: "1873120000000000000000000",
  };
}

/** SIMULATED crosschain adapter until packages/crosschain (teammate) lands. Never touches a network. */
export const mockCrosschain: Pick<CrosschainClient, "watch"> = {
  async watch(depositAddress, onUpdate) {
    const steps = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"] as const;
    let last: BridgeResult = { status: "PENDING_DEPOSIT", depositAddress, solanaTxHashes: [], nearTxHashes: [] };
    for (const status of steps) {
      await new Promise((r) => setTimeout(r, 900));
      last = { ...last, status, amountIn: "20000000", amountOut: status === "SUCCESS" ? "19948000" : undefined,
        solanaTxHashes: status === "PENDING_DEPOSIT" ? [] : ["SIMULATED-solana-signature"],
        nearTxHashes: status === "SUCCESS" ? ["SIMULATED-near-tx"] : [] };
      onUpdate(last);
    }
    return last;
  },
};
