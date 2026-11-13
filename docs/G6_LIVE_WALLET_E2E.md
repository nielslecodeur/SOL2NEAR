# G6 — Live NEAR wallet, first Treasury deposit from the dashboard

Date: 2026-11-13. Solo project. **Status: deposit step PASSED; LP and FUEL steps NOT_RUN (each needs its own approval).**

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
| E1 | `execute_lp(1)` | NOT_RUN | needs approval (see §5 on the FUEL season) |
| E2 | `storage_deposit` on FUEL for `lowarena9362.testnet` | NOT_RUN | needs approval (needed before any claim) |
| E3 | `register_position(1)` | NOT_RUN | needs approval, within the LP confirmation season (+5 min grace) |
| E4 | `close_season` / `claim` | NOT_RUN | depends on E1–E3 and the season result |

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

## 7. Remaining

- Disconnect test.
- E1–E4 (LP, FUEL storage, register, close / claim), each needing your approval.
- MyNearWallet redirect flow: only Meteor was used live.
