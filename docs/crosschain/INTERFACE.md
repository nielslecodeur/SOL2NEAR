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
| `deposit(quote, payer, wallet)` *(extra)* | Solana signature | build → wallet sign & send → submit, **at most once per deposit address** |
| `status(depositAddress)` *(extra)* | `BridgeResult` | one `GET /v0/status` |
| `watch(depositAddress, onUpdate, { intervalMs?, signal? })` | final `BridgeResult` | polls every 2–5 s, emits on change only, survives 5 transient errors, abortable |
| `explorerLinks(result)` | `{ solana: string[], near: string[] }` | proof links |

Wallet boundary (the package never sees a key):

```ts
interface SolanaWallet { signAndSendTransaction(tx: Uint8Array): Promise<string /* base58 signature */> }
```

Errors are always `CrosschainFailure` with `kind`: `network` · `http` (5xx, 429, malformed or unknown response) ·
`validation` (bad input, 4xx with Tidepool's message verbatim, insufficient balance, dry quote) · `wallet_rejected` ·
`quote_expired` · `unsupported_route`.

Double execution: `deposit()` caches per deposit address. A `wallet_rejected` (nothing broadcast) may be retried.
Any other wallet error might have broadcast, so it is **not** retried automatically: call `status()` first.
