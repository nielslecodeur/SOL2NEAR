// Pipeline states from SYNTHETIC inputs (shapes of real views / records); no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TreasuryDeposit } from "../../../../packages/shared/src/treasury.ts";
import type { TransferRecord } from "../../../../packages/crosschain/src/store.ts";
import type { FuelPosition } from "../chain.ts";
import { pipeline, type PipelineInput } from "./pipeline.ts";

const DEV = "sol2near-dev.testnet";
const base: PipelineInput = { accountId: DEV, transfer: null, tidepoolReachable: null, usdcBalance: 0n, deposit: null, openTx: [], treasuryBusy: false, position: null };
const states = (i: Partial<PipelineInput>) => Object.fromEntries(pipeline({ ...base, ...i }).map((s) => [s.name, s.state]));
const detail = (i: Partial<PipelineInput>, name: string) => pipeline({ ...base, ...i }).find((s) => s.name === name)!.detail;

const dep = (over: Partial<TreasuryDeposit> = {}): TreasuryDeposit => ({
  id: "0", creator: DEV, amount: "20000000", lp_budget: "18000000", reserve: "1600000", community: "400000",
  status: "BudgetAllocated", plan: null, lp_shares: "0", lp_verified: false, usdc_swapped: "0", usdc_in_lp: "0", wnear_in_lp: "0",
  dust_usdc: "0", dust_wnear: "0", unlock_at: null, pool_id: null, lp_confirmed_at: null, lp_confirmed_block: null, last_error: null,
  created_at: "0", updated_at: "0", ...over,
});
const lpDone = dep({ status: "LpConfirmed", lp_verified: true, usdc_in_lp: "9676812", pool_id: 2951, lp_shares: "165640253516145704019022" });
const transfer = (stage: TransferRecord["stage"], extra: Partial<TransferRecord> = {}): TransferRecord => ({
  depositAddress: "D", payer: "P", stage, updatedAt: 0,
  quote: { correlationId: "c", dry: false, amountIn: "1000000", amountOut: "997400", minAmountOut: "987426", timeEstimateSec: 60, signature: "s", nearRecipient: DEV },
  ...extra,
});
const pos = (reward_status: FuelPosition["reward_status"]) => ({ reward_status, position: { season_id: 0 } }) as unknown as FuelPosition;

test("no wallet: nothing is ready", () => {
  assert.deepEqual(states({ accountId: null, usdcBalance: null }), { Bridge: "NOT_STARTED", Receive: "NOT_STARTED", Deposit: "NOT_STARTED", Liquidity: "NOT_STARTED", FUEL: "NOT_STARTED" });
});

test("path A: USDC already on NEAR -> deposit READY, origin not claimed to be Solana", () => {
  assert.deepEqual(states({ usdcBalance: 29_900_000n }), { Bridge: "NOT_STARTED", Receive: "READY", Deposit: "READY", Liquidity: "NOT_STARTED", FUEL: "NOT_STARTED" });
  assert.match(detail({ usdcBalance: 1n }, "Receive"), /origin of these funds is not proven to be Solana/);
});

test("Tidepool unreachable -> Bridge BLOCKED, path A still usable", () => {
  const s = states({ tidepoolReachable: false, usdcBalance: 5_000_000n });
  assert.equal(s.Bridge, "BLOCKED");
  assert.equal(s.Deposit, "READY");
});

test("bridge done but Treasury deposit not executed: Receive CONFIRMED, Deposit READY (not CONFIRMED)", () => {
  const s = states({ transfer: transfer("near_verified", { nearReceived: "997400" }), usdcBalance: 997_400n });
  assert.deepEqual([s.Bridge, s.Receive, s.Deposit], ["CONFIRMED", "CONFIRMED", "READY"]);
});

test("Tidepool SUCCESS but amount not (yet) seen on NEAR -> Receive PENDING, deposit not offered from the bridge", () => {
  const s = states({ transfer: transfer("bridge_success") });
  assert.deepEqual([s.Bridge, s.Receive, s.Deposit], ["CONFIRMED", "PENDING", "NOT_STARTED"]);
});

test("refund and failures are FAILED, with the refunded amount", () => {
  assert.equal(states({ transfer: transfer("bridge_refunded", { result: { status: "REFUNDED", depositAddress: "D", solanaTxHashes: [], nearTxHashes: [], refundedAmount: "1000000" } }) }).Bridge, "FAILED");
  assert.match(detail({ transfer: transfer("bridge_refunded", { result: { status: "REFUNDED", depositAddress: "D", solanaTxHashes: [], nearTxHashes: [], refundedAmount: "1000000" } }) }, "Bridge"), /Refunded to Solana: 1 USDC/);
  assert.equal(states({ transfer: transfer("solana_failed") }).Bridge, "FAILED");
});

test("interrupted / in-flight transfer is PENDING (resumable after reload)", () => {
  assert.equal(states({ transfer: transfer("signing") }).Bridge, "PENDING");
  assert.equal(states({ transfer: transfer("solana_confirmed") }).Bridge, "PENDING");
});

test("deposit pending while its tx is unresolved; counted deposit is CONFIRMED", () => {
  const open = [{ id: "x", kind: "deposit" as const, accountId: DEV, createdAt: 0, updatedAt: 0, status: "submitted" as const }];
  assert.equal(states({ usdcBalance: 1n, openTx: open }).Deposit, "PENDING");
  assert.deepEqual(states({ deposit: dep() }), { Bridge: "NOT_STARTED", Receive: "NOT_STARTED", Deposit: "CONFIRMED", Liquidity: "READY", FUEL: "NOT_STARTED" });
});

test("liquidity: busy Treasury BLOCKED, error FAILED (resumable), in-flight PENDING, confirmed CONFIRMED", () => {
  assert.equal(states({ deposit: dep(), treasuryBusy: true }).Liquidity, "BLOCKED");
  assert.equal(states({ deposit: dep({ last_error: "swap_failed" }) }).Liquidity, "FAILED");
  assert.equal(states({ deposit: dep({ status: { SwapPending: { usdc: "1" } } }) }).Liquidity, "PENDING");
  assert.equal(states({ deposit: lpDone }).Liquidity, "CONFIRMED");
});

test("FUEL: register READY, Pending is not earned, Claimable READY, Claimed CONFIRMED, Forfeited FAILED", () => {
  assert.equal(states({ deposit: lpDone }).FUEL, "READY");
  assert.equal(states({ deposit: { ...lpDone, lp_verified: false } }).FUEL, "BLOCKED");
  assert.equal(states({ deposit: lpDone, position: pos("Pending") }).FUEL, "PENDING");
  assert.match(detail({ deposit: lpDone, position: pos("Pending") }, "FUEL"), /not earned until the season closes/);
  assert.equal(states({ deposit: lpDone, position: pos("Claimable") }).FUEL, "READY");
  assert.equal(states({ deposit: lpDone, position: pos("Claimed") }).FUEL, "CONFIRMED");
  assert.equal(states({ deposit: lpDone, position: pos("Forfeited") }).FUEL, "FAILED");
});

// ---- FUEL window (same rules as contracts/fuel: season_of, register deadline, close_season settle) ----
import { fuelWindow } from "./pipeline.ts";

// Real calendar of fuel.sol2near-dev.testnet (get_reactor().config, read 2026-11-13)
const CAL = { genesis_ns: "1794469742578932153", season_duration_ns: "1800000000000", registration_grace_ns: "300000000000" };
const S = 1_000_000_000n;

test("fuelWindow: deposit #1 (LP confirmed 17:36:53 UTC) is in season 67, deadline 17:54:02, close from 17:55:02", () => {
  const w = fuelWindow("1794591413804000000", CAL); // 2026-11-13T17:36:53.804Z
  assert.equal(w.seasonId, 67);
  assert.equal(new Date(Number(w.seasonEnd / 1_000_000n)).toISOString(), "2026-11-13T17:49:02.578Z");
  assert.equal(new Date(Number(w.registerDeadline / 1_000_000n)).toISOString(), "2026-11-13T17:54:02.578Z");
  assert.equal(new Date(Number(w.closeFrom / 1_000_000n)).toISOString(), "2026-11-13T17:55:02.578Z");
  assert.equal(fuelWindow("1794469795010314429", CAL).seasonId, 0); // G2 C2 position: season 0 (real)
});

test("register: READY with a countdown inside the window, FAILED once it closed (no guess)", () => {
  const confirmed = dep({ status: "LpConfirmed", lp_verified: true, usdc_in_lp: "904526", pool_id: 2951, lp_confirmed_at: "1794591413804000000" });
  const w = fuelWindow(confirmed.lp_confirmed_at!, CAL);
  const before = pipeline({ ...base, deposit: confirmed, calendar: CAL, nowNs: w.registerDeadline - 125n * S }).find((s) => s.name === "FUEL")!;
  assert.equal(before.state, "READY");
  assert.match(before.detail, /Register before 17:54:02 UTC \(2m 5s left\).*season 67/);
  const after = pipeline({ ...base, deposit: confirmed, calendar: CAL, nowNs: w.registerDeadline }).find((s) => s.name === "FUEL")!;
  assert.equal(after.state, "FAILED");
  assert.match(after.detail, /ERR_REGISTRATION_WINDOW_CLOSED/);
});

test("close season: PENDING until end + grace + 60 s, then READY with the outcome it will settle", () => {
  const confirmed = dep({ status: "LpConfirmed", lp_verified: true, usdc_in_lp: "5590822", pool_id: 2951, lp_confirmed_at: "1794591413804000000" });
  const w = fuelWindow(confirmed.lp_confirmed_at!, CAL);
  const position = { reward_status: "Pending", position: { season_id: 67, confirmed_at: confirmed.lp_confirmed_at } } as unknown as FuelPosition;
  const season = { id: 67, status: "Open", progress_usdc: "5590822", target_usdc: "5000000" } as never;
  const at = (nowNs: bigint) => pipeline({ ...base, deposit: confirmed, position, positionSeason: season, calendar: CAL, nowNs }).find((s) => s.name === "FUEL")!;
  assert.equal(at(w.closeFrom - S).state, "PENDING");
  assert.match(at(w.closeFrom - S).detail, /close possible from 17:55:02 UTC/);
  assert.equal(at(w.closeFrom).state, "READY");
  assert.match(at(w.closeFrom).detail, /settle it as SUCCESS/);
  const failing = pipeline({ ...base, deposit: confirmed, position, positionSeason: { ...(season as object), progress_usdc: "904526" } as never, calendar: CAL, nowNs: w.closeFrom }).find((s) => s.name === "FUEL")!;
  assert.match(failing.detail, /settle it as FAILED/);
});
