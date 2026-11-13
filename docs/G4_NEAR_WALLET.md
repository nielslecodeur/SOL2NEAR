# G4 — NEAR wallet, Treasury deposit from the dashboard, end-to-end UX

Date: 2026-11-13. Solo project. **No transaction was signed in G4**: everything below is code, mocked or
fixture-based tests, and read-only testnet calls.

## 1. Contract facts used (read from `contracts/` and the deployed contracts)

| Call | Contract | Args (exact) | Attached | Gas | Source |
|---|---|---|---|---|---|
| `ft_transfer_call` | `usdc.tidepool-sandbox.testnet` | `{receiver_id: "treasury.sol2near-dev.testnet", amount: "<atomic>", msg: "{\"action\":\"deposit\"}"}` | 1 yocto | 100 Tgas | G2 C1 |
| `execute_lp` | `treasury.sol2near-dev.testnet` | `{deposit_id: "<id>", plan: {swap_amount_in, min_swap_out, min_amounts: [a, b]}}`; **creator only** | 0 | 300 Tgas (≥ 200 required) | G2 C2 |
| `register_position` | `fuel.sol2near-dev.testnet` | `{position_id: "<deposit id>"}`; permissionless, rewards go to the recorded creator | 0 | 100 Tgas | G2 C4 |
| `claim` | `fuel.sol2near-dev.testnet` | `{position_id: "<id>"}` | 0 | 50 Tgas | G2 C6 |
| `storage_deposit` | `fuel.sol2near-dev.testnet` | `{account_id, registration_only: true}` | `storage_balance_bounds.min` (0.00125 NEAR) | 30 Tgas | NEP-145 |

How the Treasury reacts to a deposit (`ft_on_transfer`):
- It **refuses and refunds 100 %** (event `deposit_refused {reason}`) for a wrong token (`unsupported_token`), `treasury_not_ready`, `invalid_msg`, or `below_min_deposit`.
- Otherwise it records a deposit for `sender_id`, emits `deposit_allocated {deposit_id, creator, amount, lp_budget, reserve, community}`, and uses the whole amount.

The split is computed by `ledger::split`:
- LP = `floor(A×lp_bps/10000)`;
- reserve = `floor(A×reserve_bps/10000)`;
- community = the rest.

The bps are read from `get_config` (9000 / 800 / 200).

Read-only checks on testnet (2026-11-13):
- `get_config`: `usdc_token = usdc.tidepool-sandbox.testnet`, `min_deposit = 1000000`, `ready = true`, pool 2951.
- `storage_balance_of(Treasury)` on USDC is registered; `get_in_flight` is `null`.
- `sol2near-dev.testnet` holds 29.9 USDC and ~1.76 NEAR, and is registered on FUEL.
- USDC `ft_metadata`: 6 decimals.

**Tidepool compatibility:** Tidepool settles with `usdc.tidepool-sandbox.testnet` (FEASIBILITY T5/T9), which is exactly the token the Treasury accepts. No conversion is needed, and none is done.

## 2. Wallet choice

| Option | Version (npm, 2026-11-13) | Verdict |
|---|---|---|
| **NEAR Wallet Selector** `@near-wallet-selector/*` | 10.1.4 (official near/wallet-selector) | **chosen**: wallet code is pinned in the build; actions use the near-api-js format (`@near-js/transactions` 2.5.1) |
| HOT NEAR Connect `@hot-labs/near-connect` | 0.12.0 | not chosen: it downloads wallet executors at runtime from `raw.githubusercontent.com` (supply-chain surface, and fragile behind a corporate firewall); it is also pre-1.0 |

Modules: MyNearWallet (web, redirect-based) and Meteor (extension). Network is fixed to `testnet`. Accounts other than
`*.testnet`, 64-hex implicit or `0x` implicit are never exposed to the app, so no mainnet call can be prepared.
The selector is lazy-loaded in its own chunk (main bundle 487 kB, wallet chunk 1.26 MB).

## 3. User flow (dashboard, mode *Live testnet*)

1. **Connect NEAR wallet**. The panel shows:
   - the account and the `testnet` badge;
   - NEAR (gas) and USDC balances, with "accepted by Treasury";
   - storage status (USDC, Treasury on USDC, FUEL);
   - the number of your deposits.
2. **The pipeline Bridge → Receive → Deposit → Liquidity → FUEL**: each step is `NOT_STARTED / READY / PENDING / CONFIRMED / FAILED / BLOCKED`, derived only from chain reads and verified outcomes.
3. **Deposit to Treasury**:
   - Enter an amount (or use *Max*, or *Use this amount* after a verified bridge). It is checked locally (token, recipient, min deposit, balance, gas, storage, testnet).
   - The split preview uses the contract rule.
   - **Review** lists the token, the atomic amount, the call and the split. *Confirm & open wallet* is pressed once, then the wallet signs.
4. **Verification**:
   - The final outcome must contain the Treasury's own `deposit_allocated` for this sender and amount, with `ft_transfer_call` returning the full amount.
   - `get_deposit(id)` must then show the same creator and amount.
   - Refusals and refunds are shown with their reason and amount.
   - If there is no final outcome yet, the status stays *submitted / verifying*: there is no retry button, but a *dismiss after checking* option.
5. **Deploy liquidity**: the `execute_lp` plan is computed from the live Ref pool (same code as `scripts/plan-lp.ts`, which reproduces the real C2 plan exactly). It is reviewed, then signed.
6. **Register for FUEL**, then **Claim** once the season has closed with SUCCESS and the LP is unlocked. FUEL storage is registered first if it is missing. Committed FUEL is labelled "not earned yet".
7. **History**: every transaction started from this browser is listed with its status and explorer link. It survives reloads and MyNearWallet's redirect (`transactionHashes` / `errorCode`). An unresolved transaction blocks a second one of the same kind.

**Path A** (wallet → Treasury → Ref → FUEL) does not need Tidepool. **Path B** (Solana → Tidepool → NEAR → Treasury) is
shown separately and never claimed from a direct NEAR deposit.

## 4. Tests (2026-11-13)

| Suite | Result | Nature |
|---|---|---|
| `apps/web` `src/near/near.test.ts` | 24 pass | **real G2 outcomes** (C1, C2, C4, C6, C7 fixtures) + SYNTHETIC variants marked as such |
| `apps/web` `src/near/pipeline.test.ts` | 10 pass | synthetic inputs |
| `apps/web` total | 40 pass | |
| `packages/crosschain` | 35 pass | mocked |
| `packages/near-client` | 6 pass | |
| `pnpm typecheck` | OK (4 packages) | |
| `pnpm --filter @sol2near/web build` | OK | warnings: chunk size, `eval` inside js-sha256 (a wallet-selector dependency) |

Covered:
- **wallet**: testnet-only accounts, disconnected, rejection vs other errors, no gas, reload + redirect result, ambiguous redirect not guessed;
- **USDC**: exact call, decimals, invalid / below-min / over-balance, wrong token, wrong recipient, storage, not ready;
- **Treasury**: split = `ledger::split` cases, real C1 counted, refusal, callback failure, `ft_transfer_call` failure, spoofed event from another contract, wrong signer, partial use, `get_deposit` cross-check, pending tx, double submission;
- **after the deposit**: real C2 plan reproduced, real outcomes of `execute_lp` / `register_position` / `claim` / double claim, exact FUEL calls;
- **cross-chain**: bridge done but no deposit, SUCCESS not seen on NEAR, refund amount, interrupted transfer, Tidepool unreachable → Bridge BLOCKED, received below `minAmountOut` → `settlement_mismatch`.

**No test is an on-chain proof.** No browser check was possible in this session (Chrome extension disconnected): the
dashboard must be opened once to confirm the wallet modal and the panel render.

## 5. First real deposit from the dashboard: what needs your approval

1. A NEAR testnet account in a wallet the selector supports:
   - **Meteor** (extension) or **MyNearWallet** (`testnet.mynearwallet.com`);
   - holding Tidepool test USDC (e.g. `sol2near-dev.testnet`, which has 29.9 USDC, once imported into the wallet by you);
   - with ≥ 0.02 NEAR.
2. `pnpm --filter @sol2near/web dev`, then open the URL, select *Live testnet*, click *Connect NEAR wallet*, and choose your wallet.
3. Deposit, e.g., **2 USDC**: check the review (token `usdc.tidepool-sandbox.testnet`, `2000000` atomic, receiver `treasury.sol2near-dev.testnet`, split 1.8 / 0.16 / 0.04), then approve in the wallet. **This is the transaction that needs your OK.**
4. Optional, each needing its own OK:
   - *Deploy liquidity* (`execute_lp`, 300 Tgas);
   - *Register for FUEL*: right after the LP is confirmed, because a position only counts if registered before its confirmation season ends (30-min seasons, +5 min grace; else `ERR_SEASON_CLOSED`);
   - later, *Claim*.
