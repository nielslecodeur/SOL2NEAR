# G2 — Execution log, Batch A (NEAR testnet)

Status: **pre-flight done. Batch A NOT started.** It waits for the lead's message
« FAUCET FAIT + OK BATCH A ». A5 (deliberate failure) is excluded by decision of the lead.

Tools (read-only):
- `node scripts/probes/g2-state.mjs [pool_id]` shows balances, storage, the dev's internal Ref
  deposits and pool state;
- `node scripts/probes/tx-report.mjs <hash> sol2near-dev.testnet` shows status, return value,
  gas burnt, NEAR burnt, receipts, refunds and logs.

## 1. Pre-flight (2026-11-11, block 277277218, read-only)

| Check | Result |
|---|---|
| `sol2near-dev.testnet` NEAR | 4.992885010 |
| `sol2near-dev` USDC (`usdc.tidepool-sandbox.testnet`, 6 dec.) | **0**: faucet not claimed yet |
| `sol2near-dev` wNEAR (`wnear.tidepool-sandbox.testnet`, 24 dec.) | **0**: faucet not claimed yet |
| Ref contract | `ref-finance-101.testnet` v1.9.19, `Running`, 2 951 pools |
| Equivalent pool | none (full scan; re-checked right before A8) |
| Ref registered on USDC / wNEAR | no / no |
| `sol2near-dev` on Ref | storage `null`, registered tokens `[]`, deposits `{}` |
| Tool self-test | `tx-report.mjs` on `bi1cErW2…eCma`: SUCCESS, 8.57 Tgas, refund receipt detected |

## 2. Planned sequence and spending caps (from `docs/G2_READINESS.md` §6)

| Tx | Call (signer `sol2near-dev.testnet`) | Attached | Cap |
|---|---|---|---|
| A1 | `usdc.tidepool-sandbox.testnet.storage_deposit({account_id: ref, registration_only: true})` | 0.00125 NEAR | — |
| A2 | `wnear.tidepool-sandbox.testnet.storage_deposit(same)` | 0.00125 NEAR | — |
| A3 | `ref-finance-101.testnet.storage_deposit({account_id: dev, registration_only: false})` | 0.1 NEAR | — |
| A4 | `ref.register_tokens({token_ids: [usdc, wnear]})` | 1 yocto | — |
| A6 | `usdc.ft_transfer_call({receiver_id: ref, amount: "50000000", msg: ""})` | 1 yocto | 50 USDC |
| A7 | `wnear.ft_transfer_call({receiver_id: ref, amount: <50 USDC at the live Tidepool price>, msg: ""})` | 1 yocto | ≈ 13.44 wNEAR; stop if the price implies > 15 |
| A8 | `ref.add_simple_pool({tokens: [usdc, wnear], fee: 30})` (after re-checking no pool exists) | 0.1 NEAR | pool id = **return value** |
| A9 | `ref.add_liquidity({pool_id, amounts, min_amounts: 99 %})` | 0.01 NEAR | — |
| A10 | `usdc.ft_transfer_call(ref, "100000", "")` then `ref.swap(0.1 USDC → wNEAR, min 1)` | 1 yocto each | 0.1 USDC |

Total cap: **0.215 NEAR attached + gas (expected < 0.02 NEAR)**. Any material deviation means
stopping and asking for a new approval. A failed A8 is never retried automatically.

## 3. Execution

_Not started._
