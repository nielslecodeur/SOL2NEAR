# G8 — Final execution: deposit #3 (the bridged funds)

Date: 2026-11-14. Solo project. Proofs: [`G8_PROOF_LEDGER.md`](G8_PROOF_LEDGER.md). Release: [`FINAL_RELEASE_AUDIT.md`](FINAL_RELEASE_AUDIT.md).

**Verdict: `G8 READY FOR USER SIGNATURE`.**

| | |
|---|---|
| Done | the Solana → Tidepool → NEAR → Treasury part is proven, and the correlation is re-verified |
| Not done | the LP of deposit #3 and its FUEL steps: **no transaction was signed or sent** |
| What it needs | one signature by the creator, `lowarena9362.testnet`, which only you can give. Then up to three FUEL transactions, each approved separately |

## 1. Initial state of deposit #3 (read-only, 2026-11-14 13:52 UTC, block 277 665 469)

`node scripts/probes/g8-audit.mjs` → `packages/near-client/src/fixtures/g8_audit_2026-11-14.json`

| # | Check | Result |
|---|---|---|
| 1 | Id, contract | deposit **#3** on `treasury.sol2near-dev.testnet`. Deployed code `8njzxUPU…7F3` = SHA-256 `73b99075…520e`, the local build of `contracts/treasury`, checked byte for byte |
| 2 | Creator | `lowarena9362.testnet` |
| 3 | Origin / correlation | Tidepool record of deposit address `5gUT7A3Z…` lists the Solana tx **and** the NEAR settlement tx, and its intent hashes equal the on-chain `intent_hash` events (three checks `true`, see the ledger §2). The deposit holds the creator's whole balance: 86 USDC already there + 1.9948 bridged |
| 4 | Solana source tx | `bGUicpgy…887R`: finalized, `err = null`, `transferChecked` 2 000 000 to `5gUT7A3Z…` |
| 5 | Tidepool status | `SUCCESS`, 2026-11-13 21:39:08 UTC, amountOut 1 994 800 |
| 6 | USDC received on NEAR | 1.994800 (`J58H2uyu…`, `ft_transfer` verifier → lowarena9362.testnet) |
| 7 | Treasury deposit tx | `J7uMjikj…Bdhz`, FINAL, `ft_transfer_call` 87 994 800, fully used |
| 8 | Amount accepted | 87.994800 USDC |
| 9 | Split | 79.195320 / 7.039584 / 1.759896 = 90 / 8 / 2 ✓ |
| 10 | LP budget | **79.195320 USDC**, still in the Treasury's USDC balance (`pending_budget_total` 79 195 320) |
| 11 | Jobs | `get_in_flight` = **null** (no job of any deposit) |
| 12 | Swaps | none: `usdc_swapped` 0, `plan` null |
| 13 | Ref state | Treasury's Ref deposits are 3 USDC atomic + 0.234833 wNEAR, equal to `ref_expected_*`: the dust of earlier deposits, **not** deposit #3 |
| 14 | LP shares | deposit #3 `lp_shares` 0. Treasury's Ref shares (268 750 243 691 052 670 214 318) = `recorded_shares` = the sum of deposits #0–#2. `last_proof.ok = true` |
| 15 | Callbacks | none pending, `last_error` null |
| 16 | Recovery needed | none. Books = balances: Treasury USDC 91.394800 = reserves 9.759584 + community 2.439896 + pending 79.195320 |

**Status: `READY_FOR_LP_EXECUTION`.** The deposit is in `BudgetAllocated`, the only state from which `execute_lp` starts a fresh LP. No double spend is possible: the budget has never left the Treasury.

## 2. Why it is blocked today (not by the contract)

The deployed Treasury has **no price-impact guard**. `execute_lp` only requires:
- the creator as caller;
- no job in flight;
- `swap_amount_in > 0`, `min_swap_out > 0`, two `min_amounts`;
- ≥ 200 Tgas.

The **dashboard** refuses any LP plan with a price impact ≥ 20 % (`IMPACT_BLOCK_BPS`, set in G7 from the measured LPs: 1.6 %, 7.2 %, 14.5 %).

Deposit #3's budget (79.2 USDC) is about the size of the pool (80.7 USDC / 14.01 wNEAR), so the optimal zap has a **29.13 %** impact. The dashboard shows it and opens no wallet.

The V3 Treasury has no `abort` and no way to return an LP budget. These 79.195320 USDC can **only** go to pool 2951, or stay pending forever.

## 3. The prepared transaction (computed from live Ref reads, nothing invented)

Same code as the dashboard's *Deploy liquidity* (`planFromPool` → `previewSwap` / `optimalZapIn`, 1 % slippage), on `get_pool(2951)` read at 2026-11-14 ≈ 14:00 UTC. Reserves 80 699 997 USDC / 14 011 261 309 647 048 936 214 624 wNEAR, fee 30 bps, unchanged since G7 (nobody trades this pool).

| Field | Value |
|---|---|
| **Signer** | `lowarena9362.testnet` (the creator; `ERR_NOT_CREATOR` for anyone else). Balance 4.935185 NEAR |
| **Contract** | `treasury.sol2near-dev.testnet` |
| **Method** | `execute_lp` |
| **Arguments** | `{"deposit_id":"3","plan":{"swap_amount_in":"32943229","min_swap_out":"4012435324977327877032790","min_amounts":["45789570","4012435324977327877032790"]}}` |
| **Attached deposit** | 0 (the Treasury pays Ref's add_liquidity storage itself) |
| **Gas** | 300 Tgas (contract minimum ≥ 200; G6-LP2 burnt 37 Tgas ≈ 0.0034 NEAR; at most 0.03 NEAR is reserved, the unused part is refunded) |
| Pool / tokens | Ref `ref-finance-101.testnet` #2951 = `usdc.tidepool-sandbox.testnet` / `wnear.tidepool-sandbox.testnet` (fixed in the Treasury config, no other route possible) |
| Swap | 32.943229 USDC → **4.052964974724573613164435 wNEAR** = Ref's own `get_return`, identical to the plan |
| min_swap_out | 4.012435324977327877032790 wNEAR (−1 %) |
| add_liquidity | 46.252091 USDC + 4.052964974724573613164435 wNEAR; min_amounts 45.789570 USDC / 4.012435… wNEAR (−1 %) |
| Pool fee | 30 bps of the swap ≈ 0.098829 USDC |
| **Price impact** | **29.13 %** — the test wNEAR price in pool 2951 goes from 5.76 to 11.41 USDC (+98 %) |
| Expected LP shares | ≈ 516 402 998 456 275 700 899 933 (Ref simple-pool formula; the contract records Ref's real number, not this) |
| Expected dust | ≈ 2 atomic USDC + 6 atomic wNEAR, left on Ref and booked as dust (V3 cannot recover dust) |
| Value of the position | redeemable right after: 46.252089 USDC + 4.0530 wNEAR, which is **≈ 69.60 USDC at the pre-trade price** (−12 % vs the 79.20 budget), or 92.50 at the post-trade price. All test tokens, no value |
| Storage | the Treasury already holds shares of pool 2951 (no new Ref registration); its Ref storage is 0.1 NEAR deposited, 0.00398 used |
| Plan deadline | **none**: the deployed V3 `LpPlan` has no deadline field. The protection is `min_swap_out` / `min_amounts`: if the pool moves more than 1 %, the call stops safely (below). Recompute the plan right before signing |
| Conflicting job | none (`get_in_flight` = null) |

**Expected effects** (in one transaction, with cross-contract callbacks):
- events `amm_deposit_confirmed` → `swap_confirmed` → `lp_confirmed` + `proof_of_liquidity`;
- deposit #3 becomes `LpConfirmed`, with `lp_verified = true`, `pool_id = 2951`;
- `usdc_swapped = 32 943 229`, `usdc_in_lp ≈ 46 252 089`, `unlock_at = confirmation + 600 s`;
- Treasury `pending_budget_total` → 0, `recorded_shares` += the minted shares.

**Failure conditions** (nothing is lost; nothing is retried automatically):

| Failure | What happens |
|---|---|
| Ref refuses the deposit | the budget stays `BudgetAllocated`, `last_error` set |
| Pool moved > 1 % before the swap | Ref panics on `min_amount_out`; the USDC sits on Ref, status `InRef`. A new plan resumes from there (a new signature) |
| add_liquidity below `min_amounts` | status `Swapped`; resume with a new plan |
| Lost callback (gas) | `reconcile` (permissionless, after its timeout) re-derives the stage from Ref balances |
| Not enough gas | refused before anything moves |

**Risks:**
- **29 % price impact by design.** The position pays the swap fee and shifts the test pool price for every LP of pool 2951: deposits #0–#2 and the dev account.
- **Irreversible:** the V3 LP exit (`withdraw_lp`) has never been exercised on-chain and is not offered by the dashboard.
- Test tokens only.

### How it can be signed (your choice; I will not sign)

| Option | What | Trade-off |
|---|---|---|
| **A. CLI (no code change)** | You run, with your own credentials for `lowarena9362.testnet` (never shared with me): `near contract call-function as-transaction treasury.sol2near-dev.testnet execute_lp json-args '{"deposit_id":"3","plan":{"swap_amount_in":"32943229","min_swap_out":"4012435324977327877032790","min_amounts":["45789570","4012435324977327877032790"]}}' prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as lowarena9362.testnet network-config testnet sign-with-keychain send` | needs the account's key in your local near-cli keychain. The dashboard guard stays untouched |
| B. Dashboard override | allow LP plans ≥ 20 % **only** after a typed acknowledgement, testnet pool 2951 only, then sign in Meteor as in G6 | changes a UI safety rule: **needs your explicit decision**. Not implemented |
| C. Fresh small bridge instead | bridge ~2 USDC again and deposit exactly that amount (1.8 USDC LP budget, ≈ 1.4 % impact) | a second funding operation (you asked to avoid it). Cleaner correlation (deposit amount = bridged amount), but **deposit #3 stays pending forever** |

**Recommendation: A.** It closes G8 on the real bridged deposit without touching any safety code. The 29 % impact on a test pool is the honest price of a test pool smaller than the deposit.

## 4. Post-transaction verification (Phase C — to run only after your signature)

Read-only, in this order (`node scripts/probes/g8-audit.mjs` covers 5–9):
1. hash → `EXPERIMENTAL_tx_status` FINAL, `SuccessValue`;
2. every receipt successful, and the events `amm_deposit_confirmed`, `swap_confirmed`, `lp_confirmed`, `proof_of_liquidity` for `deposit_id 3`;
3. no `lp_job_failed`, and `get_in_flight` = null;
4. `get_deposit(3)`: `LpConfirmed`, `lp_verified`, `pool_id 2951`, `lp_shares > 0`, and `usdc_swapped + usdc_in_lp + dust_usdc = 79 195 320`;
5. Ref `get_pool_shares(2951, Treasury)` = old 268 750 243 691 052 670 214 318 + deposit #3 `lp_shares` = `get_accounting.recorded_shares`;
6. Ref `get_deposits(Treasury)` = `ref_expected_*` (dust only);
7. Treasury USDC balance = reserves + community + pending (pending now 0);
8. pool 2951 reserves moved by exactly the swap + add;
9. dashboard (`#/dashboard`, account lowarena9362.testnet): deposit #3 `LP CONFIRMED`, BACKED ON REF;
10. no double count: a second `execute_lp(3)` must fail with `ERR_NOT_RESUMABLE` (this is a read of the code path; **do not** send it).

If anything differs: stop, reconcile from the on-chain state, document, and ask before any other transaction.

## 5. FUEL (Phase D) — admissible, but time-bound

Rules of the deployed FUEL (`contracts/fuel/src/lib.rs`, code `a33678f6…bbac`):
- the position's season = the season of `lp_confirmed_at`;
- seasons last **30 min** from genesis;
- registration must happen before season end + **5 min** grace (`ERR_REGISTRATION_WINDOW_CLOSED` after that, as in G6-REJ);
- the season can be closed at end + 5 min + 60 s;
- claim after the close (Success) **and** after `unlock_at` (+600 s);
- the creator is already registered on FUEL storage.

`register_position`, `close_season` and `claim` are **permissionless**: rewards always go to the Treasury-recorded creator.

Expected, if registered in time:
- reward = `usdc_in_lp` × 1 FUEL/USDC ≈ **46.252 FUEL**, of which 80 % = **≈ 37.0017 FUEL** to the creator;
- caps: vault cap 2 000, season budget 5 000, pol_available 599 984;
- the season reaches its 5 USDC target → Success, level 2 → 3.

| # | Next transactions after the LP | Who | When | Each needs your approval |
|---|---|---|---|---|
| F1 | `fuel.register_position({"position_id":"3"})`, 100 Tgas, 0 NEAR | anyone (dashboard: *Register for FUEL*) | **before the LP's season end + 5 min**; worst case ≈ 5 min, best ≈ 35 min after the LP | yes |
| F2 | `fuel.close_season({"season_id":S})`, 50 Tgas | anyone | ≥ season end + 6 min | yes |
| F3 | `fuel.claim({"position_id":"3"})`, 50 Tgas | anyone (paid to the creator) | after F2 (Success) and `unlock_at` | yes |

A **missed window is final**: the FUEL rules are not bypassed and the calendar is not touched. The position would stay `LP verified — FUEL not eligible` (status `G8 LP VERIFIED — FUEL NOT ELIGIBLE`).

## 6. Local fixes made during this checkpoint (no contract touched)

- Read-only probe `scripts/probes/g8-audit.mjs`: deposit #3, books vs balances, FUEL clock, G7 correlation (Solana tx, Tidepool record, on-chain intent hashes).
- DCL cards: a quote that could not be **read** (HTTP 429) was classified `BLOCKED_ROUTE`. It now concludes nothing (`OBSERVE_ONLY`, unreadable); only a real DCL answer of 0 means "no route" (+1 assertion).
- e2e split into **offline** (deterministic, 0 retry) and **live** (smoke, 1 retry): see `FINAL_RELEASE_AUDIT.md` §4.

## 7. Verdict

**`G8 READY FOR USER SIGNATURE`.**
- One transaction is waiting: `execute_lp(3)` above, signed by `lowarena9362.testnet`.
- Then F1–F3 for FUEL, each separately approved, within the window of §5.
- If F1 is missed, the final status will be `G8 LP VERIFIED — FUEL NOT ELIGIBLE`. If F1–F3 succeed, it will be `G8 COMPLETE — ONCHAIN VERIFIED`.
