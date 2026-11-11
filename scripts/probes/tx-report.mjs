#!/usr/bin/env node
// READ-ONLY: status, gas burnt, NEAR spent, every receipt, logs and NEAR transfers (refunds) of a tx.
// Usage: node scripts/probes/tx-report.mjs <tx_hash> <signer_account_id>
const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
const [hash, signer] = process.argv.slice(2);
if (!hash || !signer) throw new Error("usage: tx-report.mjs <tx_hash> <signer>");

const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: "t", method: "EXPERIMENTAL_tx_status", params: { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" } }) });
const j = await r.json();
if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 300));
const res = j.result;
const near = (y) => (Number(BigInt(y) / 10n ** 15n) / 1e9).toFixed(9);

const outcomes = [res.transaction_outcome, ...res.receipts_outcome];
const gasBurnt = outcomes.reduce((s, o) => s + BigInt(o.outcome.gas_burnt), 0n);
const tokensBurnt = outcomes.reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), 0n);
const failures = res.receipts_outcome.filter((o) => o.outcome.status.Failure).map((o) => ({ executor: o.outcome.executor_id, failure: JSON.stringify(o.outcome.status.Failure).slice(0, 300) }));

const receipts = [];
for (const rc of res.receipts ?? []) {
  for (const a of rc.receipt?.Action?.actions ?? []) {
    if (a === "CreateAccount") continue;
    if (a.FunctionCall) receipts.push({ from: rc.predecessor_id, to: rc.receiver_id, call: a.FunctionCall.method_name, deposit_near: near(a.FunctionCall.deposit) });
    else if (a.Transfer) receipts.push({ from: rc.predecessor_id, to: rc.receiver_id, transfer_near: near(a.Transfer.deposit), refund: rc.predecessor_id === "system" });
  }
}
const logs = outcomes.flatMap((o) => o.outcome.logs.map((l) => `${o.outcome.executor_id}: ${l}`));

console.log(JSON.stringify({
  hash, explorer: `https://testnet.nearblocks.io/txns/${hash}`,
  status: res.status.SuccessValue !== undefined ? "SUCCESS" : res.status.Failure ? "FAILURE" : JSON.stringify(res.status),
  return_value: res.status.SuccessValue ? Buffer.from(res.status.SuccessValue, "base64").toString() : null,
  gas_burnt_tgas: Number(gasBurnt) / 1e12, near_burnt_for_gas: near(tokensBurnt),
  receipt_failures: failures, receipts, logs,
}, null, 2));
