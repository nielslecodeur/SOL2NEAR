// V4.1 client side. Pool numbers are the LOCAL SANDBOX pool of docs/v4/sandbox-run.log (real Ref wasm, not testnet);
// the FUEL config is the one READ from fuel.sol2near-dev.testnet on 2026-11-14. Other inputs are SYNTHETIC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlanGuards, fuelEligibility, pilotDeployment, planV4, V41_PILOT, v4Calls, type PilotReads } from "./treasuryV4.ts";

const USDC = "usdc.test.near";
const POOL = { token_account_ids: [USDC, "s2nmeme.test.near"] as [string, string], amounts: ["1000000000", "1000000000000000000000000"] as [string, string], total_fee: 30 };
const NOW = 1_794_613_000_000_000_000n;
const G = V41_PILOT.guards;

test("planV4 reproduces the sandbox run against the real Ref wasm: swap 8973320, Ref get_return 8867071669659872053870", () => {
  const pv = planV4(POOL, USDC, 18_000_000n, NOW, { slippageBps: 50, ttlNs: 300n * 10n ** 9n });
  assert.equal(pv.swapUsdcIn, 8_973_320n);
  assert.equal(pv.expectedBaseOut, 8_867_071_669_659_872_053_870n);
  assert.equal(pv.plan.deadline_ns, (NOW + 300n * 10n ** 9n).toString());
  assert.ok(checkPlanGuards(pv, pv.expectedBaseOut, NOW, G).every((c) => c.ok), "a correct plan passes every guard");
});

test("guards mirror the contract: loose slippage, expired / too-far deadline, zero guard, excessive impact", () => {
  const pv = planV4(POOL, USDC, 18_000_000n, NOW, { slippageBps: 50, ttlNs: 300n * 10n ** 9n });
  const failed = (p: typeof pv, now = NOW) => checkPlanGuards(p, pv.expectedBaseOut, now, G).filter((c) => !c.ok).map((c) => c.id);
  assert.deepEqual(failed({ ...pv, plan: { ...pv.plan, min_swap_out: (pv.expectedBaseOut / 2n).toString() } }), ["swap_guard"]); // sandbox E2
  assert.deepEqual(failed(pv, NOW + 301n * 10n ** 9n), ["deadline"]);
  assert.deepEqual(failed({ ...pv, plan: { ...pv.plan, deadline_ns: (NOW + 11n * 60n * 10n ** 9n).toString() } }), ["ttl"]);
  assert.deepEqual(failed({ ...pv, plan: { ...pv.plan, min_amounts: ["0", pv.plan.min_amounts[1]] } }), ["nonzero", "add_guard"]);
  // 810 USDC budget in the 1 000 USDC sandbox pool (sandbox F2: the contract refused it on-chain)
  const big = planV4(POOL, USDC, 810_000_000n, NOW, { slippageBps: 50, ttlNs: 300n * 10n ** 9n });
  assert.ok(big.priceImpactBps > G.maxPriceImpactBps, `impact ${big.priceImpactBps} bps`);
  assert.deepEqual(checkPlanGuards(big, big.expectedBaseOut, NOW, G).filter((c) => !c.ok).map((c) => c.id), ["price_impact"]);
});

test("FUEL: the deployed config (treasury.sol2near-dev.testnet, pool 2951) makes V4 positions FUEL_NOT_ELIGIBLE", () => {
  const deployed = { treasury_id: "treasury.sol2near-dev.testnet", pool_id: 2951, min_lock_ns: "600000000000" };
  const e = fuelEligibility(deployed, V41_PILOT.treasuryId, 3001);
  assert.equal(e.status, "FUEL_NOT_ELIGIBLE");
  assert.match((e as { reason: string }).reason, /treasury\.sol2near-dev\.testnet/);
  assert.equal(BigInt(deployed.min_lock_ns), V41_PILOT.lockNs, "pilot lock = FUEL min_lock_ns");
  assert.equal(fuelEligibility({ ...deployed, treasury_id: V41_PILOT.treasuryId }, V41_PILOT.treasuryId, 2951).status, "FUEL_COMPATIBLE_CONFIG"); // SYNTHETIC future config
});

const reads = (accounts: Record<string, string | null>, cfg?: unknown, fail = false): PilotReads => ({
  async codeHash(id) { if (fail) throw new Error("every provider failed"); return accounts[id] ?? null; },
  async view<T>() { return cfg as T; },
});

test("deployment status from live reads: today NOT_DEPLOYED; READY only with the planned config and setup done; RPC failure is an error, not a status", async () => {
  assert.deepEqual(await pilotDeployment(reads({})), { state: "NOT_DEPLOYED", missing: [V41_PILOT.treasuryId, V41_PILOT.baseTokenId] });
  const both = { [V41_PILOT.treasuryId]: "h1", [V41_PILOT.baseTokenId]: "h2" };
  const cfg = (ready: boolean, base: string = V41_PILOT.baseTokenId) => ({ ready, config: { pool: { pool_id: 3001, base_token: base, usdc_token: V41_PILOT.usdcTokenId, dex: V41_PILOT.dex } } });
  assert.deepEqual(await pilotDeployment(reads(both, cfg(true))), { state: "READY", poolId: 3001 });
  assert.equal((await pilotDeployment(reads(both, cfg(false)))).state, "DEPLOYED_NOT_READY");
  assert.equal((await pilotDeployment(reads(both, cfg(true, "other.testnet")))).state, "DEPLOYED_NOT_READY");
  await assert.rejects(pilotDeployment(reads({}, undefined, true)), /every provider failed/);
});

test("calls are the exact contract calls, with 1 yocto where the contract asserts it", () => {
  const d = v4Calls.deposit(20_000_000n);
  assert.deepEqual([d.receiverId, d.methodName, d.args.receiver_id, d.args.msg, d.deposit], [V41_PILOT.usdcTokenId, "ft_transfer_call", V41_PILOT.treasuryId, '{"action":"deposit"}', 1n]);
  assert.equal(v4Calls.executeLp("0", null).gas, 300n * 10n ** 12n);
  for (const c of [v4Calls.withdrawLeftover("0", USDC), v4Calls.withdrawReserve(1n), v4Calls.withdrawBase(1n), v4Calls.withdrawLp("0")]) assert.equal(c.deposit, 1n, c.methodName);
  assert.deepEqual(v4Calls.mftRegister(3001, "alice.testnet").args, { token_id: ":3001", account_id: "alice.testnet" });
});
