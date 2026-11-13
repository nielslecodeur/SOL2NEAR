# G7 — First real bridge Solana Devnet → Tidepool → NEAR testnet

Date: 2026-11-13. Solo project. Tidepool is a **community 1Click-compatible sandbox, not official NEAR Intents**.

**Status: READY FOR LIVE BRIDGE TEST.** Everything that needs no signature is done (§1–§3). The real transfer needs your Solana
wallet and your approval (§4). **No Solana transaction and no live quote has been made by SOL2NEAR yet.**

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
| U1 | Live quote has `quote.depositAddress`, `quote.deadline` (and `timeWhenInactive`), no `depositMemo` for this route | ✅ **verified on a real Tidepool quote echo** |
| U2 | The SPL deposit goes to the **ATA of `depositAddress`**, created idempotently by the payer | ✅ **verified**: a real deposit built exactly like `buildSplDepositTx` was recognised by Tidepool (its origin tx) and swept by the deposit-address key |
| U3 | Status shape `{correlationId, quoteResponse, status, updatedAt, swapDetails{…TxHashes[{hash, explorerUrl}], amountIn/Out, refundedAmount…}}` (+ an extra `tidepool` field) | ✅ **verified**; the real response parses (test) |
| U4 | `POST /v0/deposit/submit` | ⏳ only on our own live transfer (submitting someone else's tx would write to Tidepool) |
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

## 4. The real transfer: what needs you (not done)

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

## 5. Tests (2026-11-13)

| Suite | Result |
|---|---|
| `packages/crosschain` | **36 pass** (+1: real status fixture) |
| `apps/web` unit | **47 pass** (+1 bridge-minimum on real quotes, +1 disconnect reset) |
| e2e (real Chrome) | 14/14 |
| typecheck / build | OK |
