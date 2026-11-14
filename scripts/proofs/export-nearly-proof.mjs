#!/usr/bin/env node
// H2 — DETERMINISTIC export of the NEARLY DCL LOCAL SANDBOX proof. READ-ONLY: reads local files only, no network.
//   input : sandbox-tests/out/nearly_dcl_proof.raw.json (written by sandbox-tests/tests/v42_dcl.rs)
//           sandbox-tests/res/*.wasm, target/near/treasury-dcl/*.wasm, the mainnet read-only fixture
//   output: packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json (committed; shown by the Creator Portal)
//   --check: rebuild the export from a fresh run and compare it with the committed one (exit 1 on any difference).
// Time-dependent values (block heights, timestamps, deadlines) are replaced by "<sandbox-time>": everything else in a
// run is a pure function of the code and the scenario, so two runs from a clean clone give the same file.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const p = (f) => new URL(f, root);
const OUT = "packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json";
const RAW = "sandbox-tests/out/nearly_dcl_proof.raw.json";
if (!existsSync(p(RAW))) { console.error(`FAIL ${RAW} missing: run the sandbox first (bash scripts/proofs/nearly-proof.sh)`); process.exit(1); }

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(buf) {
  let n = BigInt("0x" + buf.toString("hex")), s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; s = "1" + s; }
  return s;
}
const TIME_KEYS = new Set(["at", "block", "created_at", "updated_at", "unlock_at", "deadline_ns", "confirmed_block", "last_progress_at"]);
const norm = (v) => Array.isArray(v) ? v.map(norm)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, TIME_KEYS.has(k) && x !== null ? "<sandbox-time>" : norm(x)]))
  : v;

// ---- provenance: the exact bytes the sandbox executed ----
const mainnet = JSON.parse(readFileSync(p("packages/near-client/src/fixtures/v42_dcl_mainnet_2026-11-14.json"), "utf8"));
const nearlyPool = mainnet.pools.find((x) => x.symbol === "NEARLY");
const wasm = (file, expectB58, source) => {
  const bytes = readFileSync(p(file));
  const h = createHash("sha256").update(bytes).digest();
  return { file, bytes: bytes.length, sha256: h.toString("hex"), code_hash_base58: base58(h), source,
    ...(expectB58 ? { expected_mainnet_code_hash: expectB58, identical_to_mainnet: base58(h) === expectB58 } : {}) };
};
const lock = readFileSync(p("sandbox-tests/Cargo.lock"), "utf8").replaceAll("\r\n", "\n");
const provenance = {
  mainnet_reference_read_at: mainnet.read_at,
  dcl: wasm("sandbox-tests/res/dcl_mainnet.wasm", mainnet.contracts["mainnet:dclv2.ref-labs.near"].code_hash, "view_code of dclv2.ref-labs.near (mainnet, Rhea DCL v2.4.2)"),
  nearly_token: wasm("sandbox-tests/res/nearly_token_raw_v1.wasm", nearlyPool.token_code.global, "view_global_contract_code: the global code that nearly-993927.nearlytrade.near runs (Nearly raw v1)"),
  wrap: wasm("sandbox-tests/res/wrap_near.wasm", mainnet.contracts["mainnet:wrap.near"].code_hash, "view_code of wrap.near (mainnet)"),
  usdc: wasm("sandbox-tests/res/tidepool_usdc.wasm", null, "view_code of usdc.tidepool-sandbox.testnet (testnet): a LOCAL stand-in for USDC"),
  tax_token: wasm("sandbox-tests/res/nearly_token_tax_v6.wasm", null, "Nearly tax v6 global code (used only to prove the BLOCKED_TAX refusal)"),
  treasury_dcl: { ...wasm("target/near/treasury-dcl/sol2near_treasury_dcl.wasm", null, "contracts/treasury-dcl built by scripts/build-wasm.sh (cargo-near 0.22.0, non-reproducible-wasm)"),
    note: "built locally: another machine or toolchain can produce different bytes with the same behaviour; --check reports it and compares the behaviour" },
  near_workspaces: lock.match(/name = "near-workspaces"\nversion = "([^"]+)"/)?.[1] ?? null,
  state: "fresh local neard sandbox from genesis (no forked mainnet or testnet state); every pool, balance and position is created by the scenario",
};

// ---- steps: a "call" opens a row; "refusal" and "rec" attach to the latest row of the same step ----
const raw = JSON.parse(readFileSync(p(RAW), "utf8"));
const steps = [];
const callOf = (e) => ({ contract: e.contract, method: e.method, args: norm(e.args), result: norm(e.result), proof: norm(e.proof) });
for (const e of raw) {
  const last = [...steps].reverse().find((s) => s.step === e.step);
  if (e.kind === "call") {
    steps.push({ step: e.step, what: e.what, outcome: e.outcome, ...(e.expected_error ? { expected_error: e.expected_error } : {}),
      ...(e.error ? { error: e.error } : {}), events: e.events ?? [], gas_tgas: e.gas_tgas ?? null, calls: [] });
  } else if (last) {
    if (e.kind === "refusal") Object.assign(last, { refused_on_chain: true, job_failed_reason: e.job_failed_reason });
    else last.calls.push(callOf(e));
  } else steps.push({ step: e.step, what: e.method, outcome: "view", events: [], gas_tgas: null, calls: [callOf(e)] });
}
const find = (s) => steps.find((x) => x.step === s);
const f1 = find("F1")?.calls[0];
const g3 = find("G3")?.calls[0];
const d1 = find("D1")?.calls[0]?.result;
const summary = {
  token_identity: provenance.nearly_token.identical_to_mainnet ? "the sandbox token runs byte-identical code to mainnet NEARLY (nearly-993927.nearlytrade.near); its state, supply and price are LOCAL" : "MISMATCH",
  dcl_identity: provenance.dcl.identical_to_mainnet ? "byte-identical to dclv2.ref-labs.near (mainnet) at the fixture read" : "MISMATCH",
  position: f1 ? { lpt_id: f1.result.lpt_id, owner_on_dcl: f1.proof.dcl_get_liquidity.owner_id, nft_owner: f1.proof.dcl_nft_token_owner, liquidity: f1.result.liquidity,
    range: [f1.result.left_point, f1.result.right_point], usdc_used: f1.result.usdc_used, position_x: f1.result.position_x, position_y: f1.result.position_y,
    leftover_x: f1.result.leftover_x, leftover_y: f1.result.leftover_y } : null,
  split_90_8_2: d1 ? { amount: d1.amount, lp_budget: d1.lp_budget, reserve: d1.reserve, community: d1.community } : null,
  test_fees_claimed: g3 ? { fee_x: g3.result.fee_x, fee_y: g3.result.fee_y, note: "from LOCAL test trades; not a forecast, not an APY" } : null,
  final_owner_after_exit: find("H3")?.calls[0]?.result?.dcl_nft_token_owner ?? null,
  recovered: (() => { const r = find("R")?.calls.find((c) => c.method === "get_deposit")?.result; return r ? { x: r.recovered_x, y: r.recovered_y, status: r.status } : null; })(),
  books_equal_real_balances_checks: steps.filter((s) => s.what?.startsWith("books = real balances")).map((s) => s.step),
  refusals: steps.filter((s) => s.outcome === "failure" || s.refused_on_chain).map((s) => ({ step: s.step, why: s.job_failed_reason ?? s.error })),
};
const doc = {
  label: "LOCAL SANDBOX",
  title: "NEARLY DCL position — LOCAL SANDBOX proof (real Rhea DCL v2.4.2 code, NEARLY's token code, local state, test tokens with no value)",
  not: ["not mainnet", "not testnet", "no public transaction", "not a NEARLY mainnet position", "fees are test fees, not a forecast"],
  reproduce: "bash scripts/proofs/nearly-proof.sh   (Linux / WSL: fetch code read-only, build TreasuryDCL, run the sandbox, export --check)",
  scenario: "sandbox-tests/tests/v42_dcl.rs",
  accounts_note: "rawmeme.test.near = the LOCAL token deployed from NEARLY's code (named RAWMEME in the scenario); wrap.test.near = wNEAR code; usdc.test.near = USDC stand-in; dcl.test.near = Rhea DCL code; treasury-dcl.test.near = SOL2NEAR TreasuryDCL; alice = creator; bob = attacker; lp / trader = local market makers",
  provenance, summary, steps,
};

if (process.argv.includes("--check")) {
  if (!existsSync(p(OUT))) { console.error(`FAIL ${OUT} missing`); process.exit(1); }
  const committed = JSON.parse(readFileSync(p(OUT), "utf8"));
  const tdOld = committed.provenance.treasury_dcl, tdNew = doc.provenance.treasury_dcl;
  const cmp = (d) => JSON.stringify({ ...d, provenance: { ...d.provenance, treasury_dcl: null } }, (k, v) => (k === "gas_tgas" ? undefined : v));
  const same = cmp(committed) === cmp(doc);
  console.log(`TreasuryDCL wasm: ${tdNew.sha256 === tdOld.sha256 ? "IDENTICAL to the committed build" : `DIFFERENT BUILD (${tdNew.sha256.slice(0, 12)}… vs committed ${tdOld.sha256.slice(0, 12)}…): behaviour compared below`}`);
  const gasDiff = doc.steps.filter((s, i) => committed.steps[i] && s.gas_tgas !== committed.steps[i].gas_tgas).length;
  console.log(`gas: ${gasDiff} step(s) differ (informative only)`);
  for (const [k, v] of Object.entries(provenance)) if (v && typeof v === "object" && "identical_to_mainnet" in v) console.log(`${v.identical_to_mainnet ? "PASS" : "FAIL"} ${k} code = mainnet ${v.expected_mainnet_code_hash}`);
  if (!same) {
    const a = cmp(committed), b = cmp(doc);
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log(`first difference near: …${a.slice(Math.max(0, i - 120), i + 80)}…\n   fresh run: …${b.slice(Math.max(0, i - 120), i + 80)}…`);
  }
  console.log(same ? `PASS export identical to the committed ${OUT} (${doc.steps.length} steps)` : `FAIL export differs from the committed ${OUT}`);
  process.exit(same && provenance.dcl.identical_to_mainnet && provenance.nearly_token.identical_to_mainnet ? 0 : 1);
}
writeFileSync(p(OUT), JSON.stringify(doc, null, 2) + "\n");
console.log(`written ${OUT}: ${doc.steps.length} steps · NEARLY code = mainnet: ${provenance.nearly_token.identical_to_mainnet} · DCL code = mainnet: ${provenance.dcl.identical_to_mainnet}`);
