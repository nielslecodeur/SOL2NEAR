# G5 — Browser validation, wallet reliability, hardening

Date: 2026-11-13. Solo project. **No transaction was signed or sent in G5.**

## 1. Browsers

| Browser | How | Result |
|---|---|---|
| **Google Chrome 157.0.8103.51** (installed locally) | Playwright 1.64.1, `channel: "chrome"`, headless. No browser download | all browser checks below |
| Microsoft Edge (installed) | present, not used | — |

The Claude-in-Chrome extension was not needed. Playwright drives the local Chrome directly.

## 2. Kinds of evidence

| Kind | What it proves | Where |
|---|---|---|
| Unit tests (Node) | logic: call building, outcome analysis, pipeline, RPC failover | `apps/web` 41, `packages/crosschain` 35, `packages/near-client` 6 |
| **Real-browser tests, real testnet reads** (`@live`) | the real app and the real Wallet Selector, in real Chrome, against NEAR testnet (read-only) | `apps/web/e2e/app.spec.ts`, 6 tests |
| Real-browser tests, **mocked wallet** (`@mock`) | the deposit UI with a fake wallet injected through an e2e-only hook (compiled out of production), plus intercepted RPC for failure cases | same file, 6 tests |
| Read-only live calls | Tidepool + NEAR + Ref + FUEL state | `scripts/probes/verify-testnet.mjs`, `pnpm --filter @sol2near/crosschain live:dry` |
| Needs a real signature | real wallet connection, a real deposit | **not done**: needs your wallet and your approval |

## 3. Results (final run, 2026-11-13)

`pnpm --filter @sol2near/web e2e` → **12 passed** (also 3 consecutive green runs before the last code changes):

| # | Test | Kind |
|---|---|---|
| 1 | loads without JS errors; Treasury totals = `get_accounting` | @live |
| 2 | no session → *Connect NEAR wallet*; the **real modal** lists MyNearWallet and Meteor Wallet; closing it stores nothing | @live |
| 3 | watch mode `sol2near-dev.testnet` → deposit #0 `LP CONFIRMED`, FUEL `Claimed` | @live |
| 4 | demo mode is labelled SIMULATED and hides the NEAR panel; live mode shows no simulated data | @live |
| 5 | **strict CSP without `unsafe-eval`**: app + wallet modal work (see §5) | @live |
| 6 | mobile 390 px: no horizontal scroll | @live |
| 7 | connected (mock wallet): live balances, "accepted by Treasury", storage ✓ | @mock |
| 8 | invalid / below 1 USDC / over balance / > 6 decimals → refused before review | @mock |
| 9 | **2 USDC**: preview LP 1.8, review lists token, `2000000` atomic, receiver, msg, 1 yocto, 100 Tgas, split 1.8 / 0.16 / 0.04; mocked rejection → `rejected`, `signAndSend` called once, nothing sent; history survives reload | @mock |
| 10 | `alice.near` (mainnet) from the wallet → refused | @mock |
| 11 | browser-wallet return `?transactionHashes=` → record `submitted`, URL cleaned, unknown tx stays verifying, a new deposit is **blocked** | @mock (+ intercepted tx status) |
| 12 | both NEAR RPC providers down → clear errors, no crash, nothing sent | @mock (intercepted) |

Unit tests: web 41 · crosschain 35 · near-client 6 (all pass). `pnpm typecheck`: OK. `pnpm --filter @sol2near/web build`: OK.

Console errors in the real browser:
- No JavaScript exceptions.
- The only console errors were the Tidepool DNS failure on the filtered network (now gone, §6), and a `/favicon.ico` 404, fixed with an inline icon.

Screenshots (real Chrome): `docs/g5/wallet-modal.png`, `docs/g5/review-2usdc.png` (mocked wallet), `docs/g5/connected-mock.png` (mocked wallet), `docs/g5/demo.png`, `docs/g5/mobile.png`.

## 4. Bugs found in the browser and fixed

| Bug | Effect | Fix |
|---|---|---|
| Stale reads overwrote newer ones (`App.refresh`) | a slower earlier read could replace the account you just loaded, or **put testnet data on screen after switching to SIMULATED** | request sequence: only the latest read updates the screen; `refresh` reads the current account through a ref |
| A single NEAR RPC provider | a drpc hiccup (seen during the runs: `fetch failed`, and the G2 "free plan timeout") broke every read | failover drpc → FastNEAR on network error, timeout, 429, 5xx or free-plan errors; chain answers are never retried (unit-tested) |
| Mainnet account guard only in the wallet adapter | a non-testnet account from any adapter would reach the UI | the panel refuses it with an explicit message (e2e #10) |
| Rejection detection relied on one error class | other wallet errors could be misread | `isRejection()` fallback |
| Light wallet modal on a dark app; raw Tidepool error | readability | `theme: "dark"` + testnet description; clear "unreachable from this network" text |
| "next actions" box empty when nothing is left to do | confusing | explicit "Nothing to sign for this deposit right now" |
| Missing favicon | console 404 | inline SVG icon |

One test bug was also found and fixed: `getByRole({ name: "Load" })` also matched "**Load**ing wallets…". The test now uses an exact match inside the form.

## 5. Wallet Selector and dependencies

- **Init and network**:
  - The selector loads lazily, in its own chunk, and initialises without error.
  - The network is fixed to `testnet`, with `fallbackRpcUrls` = FastNEAR, drpc. The selector's own default is already FastNEAR, not `rpc.testnet.near.org`.
- **Modal**: it opens and lists **MyNearWallet** and **Meteor Wallet**. "No session" is handled. Disconnect, reload restore and a real browser-wallet return were **not validated with a real wallet**: the redirect handling is tested with a mocked return only.
- **MyNearWallet testnet** (`testnet.mynearwallet.com`): it is online (HTTP 200) in real Chrome and labels itself "Test-only Wallet (rpc.testnet.near.org)". This module is the one maintained in wallet-selector 10.1.4, so it is kept. It is not on the filtered network's blocklist.
- **Meteor**: `wallet.meteorwallet.app` answers Cloudflare "you have been blocked" to **headless** Chrome, which is bot protection. Its use from a normal browser, or through the extension, is untested here.
- **`js-sha256`**:
  - It is 0.9.0, pulled by `@near-wallet-selector/core` 10.1.4 (`sha256.array` only).
  - Its `eval("require('crypto')")` sits in a Node-only branch, `NODE_JS` detection, and is never run in a browser.
  - **Fixed by a pnpm override to `js-sha256@0.11.1`**, which has no `eval`. The API used is identical, and the hash equals Node `crypto` (checked).
  - The production bundle now contains **0** `eval(`.
- **zod 4.6.7** (via `@meteorwallet/sdk`) probes `new Function("")` in a `try/catch` at load, then falls back to jitless mode. Under a strict CSP this logs **one** `script-src eval` violation report, and nothing breaks (e2e #5). There is no `unsafe-eval` and no code is executed.
- **`generate-function` / `is-my-json-valid`** (via `@near-js/accounts`): they are only used by `Contract` ABI validation, which is not on our signing path. Vite's "util externalized" warning is therefore harmless here.
- **Secrets scan of `dist/`**: no key, mnemonic or token patterns. The e2e hook `__SOL2NEAR_E2E_WALLET__` is **absent** from the production bundle and present only in `dist-e2e/`. The only external hosts are the expected RPC, explorers and Tidepool.
- Bundle: main 488 kB (152 kB gzip), wallet chunk 1.02 MB (350 kB gzip, on demand).

## 6. Testnet read-only checks (2026-11-13, after the machine moved to another network)

- `node scripts/probes/verify-testnet.mjs` → **all checks passed** (14 PASS, Tidepool included).
- `pnpm --filter @sol2near/crosschain live:dry` →
  - health ok, Solana route ok;
  - both tokens listed (6 decimals);
  - **live dry quote** 1 USDC → 0.9974 (min 0.987426, cost 2600 atomic, ~60 s), correlationId `434815b1-8a6f-43dd-b104-4c7b566664b8`. The quote echo passed every check.
- The earlier block was the Palo Alto sinkhole of the previous network (G3). The current network resolves Tidepool normally.

## 7. Prepared first deposit (not executed)

Wallet `sol2near-dev.testnet` (29.9 USDC, 1.7587 NEAR, registered on USDC and FUEL) → **2 USDC** → Treasury:
- `usdc.tidepool-sandbox.testnet.ft_transfer_call({"receiver_id":"treasury.sol2near-dev.testnet","amount":"2000000","msg":"{\"action\":\"deposit\"}"})`, 1 yoctoNEAR, 100 Tgas.
- Split by `ledger::split` with the live bps 9000/800/200: **LP 1 800 000 · reserve 160 000 · community 40 000** (1.8 / 0.16 / 0.04 USDC). This is shown identically in the review screen (e2e #9).
- Success is accepted only if the final outcome holds the Treasury's own `deposit_allocated` for 2 000 000 from this sender, **and** `get_deposit(id)` shows the same creator and amount.

## 8. Remaining risks

| Level | Risk |
|---|---|
| P1 | Real wallet connection and signing never exercised (MyNearWallet redirect, Meteor). The first real deposit is the first real test of that path |
| P1 | Meteor web blocks headless browsers. A normal-browser connection still needs checking |
| P2 | One harmless CSP report from zod's capability probe; any strict CSP must not add `unsafe-eval` |
| P2 | Public RPC providers (drpc / FastNEAR) without SLA: failover reduces the risk, it does not remove it |
| P2 | The wallet chunk is large (350 kB gzip), loaded on demand |

**Status: READY FOR LIVE WALLET TEST**. Everything up to the wallet signature is validated in a real browser. The
connection with a real wallet and the first 2 USDC deposit need your account and your approval.
