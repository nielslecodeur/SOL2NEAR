#!/usr/bin/env node
// READ-ONLY: re-checks every G6/G7 proof listed in the README against public RPC (NEAR testnet + Solana devnet).
// For each NEAR tx: final status, signer, receiver, first method, and the Treasury/FUEL events it emitted.
// Usage: node scripts/probes/verify-g6-g7.mjs
const NEAR = ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"];
const SOLANA = "https://api.devnet.solana.com";

const NEAR_TX = [
  ["G6-D", "FaBKjLRUuYMgH4SgVgurTyUinDPvPvdH5Rxc69X1haHV", "lowarena9362.testnet", "SUCCESS"],
  ["G6-LP", "CniqxoxZ5qzJBLZ9RCwJ9nH4evbNwaGV6Y1nE4aDbRdN", "lowarena9362.testnet", "SUCCESS"],
  ["G6-REJ", "3HsEr7b3Mr1zYLmLi3q6ApgcthXarUTwe9tg5xxXQRzF", "lowarena9362.testnet", "SUCCESS"], // tx ok, FUEL emits position_rejected
  ["G6-D2", "DmbsT6ce7U9GPqVZYPgv2Kc5hmMn8cNeYKKDq8u1g9Gi", "lowarena9362.testnet", "SUCCESS"],
  ["G6-LP2", "CundGCKWCSnC14tTRkaJ8EiRzDRttQvhQ3SjFgfTpHyD", "lowarena9362.testnet", "SUCCESS"],
  ["G6-REG2", "SrFHSmHCx41j2ytekUvZhV5sX4AHkSsQCrBNLZbsghM", "lowarena9362.testnet", "SUCCESS"],
  ["G6-FUELSTO", "DntEzzYDmLsznGpMEyDcW9Q872Y7azKT6NMqzv3GPQFg", "lowarena9362.testnet", "SUCCESS"],
  ["G6-CLOSE", "ELiyFHpWnJSMrQamjP1cxYZsRXnUNBg5t32r1nMjAy3s", "lowarena9362.testnet", "SUCCESS"],
  ["G6-CLAIM", "8CRvXVJgk7sEiapJZSYiiFhhMRANPxZL9rGmAsFsA7F8", "lowarena9362.testnet", "SUCCESS"],
  ["G7-NEAR", "J58H2uyuGo4wJsjbNuX1AEEwszD4Z8CMAppCqCirRFqf", "maker.tidepool-sandbox.testnet", "SUCCESS"],
  ["G7-TREAS", "J7uMjikj935TeunPoHj2i7xrCSSDrYEAmvdHv7DYBdhz", "lowarena9362.testnet", "SUCCESS"],
];
const SOL_TX = [["G7-SOL", "bGUicpgyYtePFP3BcEXYHQ9me67uqFjFQWmS8FsKWhYSzwpcVDv5SZyyLxYneLX93Bic4JZRFrWvphQUkEs887R"]];

async function nearTx(hash, signer) {
  let last;
  for (const url of NEAR) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" } }) });
      const j = await r.json();
      if (j.result) return j.result;
      last = JSON.stringify(j.error).slice(0, 160);
    } catch (e) { last = e.message; }
  }
  throw new Error(last);
}

let bad = 0;
for (const [label, hash, signer, want] of NEAR_TX) {
  try {
    const r = await nearTx(hash, signer);
    const status = r.status.SuccessValue !== undefined ? "SUCCESS" : r.status.Failure ? "FAILURE" : "?";
    const call = r.transaction.actions.find((a) => a.FunctionCall)?.FunctionCall.method_name ?? "?";
    const events = r.receipts_outcome.flatMap((o) => o.outcome.logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => {
      const e = JSON.parse(l.slice(11)); return `${o.outcome.executor_id.split(".")[0]}:${e.event}`;
    }));
    const ok = status === want;
    if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label.padEnd(10)} ${status} ${r.transaction.signer_id} -> ${r.transaction.receiver_id}.${call}  [${[...new Set(events)].join(", ")}]`);
  } catch (e) { bad++; console.log(`FAIL ${label} ${e.message}`); }
}
for (const [label, sig] of SOL_TX) {
  const r = await fetch(SOLANA, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses", params: [[sig], { searchTransactionHistory: true }] }) });
  const s = (await r.json()).result?.value?.[0];
  const ok = s && !s.err && s.confirmationStatus === "finalized";
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label.padEnd(10)} solana devnet slot ${s?.slot} ${s?.confirmationStatus} err=${JSON.stringify(s?.err)}`);
}
console.log(bad ? `${bad} check(s) failed` : "all G6/G7 proofs re-verified");
process.exit(bad ? 1 : 0);
