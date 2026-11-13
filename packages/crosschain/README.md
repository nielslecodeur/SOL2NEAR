# @sol2near/crosschain

Solana Devnet USDC → NEAR testnet USDC through **Tidepool**. Tidepool is a community 1Click-compatible sandbox,
**not the official NEAR Intents service**. Testnet / devnet only: test tokens have no value.

```ts
import { createTidepoolClient } from "@sol2near/crosschain";
const tidepool = createTidepoolClient();
const preview = await tidepool.quote({ amountAtomic: "1000000", solanaRefundAddress, nearRecipient }, { dry: true });
```

| Command | What it does |
|---|---|
| `pnpm --filter @sol2near/crosschain test` | 21 unit tests (mocked Tidepool + Solana RPC) |
| `pnpm --filter @sol2near/crosschain typecheck` | `tsc` on `src/` and `examples/` |
| `pnpm --filter @sol2near/crosschain live:dry` | read-only live check: health, route, one dry quote |

| File | Role |
|---|---|
| `src/http.ts` | network calls and error mapping |
| `src/quote.ts` | quote body, validation, expiry |
| `src/solana.ts` | unsigned SPL deposit tx, devnet reads |
| `src/wallet.ts` | wallet boundary (no keys here) |
| `src/status.ts` | status parsing and polling |
| `src/errors.ts` | `CrosschainFailure` |
| `src/client.ts` | public client |

API: [`docs/crosschain/INTERFACE.md`](../../docs/crosschain/INTERFACE.md).
Facts and assumptions: [`docs/crosschain/FEASIBILITY.md`](../../docs/crosschain/FEASIBILITY.md).
Status: [`docs/crosschain/CROSSCHAIN_HANDOFF.md`](../../docs/crosschain/CROSSCHAIN_HANDOFF.md).
