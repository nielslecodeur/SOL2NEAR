# G7 — First real bridge Solana Devnet → Tidepool → NEAR testnet

Date: 2026-11-13. Solo project. Tidepool is a **community 1Click-compatible sandbox, not official NEAR Intents**.

**Status: PATH B PROVEN END TO END (2026-11-13 21:38–21:46 UTC): Solana devnet → Tidepool → NEAR → Treasury.** Bridge leg first: 2 USDC from the user's Solana devnet wallet arrived on
`lowarena9362.testnet` as **1.9948 USDC**, verified on NEAR. The Treasury deposit of the bridged USDC (step 6) is next and
needs a separate NEAR signature.

## 1. U1–U5 verified on REAL Tidepool data (read-only, without moving funds)

The source is a **real third-party Solana Devnet → NEAR transfer** found on-chain:
- the latest transactions of the Tidepool USDC mint on Solana devnet;
- the public Tidepool `GET /v0/status` for its deposit address.

The third party's own addresses are redacted in the saved fixture.

| Evidence | Value |
|---|---|
| User deposit tx (Solana devnet) | `SHgjML7x7NVV8yNNFTQN1nz3EsaTaEi4rtMPrThezhAiRWiazU8oTTiTAyLZDzpDJR51DpgBk4JpCBgbjGxaPGJ`, 18:12:58 UTC, signed by the user only: `createIdempotent` of the **ATA** `GcserJ…kjC9` of wallet `aV6YRnofogRdnQcNmyGmhyp2H1ZzpQEWTiWLX8VRyor`, then `transferChecked` 86.814125 USDC to that ATA |
| Tidepool sweep (3 s later) | `251jkDWyZn…`, signed by the Tidepool relayer `BEijzw…St55Q` **and** `aV6YRn…`: `transferChecked` of the ATA to the relayer treasury |
| `GET /v0/status?depositAddress=aV6YRn…` | `SUCCESS`; the quote echo has `depositAddress` = aV6YRn…; `originChainTxHashes[0]` = the user deposit above. Fixture: `packages/crosschain/src/fixtures/tidepool_status_sol_success.json` |

| # | Point | Status now |
|---|---|---|
| U1 | Live quote has `quote.depositAddress`, `quote.deadline` (and `timeWhenInactive`), no `depositMemo` for this route | ✅ **verified** on a real quote echo, then on **our own live quote** (deposit address `5gUT7A3Z…vNpU`, deadline 22:08:31 UTC, every echo check passed) |
| U2 | The SPL deposit goes to the **ATA of `depositAddress`**, created idempotently by the payer | ✅ **verified**: a real deposit built exactly like `buildSplDepositTx` was recognised by Tidepool (its origin tx) and swept by the deposit-address key |
| U3 | Status shape `{correlationId, quoteResponse, status, updatedAt, swapDetails{…TxHashes[{hash, explorerUrl}], amountIn/Out, refundedAmount…}}` (+ an extra `tidepool` field) | ✅ **verified**; the real response parses (test) |
| U4 | `POST /v0/deposit/submit {txHash, depositAddress}` | ✅ **verified on our own transfer**: HTTP 200, same shape as the status (`correlationId, quoteResponse, status, updatedAt, swapDetails, tidepool`), idempotent (re-submitting returned `SUCCESS` and changed nothing) |
| U5 | Quote signature | ❌ not verifiable (key not published); compensated by echo checks + NEAR balance check |

## 2. Bugs found with the real data, fixed

| Bug | Fix |
|---|---|
| `destinationChainTxHashes` can hold a **Solana refund tx** (`explorerUrl` explorer.solana.com) next to the NEAR settlement. The client put every destination hash in `nearTxHashes`, so it would show a wrong NearBlocks link | each ref is classified by its `explorerUrl` (fallback: signature length); origin refs are Solana. Regression test on the real response |
| The bridge card defaulted to **1 USDC**, which arrives as 0.9974 (guaranteed min 0.987426): **below the Treasury minimum deposit (1 USDC)**, so the funds could not be deposited | default 2 USDC. The card compares the quote's **guaranteed minimum** with `get_config.min_deposit` and **disables Bridge** when it is not covered. Test on real quotes: 1 USDC → min 987426 ✗; 2 USDC → min 1974852 ✓ |
| A dry preview required connecting a Solana wallet | a dry quote creates no deposit address and moves nothing, so it now works before connecting (labelled placeholder refund address). The live bridge still needs the wallet |
| Quote amounts rounded to 2 decimals (1.99 for 1.9948) | exact 6 decimals and the quoted cost |

Live dry quotes (2026-11-13, read-only):
- 2 USDC → **1.9948**, guaranteed min **1.974852**, cost 0.0052, ~60 s (`8dd6ecf1-…`);
- 1 USDC → 0.9974, min 0.987426 (`d735e82b-…`).

## 3. Seen in your browser (read-only)

The injected Solana provider `window.solana` reports **both `isPhantom` and `isBraveWallet`**, and `window.phantom` is absent. It is most
likely **not Phantom** but a wallet imitating Phantom's API. Its Devnet support is unknown.
- This is not dangerous: the deposit transaction uses a devnet blockhash and the devnet-only mint, so on mainnet it cannot move anything.
- It can make the test fail, though. **Recommended: Phantom with Testnet mode → Solana Devnet.**

## 4. Our real transfer (2026-11-13), all verified

| Step | Evidence |
|---|---|
| Prerequisites | Solana devnet wallet `4NKELSMWVaGu12xPZm1H5fppzNHDKycttYaAS44NE4z5` (0.5 SOL). Tidepool faucet (app.usetidepool.tech, Solana card): **100 USDC** on its ATA `AFDH7pLE…97M1`, tx `eEBHJaPJ…U6X` |
| Wallet | connected in the dashboard. The provider confirmed the same public key |
| Dry quote | 2 USDC → 1.9948 (guaranteed min 1.974852) ✓ ≥ Treasury min 1 USDC |
| Live quote | deposit address `5gUT7A3ZdqgnEe5eKTwQRBrwTcm3EJmNfRiCZTG2vNpU`, deadline 22:08:31 UTC, echo ✓. NEAR baseline read: 86 USDC |
| **Solana deposit (signed by the user)** | [`bGUicpgyYtePFP3BcEXYHQ9me67uqFjFQWmS8FsKWhYSzwpcVDv5SZyyLxYneLX93Bic4JZRFrWvphQUkEs887R`](https://explorer.solana.com/tx/bGUicpgyYtePFP3BcEXYHQ9me67uqFjFQWmS8FsKWhYSzwpcVDv5SZyyLxYneLX93Bic4JZRFrWvphQUkEs887R?cluster=devnet), confirmed |
| Tidepool | `SUCCESS` at 21:39:08 UTC (~30 s): deposited 2000000, amountOut **1994800**, no refund |
| **NEAR settlement** | [`J58H2uyuGo4wJsjbNuX1AEEwszD4Z8CMAppCqCirRFqf`](https://testnet.nearblocks.io/txns/J58H2uyuGo4wJsjbNuX1AEEwszD4Z8CMAppCqCirRFqf), signed by `maker.tidepool-sandbox.testnet`: verifier `ft_withdraw`, then **`ft_transfer` verifier → lowarena9362.testnet 1994800** (T9 confirmed) |
| Receipt check | independent RPC: USDC 86000000 → **87994800** (+1994800 ≥ min 1974852). The dashboard's own `verifyOnNear` gives `near_verified`, received 1994800 |

Bug found live and fixed: the bridge card's AbortController was created once. React dev StrictMode mount → unmount
(abort) → mount left it aborted, so tracking failed at once ("signal is aborted without reason"), although the bridge
itself succeeded. The controller is now created per mount, and an abort is not shown as an error. After a reload, the card
resumed the stored transfer and verified the NEAR receipt itself.

## 5. Path B completed: Treasury deposit (signed by the user in Meteor, 2026-11-13 21:45:44 UTC)

| Check | Result |
|---|---|
| Tx | [`J7uMjikj935TeunPoHj2i7xrCSSDrYEAmvdHv7DYBdhz`](https://testnet.nearblocks.io/txns/J7uMjikj935TeunPoHj2i7xrCSSDrYEAmvdHv7DYBdhz), `FINAL`, `ft_transfer_call` → Treasury, msg `{"action":"deposit"}`, 1 yocto, returned `"87994800"` (fully used) |
| Treasury event | `deposit_allocated` **#3**, creator lowarena9362.testnet, 87994800 → 79195320 / 7039584 / 1759896 |
| Amount note | the user deposited the **whole balance** (87.9948 USDC, "Max"), not only the bridged 1.9948. The balance went 86 → 87.9948 through the bridge, then → 0. USDC is fungible, so the deposit *contains* the bridged amount; it does not "tag" it |
| Treasury after | 4 deposits, total received 121.9948 USDC, pending LP budget 79.19532 |

**Path B is proven end to end on testnet:**

Solana devnet wallet → (deposit `bGUicpgy…`) → Tidepool → (settlement `J58H2uyu…`) → NEAR wallet → (deposit `J7uMjikj…`) → Treasury.

### Risk found: do not `execute_lp(3)` as is

The LP budget of deposit #3 (79.2 USDC) is larger than pool 2951 (~70 USDC / ~14 wNEAR). The zap would swap ~37 USDC, a
price impact of roughly 35 %. The slippage guards only protect against the pool *moving* between the plan and execution,
not against a bad price that is already in the plan.
- **Recommendation**: show the price impact in the `execute_lp` review and warn or refuse above a threshold. Meanwhile, do not deploy #3.
- The funds are safe in the Treasury; the creator reserve (7.04 USDC) is withdrawable.

## 6. Original runbook (kept for reference)

1. **Solana wallet on Devnet** (Phantom recommended: Settings → Developer settings → Testnet mode → Solana Devnet).
2. **Devnet SOL** ≈ 0.01 for fees and ≈ 0.002 for the ATA rent, from faucet.solana.com.
3. **Tidepool test USDC on Solana devnet** from the Tidepool faucet (website only), mint `7paf…r4Xr`.
4. Dashboard (`pnpm --filter @sol2near/web dev`, Live testnet), creator account `lowarena9362.testnet`:
   - *Connect Solana wallet (Devnet)*, amount **2**, *Preview (dry quote)* → check "✓ covers the Treasury minimum";
   - **Bridge 2 USDC**, then approve **in your Solana wallet**. Before approving, check: Devnet, mint `7paf…r4Xr`, amount 2, destination = the deposit address of the live quote.
5. The card follows: Solana confirmed → Tidepool → **USDC verified on NEAR** (balance increase ≥ the guaranteed minimum).
6. **Reconnect the NEAR wallet** (Meteor), *Use this amount*, then deposit into the Treasury: a separate NEAR signature.

Path B is then proven for real: Solana → Tidepool → NEAR → Treasury. U4 is closed at step 4 (the submit call), and the
NEAR settlement tx is recorded.

## 7. Tests (2026-11-13)

| Suite | Result |
|---|---|
| `packages/crosschain` | **36 pass** (+1: real status fixture) |
| `apps/web` unit | **47 pass** (+1 bridge-minimum on real quotes, +1 disconnect reset) |
| e2e (real Chrome) | 14/14 |
| typecheck / build | OK |
