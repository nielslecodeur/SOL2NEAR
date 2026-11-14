#!/usr/bin/env node
// G8 — READ-ONLY audit of Treasury V3 deposit #3 (the bridged funds) and of everything needed to finish its LP and FUEL
// steps. Public RPC view calls and tx-status queries only: no account, key, signature or transaction.
//   node scripts/probes/g8-audit.mjs [--json out.json]
import { writeFileSync } from "node:fs";

const RPC = ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org"];
const SOL_RPC = "https://api.devnet.solana.com";
const TREASURY = "treasury.sol2near-dev.testnet", FUEL = "fuel.sol2near-dev.testnet", REF = "ref-finance-101.testnet";
const USDC = "usdc.tidepool-sandbox.testnet", WNEAR = "wnear.tidepool-sandbox.testnet", CREATOR = "lowarena9362.testnet";
const TX = {
  "G7-SOL": "bGUicpgyYtePFP3BcEXYHQ9me67uqFjFQWmS8FsKWhYSzwpcVDv5SZyyLxYneLX93Bic4JZRFrWvphQUkEs887R",
  "G7-NEAR": ["J58H2uyuGo4wJsjbNuX1AEEwszD4Z8CMAppCqCirRFqf", "maker.tidepool-sandbox.testnet"],
  "G7-TREAS": ["J7uMjikj935TeunPoHj2i7xrCSSDrYEAmvdHv7DYBdhz", CREATOR],
};

async function rpc(method, params) {
  let last;
  for (const url of RPC) {
    try {
      const j = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
      if (j.result && !j.result.error) return j.result;
      last = j.error ?? j.result?.error;
    } catch (e) { last = e.message; }
  }
  throw new Error(JSON.stringify(last).slice(0, 300));
}
const view = async (account_id, method_name, args = {}) => {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
};
const out = { read_at: new Date().toISOString(), note: "READ-ONLY testnet / devnet reads for G8" };

// 1. chain clock, contracts
const block = await rpc("block", { finality: "final" });
out.block = { height: block.header.height, timestamp_ns: block.header.timestamp_nanosec };
for (const a of [TREASURY, FUEL]) out[`code_${a}`] = (await rpc("query", { request_type: "view_account", finality: "final", account_id: a })).code_hash;

// 2. Treasury: config, accounting, in-flight job, deposit #3 and all deposits of the creator
out.treasury_config = await view(TREASURY, "get_config");
out.accounting = await view(TREASURY, "get_accounting");
out.in_flight = await view(TREASURY, "get_in_flight");
out.deposit3 = await view(TREASURY, "get_deposit", { deposit_id: "3" });
out.creator_deposits = (await view(TREASURY, "get_creator_deposits", { creator: CREATOR })).map((d) => ({ id: d.id, status: d.status, amount: d.amount, lp_budget: d.lp_budget, lp_shares: d.lp_shares }));
out.creator_reserve = await view(TREASURY, "get_reserve", { creator: CREATOR });
out.last_proof = await view(TREASURY, "get_last_proof");

// 3. Ref: pool 2951, Treasury's shares and internal deposits, storage, whitelist
out.pool = await view(REF, "get_pool", { pool_id: 2951 });
out.ref_treasury_shares = await view(REF, "get_pool_shares", { pool_id: 2951, account_id: TREASURY });
out.ref_treasury_deposits = await view(REF, "get_deposits", { account_id: TREASURY });
out.ref_treasury_storage = await view(REF, "get_user_storage_state", { account_id: TREASURY }).catch((e) => `unreadable: ${e.message.slice(0, 80)}`);
out.ref_metadata = await view(REF, "metadata");

// 4. token balances (real holdings behind the books)
out.usdc_treasury = await view(USDC, "ft_balance_of", { account_id: TREASURY });
out.usdc_creator = await view(USDC, "ft_balance_of", { account_id: CREATOR });
out.wnear_treasury = await view(WNEAR, "ft_balance_of", { account_id: TREASURY });

// 5. FUEL: reactor, config, position #3, creator storage
out.reactor = await view(FUEL, "get_reactor");
out.fuel_position3 = await view(FUEL, "get_position", { position_id: "3" });
out.fuel_creator_storage = await view(FUEL, "storage_balance_of", { account_id: CREATOR });

// 6. the G7 transactions (final status and the amounts they moved)
for (const [k, v] of Object.entries(TX)) {
  if (k === "G7-SOL") {
    const j = await (await fetch(SOL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses", params: [[v], { searchTransactionHistory: true }] }) })).json();
    out[k] = j.result?.value?.[0] ?? null;
  } else {
    const r = await rpc("EXPERIMENTAL_tx_status", { tx_hash: v[0], sender_account_id: v[1], wait_until: "FINAL" });
    const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
    out[k] = { status: Object.keys(r.status)[0], final: r.final_execution_status, signer: r.transaction.signer_id, receiver: r.transaction.receiver_id,
      args: r.transaction.actions.map((a) => a.FunctionCall ? { method: a.FunctionCall.method_name, args: Buffer.from(a.FunctionCall.args, "base64").toString() } : Object.keys(a)[0]),
      events: logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice(11))).map((e) => ({ standard: e.standard, event: e.event, data: e.data })) };
  }
}
// 7. correlation Solana → Tidepool → NEAR: the Solana transfer itself, and Tidepool's own record of the deposit address
//    (its intent hashes must equal the intent_hash values emitted on-chain by the NEAR settlement tx)
const sol = await (await fetch(SOL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [TX["G7-SOL"], { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] }) })).json();
out["G7-SOL-transfer"] = sol.result?.transaction.message.instructions.filter((i) => i.parsed?.type === "transferChecked").map((i) => i.parsed.info) ?? null;
const DEPOSIT_ADDRESS = "5gUT7A3ZdqgnEe5eKTwQRBrwTcm3EJmNfRiCZTG2vNpU";
out.tidepool_status = await fetch(`https://www.usetidepool.tech/v0/status?depositAddress=${DEPOSIT_ADDRESS}`).then((r) => r.json()).catch((e) => `unreachable: ${e.message}`);
const onchainIntents = (out["G7-NEAR"].events ?? []).flatMap((e) => (e.data ?? []).map((d) => d.intent_hash)).filter(Boolean);
const tpIntents = out.tidepool_status?.swapDetails?.intentHashes ?? [];
out.correlation = {
  solana_tx_in_tidepool_record: JSON.stringify(out.tidepool_status).includes(TX["G7-SOL"]),
  near_tx_in_tidepool_record: (out.tidepool_status?.swapDetails?.nearTxHashes ?? []).includes(TX["G7-NEAR"][0]),
  intent_hashes_match_onchain_events: tpIntents.length > 0 && tpIntents.every((h) => onchainIntents.includes(h)),
  recipient: out.tidepool_status?.quoteResponse?.quoteRequest?.recipient ?? null,
};
const json = process.argv.indexOf("--json");
if (json > 0) writeFileSync(process.argv[json + 1], JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, (k, v) => (k === "events" ? v.map((e) => `${e.standard}:${e.event} ${JSON.stringify(e.data).slice(0, 220)}`) : v), 2));
