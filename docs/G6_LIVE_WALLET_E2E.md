# G6 — Live NEAR wallet, first Treasury deposit from the dashboard

Date: 2026-11-13. Solo project. **Status: deposit PASS · execute_lp PASS · FUEL registration NOT ADMITTED (window expired) · claim not applicable.**

## 1. Environment

| Item | Value |
|---|---|
| Code | `main` at `7ccca18` + the G6 report commit (the deposit was signed from the dashboard built from `7ccca18`) |
| Network | NEAR **testnet** only |
| Contracts | Treasury `treasury.sol2near-dev.testnet` (code_hash `8njzxUPU…JqJ7F3`), FUEL `fuel.sol2near-dev.testnet`, USDC `usdc.tidepool-sandbox.testnet`, Ref `ref-finance-101.testnet` pool 2951 |
| Wallet | **`lowarena9362.testnet`** (public address), connected through **Meteor Wallet** (browser extension) via NEAR Wallet Selector 10.1.4 |
| Browser | the user's Google Chrome 157 (dashboard driven through the Claude-in-Chrome extension; the wallet approval was done **by the user** in Meteor) |
| Frontend | Vite dev server `pnpm --filter @sol2near/web dev` (README step 6), `http://127.0.0.1:5173` |

## 2. Results

| # | Operation | Status | Evidence |
|---|---|---|---|
| A | Preflight (Treasury `ready`, token, min deposit, storage, no LP job, FUEL season, RPCs) | PASS | read-only RPC, §4 |
| B1 | Real wallet connection (Meteor) confirmed by Wallet Selector | PASS | panel shows `lowarena9362.testnet` + `testnet`; `near-wallet-selector:selectedWalletId = meteor-wallet` |
| B2 | Displayed balances = RPC | PASS (after fix, §3) | 4.948 NEAR, 100 USDC, USDC storage ✓, FUEL storage ✗ = `view_account` / `ft_balance_of` / `storage_balance_of` |
| B3 | Session restored after reload | PASS | reload → same account, same balances |
| B4 | Disconnect | NOT_RUN | would sign the user out; left for later |
| C | Deposit review (2 USDC) | PASS | signer, token, `2000000` atomic, receiver, msg, 1 yocto, 100 Tgas, split 1.8 / 0.16 / 0.04, storage ✓ (`docs/g6/` screenshot) |
| **D** | **Deposit 2 USDC — signed by the user in Meteor** | **PASS** | tx [`FaBKjLRUuYMgH4SgVgurTyUinDPvPvdH5Rxc69X1haHV`](https://testnet.nearblocks.io/txns/FaBKjLRUuYMgH4SgVgurTyUinDPvPvdH5Rxc69X1haHV) |
| **E1** | **`execute_lp(1)`**, signed by the user in Meteor (scenario 1: deposit #1 alone) | **PASS** | tx [`CniqxoxZ5qzJBLZ9RCwJ9nH4evbNwaGV6Y1nE4aDbRdN`](https://testnet.nearblocks.io/txns/CniqxoxZ5qzJBLZ9RCwJ9nH4evbNwaGV6Y1nE4aDbRdN), §2 E1 |
| E2 | `storage_deposit` on FUEL for `lowarena9362.testnet` | NOT_RUN | only needed for a claim; not needed in scenario 1 |
| E3 | `register_position(1)` | **NOT ADMITTED (window expired)** | approved by the user at ~17:38 UTC and sent to Meteor (dashboard record `awaiting_signature`). The registration deadline for season 67 was 17:54:02 UTC. At 18:59 UTC: `get_position(1)` = null and season 67 has no record. Whether it was never signed or signed and rejected cannot be told from contract state (a rejected position writes nothing). Deposit #1 can no longer be admitted (positions count only in their LP confirmation season)  |
| E4 | `close_season` / `claim` | NOT APPLICABLE | season 67 is empty: it cannot be closed, so nothing is burned |

### E1 — on-chain verification of `execute_lp(1)` (independent RPC)

| Check | Result |
|---|---|
| Final status | `FINAL`, `SuccessValue` true, **0 receipt failures** |
| Signed action | `treasury.sol2near-dev.testnet.execute_lp({"deposit_id":"1","plan":{"swap_amount_in":"895473","min_swap_out":"179496673760245282779058","min_amounts":["895481","179496673760245282779058"]}})`, 0 deposit, 300 Tgas, signer `lowarena9362.testnet`. The plan was computed in the dashboard from the live pool |
| Treasury events (own receipts) | `amm_deposit_confirmed` InRef 1800000 → `swap_confirmed` (Ref: swapped 895473 USDC for 0.181309771… wNEAR) → `proof_of_liquidity` ok → `lp_confirmed` |
| Ref | `Liquidity added [904526 USDC, 181309736578080980783860 wNEAR], minted 15282093210022862277595 shares` |
| `get_deposit(1)` | `LpConfirmed`, `lp_verified: true`, shares 15282093210022862277595, usdc_in_lp 904526, dust 1 USDC + 0.0000348969 wNEAR, confirmed 17:36:53 UTC, LP unlock 17:46:53 UTC |
| Reconciliation | swapped 895473 + in LP 904526 + dust 1 = **1800000 = lp_budget** |
| Proof | Treasury `recorded_shares` = Ref `get_pool_shares(2951, Treasury)` = 180922346726168566296617; `pending_budget_total` back to 0; no job in flight |

### D — on-chain verification of the deposit (independent RPC, not the UI)

| Check | Result |
|---|---|
| Final status | `FINAL`; tx status `SuccessValue` = `"2000000"`, the amount used by `ft_transfer_call`, so **nothing refunded** |
| Signed action | `usdc.tidepool-sandbox.testnet.ft_transfer_call({"receiver_id":"treasury.sol2near-dev.testnet","amount":"2000000","msg":"{\"action\":\"deposit\"}"})`, deposit 1 yocto, gas 100 Tgas, signer `lowarena9362.testnet` |
| Receipts | USDC `ft_transfer` lowarena → Treasury 2000000. **Treasury** receipt `SuccessValue` with `deposit_allocated {deposit_id "1", creator lowarena9362.testnet, amount 2000000, lp_budget 1800000, reserve 160000, community 40000}`. `ft_resolve_transfer` success. 6 receipts, no failure |
| `get_deposit(1)` | creator `lowarena9362.testnet`, amount 2000000, 1800000 / 160000 / 40000, status `BudgetAllocated`, no error |
| `get_reserve(lowarena9362.testnet)` | 160000 |
| Balances | user USDC 100 000 000 → **98 000 000**. Treasury USDC 2 000 000 → **4 000 000** = 1.8 pending LP budget + 1.76 reserves + 0.44 community |
| `get_accounting` | total_received 20 000 000 → 22 000 000. reserve_total 1 600 000 → 1 760 000. community_total 400 000 → 440 000. pending_budget_total 0 → 1 800 000. deposits_count 1 → 2 |
| Gas | 0.00065 NEAR (NEAR 4.948 → 4.94743, as shown on the dashboard) |
| Dashboard | record `confirmed`, "Deposit #1 counted: 2 USDC (LP 1.8 / reserve 0.16 / community 0.04)". Pipeline: Deposit CONFIRMED, Liquidity READY. "from this dashboard: verified deposit" |

The split matches `ledger::split` exactly: `floor(2000000×9000/10000)` = 1800000, `floor(2000000×800/10000)` = 160000, and the rest is 40000.

## 3. Bugs found during G6 and fixed (local commits)

| Commit | Bug | Fix |
|---|---|---|
| `4fbf99f` | **Dev server (README step 6) rendered a blank page**, then the wallet selector failed (`Buffer`, `global`, `process` not defined). The production build and the G5 e2e suite were not affected, so it was invisible | `src/polyfills.ts` loaded first. New e2e test on the dev server: it fails without the fix and passes with it |
| `7ccca18` | Balances read only once: USDC received after connecting showed 0 / storage ✗ | *Refresh* button + re-read on window focus (e2e test) |
| `7ccca18` | FUEL storage proposed only when a reward was already claimable | offered as its own optional tx as soon as it is missing |
| `7ccca18` | NEAR amounts truncated to 4 decimals (0.00125 shown 0.0012) | exact formatting |
| `7ccca18` | Review did not name the signer or the storage preconditions | two lines added |
| G6 report commit | Amount field kept "2" after a confirmed deposit | cleared once the deposit is confirmed, so a new deposit must be typed again |

## 4. Preflight (read-only, 2026-11-13 ~17:02 UTC)

- **Treasury**: `ready`, `usdc_token = usdc.tidepool-sandbox.testnet`, `min_deposit` 1000000, bps 9000/800/200, registered on USDC, `get_in_flight = null`.
- **FUEL**: level 1, 30-min seasons from genesis, `registration_grace` 5 min, `season_target_usdc` 5000000, `min_lock` 10 min.
- **RPCs**: drpc and FastNEAR answering. Tidepool also reachable.
- **Tests before signing**: unit 6 + 35 + 41; e2e 14/14 (dev-server test included); typecheck and build OK.

## 5. FUEL season consequence (to decide before E1)

Season progress counts the USDC actually in the LP (`usdc_in_lp`), and the target is 5 USDC. Zap plans computed on the live pool (68.1 USDC / 14.01 wNEAR):

| LP from | USDC in LP | Season |
|---|---|---|
| deposit #1 alone (2 USDC) | ~0.90 | **FAILED**: reward forfeited, level 1 → 0, ≤ 10 FUEL burned from the burn reserve |
| #1 + a new deposit of 10 USDC, both LP'd and registered **in the same season** | ~0.90 + ~4.63 ≈ 5.5 | SUCCESS: claimable after the season ends and the 10-min LP lock |
| a single new deposit of 12 USDC | ~5.59 | SUCCESS |

Steps that need a signature, each needing its own approval:
1. execute_lp for each deposit;
2. FUEL storage;
3. register_position for each;
4. after the season ends, close_season (anyone may call it) and claim.

The positions must be confirmed and registered within one 30-min season (+5 min grace).

## 6. Evidence kinds

| Kind | G6 |
|---|---|
| Unit tests | web 41 · crosschain 35 · near-client 6 |
| Browser tests (Playwright, local Chrome) | 14/14, including the dev-server regression and the refresh test (mocked wallet / intercepted RPC where marked) |
| RPC reads | preflight + post-deposit verification (§2 D, §4) |
| **Real signed transactions** | **1**: `FaBKjLRU…haHV` (2 USDC deposit, `lowarena9362.testnet`, signed in Meteor by the user) |
| Simulated | none used for any claim in this report |

## 7. Lessons from E3

- **Operational**: when the dashboard hands a request to the wallet, nothing on the page can tell whether the wallet window is still open. The registration window (season end + 5 min) was missed while the request sat in the wallet.
- **Recommended code improvement (not done yet)**:
  - show the live deadline on the *Register for FUEL* button, with a countdown to season end + grace;
  - mark an `awaiting_signature` register request as expired once that deadline has passed.
- **Dashboard dev server**: it was stopped at the end of the session by Claude Code because the machine was low on memory (not a dashboard failure). Restart it with `pnpm --filter @sol2near/web dev`.

## 8. Remaining

- Disconnect test.
- A FUEL demonstration from the dashboard needs a **new** deposit: deposit → `execute_lp` → `register_position` must all fall within one 30-min season (+5 min grace). For a SUCCESS season, aim for ≥ 5 USDC in LP (≈ 12 USDC deposit, §5); then FUEL storage + claim after the season ends and the LP lock expires.
- The dashboard record `register_position #1` is still `awaiting_signature`: dismiss it after checking the Meteor history.
- MyNearWallet redirect flow: only Meteor was used live.
