# Cross-chain interface

The shared contract `packages/shared/src/crosschain.ts` (`CrosschainClient`) is implemented **unchanged** by
`createTidepoolClient()` in `packages/crosschain`. The additions below are extra methods; they do not change the shared types.

```ts
import { createTidepoolClient, CrosschainFailure, explorerLinks, type SolanaWallet } from "@sol2near/crosschain";

const tidepool = createTidepoolClient({ /* baseUrl?, solanaRpcUrl?, fetch?, timeoutMs? */ });
```

| Function | Returns | Notes |
|---|---|---|
| `health()` | `{ ok, solanaRouteOk }` | `GET /v0/health` |
| `tokens()` *(extra)* | `TidepoolToken[]` | `GET /v0/tokens` |
| `assertRouteSupported()` *(extra)* | `void` | throws `unsupported_route` if a leg is missing or its decimals differ |
| `quote(req, { dry })` | `BridgeQuote` | validates inputs locally first; `dry: true` for previews (no deposit address) |
| `quoteValidity(q, now?)` | `"dry" \| "valid" \| "expired" \| "no_deadline"` | 60 s safety margin before the deadline |
| `buildDepositTransaction(quote, payer)` | `Uint8Array` | unsigned legacy tx: create dest ATA (idempotent) + `transferChecked`; checks the payer's devnet USDC balance |
| `submitDeposit(txHash, depositAddress)` | `void` | once per pair; a failure may be retried |
| `deposit(quote, payer, wallet)` *(extra)* | Solana signature | reads the NEAR baseline → build → wallet sign & send → **wait for Solana confirmation** → submit. At most **one signature per deposit address**, even across reloads with a persistent store |
| `status(depositAddress)` *(extra)* | `BridgeResult` | one `GET /v0/status`; refuses a status that echoes another deposit address |
| `watch(depositAddress, onUpdate, { intervalMs?, signal? })` | final `BridgeResult` | polls every 2–5 s, emits on change only, survives 5 transient errors, abortable |
| `track(depositAddress, onUpdate, opts?)` *(extra)* | final `BridgeResult` | `watch` + records `bridge_success` / `bridge_refunded` / `bridge_failed`. **SUCCESS is not yet a NEAR receipt** |
| `verifyOnNear(depositAddress)` *(extra)* | received atomic amount | NEAR recipient's `usdc.tidepool-sandbox.testnet` balance must rise by ≥ `minAmountOut`, else `settlement_mismatch` |
| `transfers()` *(extra)* | `TransferRecord[]` | everything remembered, to resume after a reload |

`createTidepoolClient({ store })`: `memoryStore()` by default, `webStorageStore(localStorage)` in the browser.
Transfer stages: `signing → sent → solana_confirmed → bridge_success → near_verified`, or `solana_failed`, `bridge_refunded`, `bridge_failed`.
Step 4, the deposit into the Treasury, is a separate NEAR transaction signed by the user. This package never does it.
| `explorerLinks(result)` | `{ solana: string[], near: string[] }` | proof links |

Wallet boundary (the package never sees a key):

```ts
interface SolanaWallet { signAndSendTransaction(tx: Uint8Array): Promise<string /* base58 signature */> }
```

Errors are always `CrosschainFailure` with `kind`:
- `network`;
- `http`: 5xx, 429, a malformed or unknown response, or an echo mismatch;
- `validation`: bad input, a 4xx with Tidepool's message verbatim, an insufficient balance, or a dry quote;
- `wallet_rejected`;
- `quote_expired`;
- `unsupported_route`: a route that is not listed, or a memo deposit;
- `solana_tx_failed`;
- `interrupted`;
- `settlement_mismatch`.

Double execution:
- A `wallet_rejected` broadcast nothing, so it may be retried.
- Any other wallet error leaves the record at `signing`. The next `deposit()` throws `interrupted` and never re-signs. Check the wallet history and `status()`, and if needed take a **new** quote.
