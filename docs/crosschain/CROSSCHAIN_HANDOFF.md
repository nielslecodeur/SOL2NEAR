# CROSSCHAIN HANDOFF — checkpoint B1

Date: 2026-11-13. Author: the project lead (solo since 2026-11-13: the planned teammate did not join, so the lead took over B1).
Tidepool is a **community 1Click-compatible sandbox, not the official NEAR Intents service**. Testnet / devnet only.

## 1. Working

- `packages/crosschain`: TypeScript client implementing `CrosschainClient` (`packages/shared/src/crosschain.ts`) unchanged, plus `tokens`, `assertRouteSupported`, `status`, `deposit`.
- Local validation of every input (atomic integer amounts, Solana base58, NEAR account id, slippage, deadline) before any request.
- The quote body is the one verified live on 2026-11-11. Responses are validated (EXACT_INPUT amount echo, `minAmountOut ≤ amountOut`, dry ⇔ no deposit address).
- An unsigned Solana Devnet SPL deposit transaction (ATA create-idempotent + `transferChecked`, classic SPL Token program verified on-chain). It is decoded and signed in tests.
- Status polling with change-only updates, terminal detection, transient-error tolerance and abort support.
- Double-execution guard on `deposit` and `submitDeposit`. Typed errors.

## 2. Not finished

- **No live call has succeeded from this package**: Tidepool did not resolve on 2026-11-13 (see `FEASIBILITY.md` §4).
- No real Solana → NEAR transfer has been executed (it needs approval, a Devnet wallet, faucet USDC and SOL for fees).
- The web dashboard still uses the SIMULATED adapter (`apps/web/src/demo.ts`).
- The Tidepool quote signature is not verified (key not published).

## 3. Tidepool routes verified

Solana Devnet USDC → NEAR testnet USDC: dry quote ✅ 2026-11-11 (correlationId `e1b46370-990b-4c9b-ae72-a2223607d2be`). The live route has not been run.

## 4. Token ids and decimals

| Leg | Asset id | Address | Decimals |
|---|---|---|---|
| Solana Devnet USDC (Tidepool mint) | `nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet` | mint `7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr` (SPL Token) | 6 |
| NEAR testnet USDC | `nep141:usdc.tidepool-sandbox.testnet` | `usdc.tidepool-sandbox.testnet` | 6 |

## 5. Exported functions

See [`INTERFACE.md`](INTERFACE.md).

## 6. Integration

See [`packages/crosschain/examples/integration.ts`](../../packages/crosschain/examples/integration.ts) (Phantom adapter + full path).
After `SUCCESS` the USDC is on the **user's** NEAR account (T9). The user then signs
`usdc.tidepool-sandbox.testnet.ft_transfer_call({receiver_id: "treasury.sol2near-dev.testnet", amount, msg: "{\"action\":\"deposit\"}"})`.
That call was proven on-chain in G2 C1 (`AsD2o2aV…ZWzw`).

## 7. Dependencies

Runtime: `@solana/web3.js` 1.98.4, `@solana/spl-token` 0.4.14. Dev: TypeScript 5.6.3, @types/node 22.10.2, Node's built-in test runner (Node ≥ 22.6 runs `.ts` directly).

## 8. Tests

`pnpm --filter @sol2near/crosschain test` → **21 passed, 0 failed** (mocked Tidepool and Solana RPC). They cover:
- valid dry and live quotes;
- an expired quote;
- an insufficient amount, rejected locally and as a Tidepool 400, plus an insufficient balance;
- an unsupported token;
- invalid addresses;
- network and 5xx errors;
- a wallet rejection, and a wallet error that is not retried;
- pending, success, failed and refunded statuses, plus an unknown status;
- polling retries and abort;
- a repeated deposit or submit without double execution;
- the decoded Solana transaction.

`pnpm --filter @sol2near/crosschain typecheck` passes. **A local test passing is not proof of a cross-chain transfer.**

Live read-only check: `pnpm --filter @sol2near/crosschain live:dry` → on 2026-11-13: `FAIL … fetch failed (ENOTFOUND)`.

## 9. Known limitations

- U1–U5 in `FEASIBILITY.md` §3 (live quote fields, ATA destination, status and submit shapes, signature) follow the 1Click convention and are unverified on Tidepool.
- Tidepool is custodial with a single maker and no SLA (T12). A deposit after the deadline may be refunded or lost: the client refuses to fund a quote that is within 60 s of its deadline.
- Faucet: the Tidepool website only.

## 10. Testnet transactions confirmed

None for the cross-chain leg. The NEAR-side deposit into the Treasury is proven (G2 C1).

## 11. Last commit

See the git log entry that adds this file (`git log -1 -- docs/crosschain/CROSSCHAIN_HANDOFF.md`).

## 12. Recommendations

1. When Tidepool resolves, run `live:dry`, then one live transfer of 1 USDC (with approval) and record the hashes here. Correct U1–U4 if the shapes differ.
2. Replace the SIMULATED adapter in `apps/web` with `createTidepoolClient()` behind the same "live" toggle, and keep the SIMULATED banner for demo mode.

**Status: READY WITH LIMITATIONS**
