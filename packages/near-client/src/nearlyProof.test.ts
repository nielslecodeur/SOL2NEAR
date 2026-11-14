// H2 — invariants of the COMMITTED NEARLY DCL LOCAL SANDBOX proof export (written by scripts/proofs/export-nearly-proof.mjs
// from a real sandbox run of sandbox-tests/tests/v42_dcl.rs) and of the recorded mainnet reference simulation.
// An edited JSON that no longer says what the run proved fails here; the run itself is re-checked by `pnpm proof:nearly`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEARLY_DCL_CANDIDATES, splitV4 } from "./index.ts";

const proof = JSON.parse(readFileSync(new URL("./fixtures/nearly_dcl_sandbox_proof.json", import.meta.url), "utf8"));
const sim = JSON.parse(readFileSync(new URL("./fixtures/nearly_reference_sim.json", import.meta.url), "utf8"));
const nearly = NEARLY_DCL_CANDIDATES.find((c) => c.key === "dcl:nearly")!;
const step = (s: string) => proof.steps.find((x: { step: string }) => x.step === s);

test("labelled LOCAL SANDBOX and never presented as a public-network result", () => {
  assert.equal(proof.label, "LOCAL SANDBOX");
  for (const n of ["not mainnet", "not testnet", "no public transaction"]) assert.ok(proof.not.includes(n));
  assert.ok(!JSON.stringify(proof).match(/1794\d{15}/), "time-dependent values are normalised");
});

test("code provenance: the sandbox ran NEARLY's token code and the Rhea DCL code byte for byte", () => {
  assert.equal(proof.provenance.nearly_token.code_hash_base58, nearly.tokenCodeHash);
  assert.equal(proof.provenance.nearly_token.identical_to_mainnet, true);
  assert.equal(proof.provenance.dcl.identical_to_mainnet, true);
  assert.equal(proof.provenance.nearly_token.sha256, "47d7973b0a3bf97a5008f03c7caf15d02fc05ac0c34c1878bdf7ebabf6857fc9"); // = Nearly README
});

test("position: created by the HotZap, owned by TreasuryDCL on the DCL, liquidity and range as recorded", () => {
  const f1 = step("F1").calls[0];
  assert.equal(step("F1").outcome, "success");
  assert.equal(f1.proof.dcl_get_liquidity.owner_id, "treasury-dcl.test.near");
  assert.equal(f1.proof.dcl_nft_token_owner, "treasury-dcl.test.near");
  assert.equal(f1.proof.dcl_get_liquidity.amount, f1.result.liquidity);
  assert.ok(BigInt(f1.result.liquidity) > 0n);
  assert.deepEqual([f1.proof.dcl_get_liquidity.left_point, f1.proof.dcl_get_liquidity.right_point], [f1.args.plan.left_point, f1.args.plan.right_point]);
  const d = f1.proof.treasury_get_deposit;
  assert.equal(BigInt(d.usdc_used) + BigInt(d.usdc_unused_to_reserve), BigInt(d.lp_budget));
});

test("90/8/2 on the 20 USDC deposit = the client rule", () => {
  const s = proof.summary.split_90_8_2;
  const r = splitV4(BigInt(s.amount));
  assert.deepEqual([s.lp_budget, s.reserve, s.community], [r.lp, r.reserve, r.community].map(String));
});

test("fees: claim = the DCL's unclaimed fees, second claim 0, out of range 0", () => {
  assert.deepEqual([step("G3").calls[0].result.fee_x, step("G3").calls[0].result.fee_y], [step("G1").calls[0].result.unclaimed_fee_x, step("G1").calls[0].result.unclaimed_fee_y]);
  assert.deepEqual([step("G4").calls[0].result.fee_x, step("G4").calls[0].result.fee_y], ["0", "0"]);
  assert.deepEqual(step("K5").calls[0].result.narrow_unclaimed, ["0", "0"]);
});

test("lock, exit, no double exit, no double recovery; books = real balances six times", () => {
  for (const [s, err] of [["H1", "ERR_POSITION_LOCKED"], ["H2", "ERR_NOT_CREATOR"], ["H4", "ERR_NO_CONFIRMED_POSITION"], ["H5", "ERR_NO_CONFIRMED_POSITION"], ["J3", "ERR_NOTHING_TO_WITHDRAW"], ["G2", "ERR_NOT_CREATOR"], ["E1", "ERR_NOT_CREATOR"]] as const) {
    assert.equal(step(s).outcome, "failure", s);
    assert.ok(step(s).error.includes(err), `${s}: ${step(s).error}`);
  }
  assert.equal(step("H3").calls[0].result.dcl_nft_token_owner, "alice.test.near");
  assert.equal(step("H7").calls[0].result, null);
  assert.deepEqual(proof.summary.books_equal_real_balances_checks, ["E5", "F2", "F7", "G5", "K6", "R"]);
  assert.equal(proof.summary.recovered.status, "PositionWithdrawn");
});

test("recorded mainnet reference simulation: one block, the real NEARLY pool, outputs consistent with the plan", () => {
  assert.equal(sim.pool_id, nearly.poolId);
  assert.equal(sim.dex, nearly.dex);
  assert.ok(Number.isInteger(sim.block_height) && sim.block_height > 0);
  assert.equal(BigInt(sim.plan.usdc_to_x) + BigInt(sim.plan.usdc_to_y), BigInt(sim.split_90_8_2.lp_budget));
  assert.ok(BigInt(sim.prediction.need_x) <= BigInt(sim.prediction.out_x) && BigInt(sim.prediction.need_y) <= BigInt(sim.prediction.out_y));
  assert.ok(sim.range.left_point < sim.pool.current_point && sim.pool.current_point < sim.range.right_point);
});
