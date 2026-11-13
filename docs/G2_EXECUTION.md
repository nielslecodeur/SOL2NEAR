# G2 — Execution log (NEAR testnet): Batch A done, Batch B done, Batch C in progress

Executed 2026-11-11 23:26 → 23:45 UTC after the lead's « FAUCET FAIT + OK BATCH A ».
Signer: `sol2near-dev.testnet` (keychain, near-cli-rs 0.31.1). Network: **NEAR testnet**. A5
(deliberate failure) skipped by decision of the lead. Nothing was deployed.

**Result: a real Ref LP position exists.** Pool **2951** USDC(tp)/wNEAR(tp) on
`ref-finance-101.testnet`, and `sol2near-dev.testnet` holds **1e24 LP shares** of it.
This proves LP held by the **dev account**, not yet by the Treasury (that comes in batch B/C).

## 1. Transactions

| Tx | Call | Hash (NearBlocks) | Status | Gas burnt | NEAR for gas | Measured effect |
|---|---|---|---|---|---|---|
| A1 | `usdc.tidepool-sandbox.testnet.storage_deposit(ref, registration_only)` 0.00125 | [HXi2gQ2i…6et](https://testnet.nearblocks.io/txns/HXi2gQ2io4nPgcL7jxRhmFSKik6ZiCoJCdez8E1mA6et) | SUCCESS | 2.09 Tgas | 0.000186 | Ref storage on USDC `{total 0.00125}` |
| A2 | `wnear.tidepool-sandbox.testnet.storage_deposit(ref)` 0.00125 | [9jL4rXNd…ci74](https://testnet.nearblocks.io/txns/9jL4rXNdwDe5H8TXAkvzA62DP4WRCQq7ebTZq7Gtci74) | SUCCESS | 2.08 Tgas | 0.000185 | Ref storage on wNEAR `{total 0.00125}` |
| A3 | `ref.storage_deposit(dev, registration_only false)` 0.1 | [H2kAbeaw…q7bc](https://testnet.nearblocks.io/txns/H2kAbeawwYfjwmev8tf7zqAXipuL8Sm3JxHLmXzKq7bc) | SUCCESS | 3.09 Tgas | 0.000287 | dev Ref storage total 0.1, used 0.00102 |
| A4 | `ref.register_tokens([usdc, wnear])` 1 yocto | [GRtRwU7f…p4zt](https://testnet.nearblocks.io/txns/GRtRwU7fm217zSogXwgBJfp8Wfub1VmZhJ2ZauGGp4zt) | SUCCESS | 4.12 Tgas | 0.000390 | registered 2 tokens; dev Ref storage used 0.00102 → 0.00398 |
| A6 | `usdc.ft_transfer_call(ref, 50 USDC, "")` | [Dhkba3eG…hG3z](https://testnet.nearblocks.io/txns/Dhkba3eGMVeU6Lop8R4yMrbckUH7DQ7YL2vXWfFShG3z) | SUCCESS (used 50000000) | 8.04 Tgas | 0.000738 | dev Ref deposit USDC 50 |
| A7 | `wnear.ft_transfer_call(ref, 14.0392 wNEAR, "")` | [GFCN2yYe…phqj](https://testnet.nearblocks.io/txns/GFCN2yYeGKYgLKpcVNkvcayr2xj1bocpd2T5owgYphqj) | SUCCESS (used all) | 8.05 Tgas | 0.000738 | dev Ref deposit wNEAR 14.0392 |
| A8 | `ref.add_simple_pool([usdc, wnear], 30)` 0.1 | [BXcJeRyX…7f7B](https://testnet.nearblocks.io/txns/BXcJeRyXUUEwniGP46KJeYRjWHxgHcPK2RCQdpYZ7f7B) | SUCCESS, **return `2951`** | 3.90 Tgas | 0.000346 | Ref refunded 0.09472 → **pool cost 0.00528 NEAR** |
| A9 | `ref.add_liquidity(2951, [50 USDC, 14.0392 wNEAR], min 99 %)` 0.01 | [5MahUPdU…fBRp](https://testnet.nearblocks.io/txns/5MahUPdUvWNSbD14RuijZXGTpHmA66ZpN67yR1EHfBRp) | SUCCESS, **return 1e24 shares** | 5.25 Tgas | 0.000480 | Ref refunded 0.00915 → **LP record cost 0.00085 NEAR**; log `Liquidity added …, minted 1000000000000000000000000 shares` |
| A10a | `usdc.ft_transfer_call(ref, 0.1 USDC, "")` | [ydtYCQd8…YMw](https://testnet.nearblocks.io/txns/ydtYCQd85BVR6kkjGmmQix2mm4dLugZ2dv3u4garYMw) | SUCCESS | 8.04 Tgas | 0.000737 | dev Ref deposit USDC 0.1 |
| A10b | `ref.swap(2951: 0.1 USDC → wNEAR, min 99 % of get_return)` 1 yocto | [5fXaJFp9…J8jv](https://testnet.nearblocks.io/txns/5fXaJFp9zArfH25iDyyZUijCgQ9VN1diUfKfWZeJJ8jv) | SUCCESS, return 27938455519693730700982 | 5.46 Tgas | 0.000524 | log `Swapped 100000 usdc… for 27938455519693730700982 wnear…`, `Exchange … got 598805084452194263 shares, No referral fee` |

Incidents (no effect on chain):
- PowerShell 5 stripped the JSON quotes: the CLI refused the first A1 locally ("Data not in JSON
  format") before signing. Every later call goes through Git Bash.
- The first A4 was rejected as `Transaction has expired` (stale block reference) and **not
  executed**: balance and state were unchanged. It was resent once (register_tokens is
  idempotent).
- `rpc.testnet.near.org` started answering `-429 … DEPRECATED`. Probes now default to
  `https://near-testnet.drpc.org`, cross-checked with `test.rpc.fastnear.com`.

## 2. LP proof (read-only, block ≥ 277283440, two RPC providers)

| Fact | Value |
|---|---|
| Pool id (from A8 return value) | **2951** |
| Kind / tokens (order) / fee | `SIMPLE_POOL` / `[usdc.tidepool-sandbox.testnet, wnear.tidepool-sandbox.testnet]` / 30 bps |
| Reserves after A9 | 50 000 000 USDC atomic (50 USDC) / 14 039 200 000 000 000 000 000 000 (14.0392 wNEAR) |
| Reserves after A10 swap | 50 100 000 / 14 011 261 544 480 306 269 299 018 |
| `get_pool_shares(2951, sol2near-dev.testnet)` | **1 000 000 000 000 000 000 000 000** |
| `mft_balance_of(":2951", sol2near-dev.testnet)` | 1 000 000 000 000 000 000 000 000 (same MFT ledger) |
| `get_pool_total_shares(2951)` | 1 000 000 598 805 084 452 194 263 (dev + exchange admin-fee shares from A10) |
| dev internal Ref deposits | USDC 0, wNEAR 0.027938455 (swap output, withdrawable) |
| Reproduce | `node scripts/probes/verify-testnet.mjs` → `PASS sol2near-dev.testnet holds 1000000000000000000000000 LP shares of pool 2951` |

## 3. Costs measured (hypotheses resolved)

| Hypothesis | Result |
|---|---|
| H3 `add_simple_pool` cost | **0.00528 NEAR** (528 B); excess of the attached 0.1 **refunded** by Ref |
| H4 `add_liquidity` storage | **0.00085 NEAR** for a new LP holder, taken from the **attached deposit**; excess refunded. Treasury attaches 0.005 → sufficient |
| H11 `swap` deposit | **1 yocto accepted**: Treasury's `launch_swap` is compatible |
| Ref account storage | base 0.00102 NEAR; +0.00296 NEAR for 2 registered tokens (total used 0.00398 of the 0.1) |
| Return formats | `ft_transfer_call` → `"<used>"`; `add_simple_pool` → `2951`; `add_liquidity` → `"<shares>"`; `swap` → `"<amount_out>"`: all match the Treasury callback types (U128 / u64) |
| H5 refund on unregistered deposit | not tested (A5 skipped by decision) |

NEAR accounting for the dev account: 4.992885010 → 4.879644366 = **0.113240644 NEAR**, of which
gas 0.004611, storage on token contracts 0.0025, Ref storage balance 0.1 (≈ 0.096 still
withdrawable), pool 0.00528, LP record 0.00085. This is within the 0.215 NEAR cap.
Test tokens used: 50.1 USDC and 14.0392 wNEAR. The wallet still holds 49.9 USDC and 25.9608 wNEAR.

## 4. Tests after batch A

No contract code had to change (every Ref behaviour matched the Treasury's assumptions), so the
wasm is unchanged: Treasury `73b99075…520e`, FUEL `a33678f6…bbac`. Re-run: `verify-testnet.mjs`
gives all checks passed. Unit suites unchanged: Treasury 34, FUEL 31, near-client 6, web 5.

## 5. Open risks

- **The Treasury path is still unproven on-chain**: deposit → `execute_lp` (3 chained receipts) →
  verified LP held by the Treasury. Batch C is the first real run.
- Pool 2951 is shallow (≈ 100 USD). The Treasury zap of 18 USDC swaps ≈ 8.3 USDC at ~4.18
  USDC/wNEAR versus ~3.56 on Tidepool. That is acceptable for a demo but must be stated, and the
  `plan-lp.ts` slippage guard covers it.
- Anyone can trade in pool 2951 between our plan and `execute_lp`. The min guards make the swap or
  add fail cleanly, and the Treasury then parks the funds in a resumable state.
- `near-cli` itself still uses `rpc.testnet.near.org`, which is deprecated and caused one expired
  transaction. Switch its testnet connection to drpc or fastnear before batch B (B0 below).

## 6. Batch B — exact procedure (NOT executed, requires « OK BATCH B »)

All on NEAR testnet; DEV = `sol2near-dev.testnet`, T = `treasury.sol2near-dev.testnet`,
F = `fuel.sol2near-dev.testnet`; commands run from Git Bash.

| # | Signer → receiver · action | Deposit / locked | Gas | Expected | Verify |
|---|---|---|---|---|---|
| B0 | local only: point near-cli testnet RPC to `https://near-testnet.drpc.org` (`near config edit-connection testnet --key rpc_url --value …`) | — | — | no more expired txs | `near config show-connections` |
| B1 | **T → T** · deploy `target/near/treasury/sol2near_treasury.wasm` (SHA-256 `73b99075d8df832e32da2bd53c91e20194539a5a72a67c11ba373c44e0fb520e`) with init `new({"usdc_token":"usdc.tidepool-sandbox.testnet","wnear_token":"wnear.tidepool-sandbox.testnet","ref_exchange":"ref-finance-101.testnet","pool_id":2951,"min_deposit":"1000000","lp_lock_duration_ns":"600000000000"})` | locks ≈ 2.503 NEAR | 100 Tgas | code_hash ≠ 1111…, `get_config.ready = false` | `view_account`, `get_config` |
| B2 | DEV → T · `setup({})` | 0.105 NEAR | 150 Tgas | event `setup_done {pool_id 2951, usdc_pool_index 0}`; T registered on Ref (0.1) and on both tokens; Ref already registered (refund expected) | `get_config.ready = true`, `storage_balance_of(T)` on Ref and tokens |
| B3 | DEV → F · `create-account fund-myself fuel.sol2near-dev.testnet '3 NEAR'` | 3 NEAR transfer | 30 Tgas | F exists with 3 NEAR | `view_account` |
| B4 | **F → F** · deploy `target/near/fuel/sol2near_fuel.wasm` (SHA-256 `a33678f60eb25e3db83074db4d052bf6e102bca7fd953834c65115a8f409bbac`) with init `new({"config":{"treasury_id":T,"ref_exchange":"ref-finance-101.testnet","pool_id":2951,"ecosystem_id":DEV,"liquidity_id":DEV,"team_id":DEV,"genesis_ns":"<now>","season_duration_ns":"1800000000000","registration_grace_ns":"300000000000","season_target_usdc":"5000000","season_reward_budget":"5000000000000000000000","season_burn":"10000000000000000000","min_lock_ns":"600000000000","vault_cap":"2000000000000000000000","team_cliff_ns":"3600000000000","team_vesting_ns":"36000000000000"}})` | locks ≈ 2.568 NEAR | 100 Tgas | 3 `ft_mint` events, total supply 1 000 000 FUEL | `ft_total_supply`, `get_buckets`, `get_reactor` |
| B5 | DEV → F · `storage_deposit({"account_id":DEV})` | `storage_balance_bounds.min`, read first | 30 Tgas | DEV registered (it already is as ecosystem holder → refund expected) | `storage_balance_of(DEV)` |

Budget for B: DEV ≈ 0.105 + 3.0 + gas ≈ 3.12 NEAR (has 4.8796); T locks ≈ 2.52 of its 5.0.

**Timing constraint for C:** FUEL's season 0 starts at `genesis_ns` (B4). Batch C (deposit →
`execute_lp` → `register_position`) must run within the first 30 min after B4 so the position
counts for season 0. The close is possible from genesis + 36 min, and the claim after the
Treasury lock (10 min after `execute_lp`). If B and C are approved together, the whole cycle fits
in ≈ 45 min.

### Batch C reminder (separate approval; details in `docs/G2_READINESS.md` §6)
C1 deposit 20 USDC → T (`{"action":"deposit"}`) · C2 `execute_lp` with the plan from
`node scripts/plan-lp.ts 2951 18000000 100`, computed just before (current preview: swap
8 323 187 USDC atomic, ≈ 9.68 USDC to LP) · C3 `verify_liquidity` · C4 `register_position(0)` ·
C5 `close_season(0)` · C6 `claim(0)` · C7 second claim, expected to fail.

## 7. Batch B progress (approved « OK BATCH B + C », 2026-11-11/12)

| Step | Hash | Result |
|---|---|---|
| B0 | — (local) | near-cli testnet `rpc_url` changed from `archival-rpc.testnet.fastnear.com` to `https://test.rpc.fastnear.com/` |
| B1 | [HJTW4c6u…yUpY](https://testnet.nearblocks.io/txns/HJTW4c6uNaSVmuzNRG84NcCQaRMeunAoiP3omquNyUpY) | Treasury deployed (wasm SHA-256 `73b99075…520e`), code_hash `8njzxUPU74wzskUUJ6QDjowp953JePSqL96ez5kqJ7F3`, 20.16 Tgas, storage 250 821 B (2.508 NEAR locked), config pool 2951 |
| B2 | [6sMPV5RT…eVgy](https://testnet.nearblocks.io/txns/6sMPV5RToZRd77cjaUa32QgpU9f8poWFawpFAKSEeVgy) | `setup` SUCCESS, 26.15 Tgas; event `setup_done {pool_id 2951, usdc_pool_index 0}`; `get_config.ready = true` |
| B3 | [Gvur4kwn…FCAY](https://testnet.nearblocks.io/txns/Gvur4kwnyth3VHKBXB9JCtsw9581YcPD1RdPxnoNFCAY) | `fuel.sol2near-dev.testnet` created with 3 NEAR (2026-11-12, re-approved « OK B3->C7 + push ») |
| B4 | [JBdFrx2j…rbBP](https://testnet.nearblocks.io/txns/JBdFrx2j7ToEWWY77aKpbpw8B6PivPhowM9ZZWQtrbBP) | FUEL deployed (SHA-256 `a33678f6…bbac`), 22.03 Tgas; 3 `ft_mint` (651k contract, 199k + 150k dev); supply 1 000 000; `genesis_ns` 1794469742578932153 = 07:49:02.578 UTC (final block time) |
| B5 | — (not sent) | unnecessary: dev already registered on FUEL as allocation holder (`storage_balance_of` = 0.00125) |

## 8. Batch C — first real Treasury + FUEL cycle

| Step | Hash | Result |
|---|---|---|
| C1 | [AsD2o2aV…ZWzw](https://testnet.nearblocks.io/txns/AsD2o2aVxkSmhm4c3TVsLs9aZgKjMTog2KW42pieZWzw) | 20 USDC `ft_transfer_call` → Treasury, used 20000000; event `deposit_allocated` #0: **18 / 1.6 / 0.4** |
| C2 | [4F2wXqzm…SSHA](https://testnet.nearblocks.io/txns/4F2wXqzmyBVaPqKa6mE3KMFjFv2S3U3GxXJYJfNsSSHA) | `execute_lp` (plan from `plan-lp.ts`: swap 8323187, min out 1971050059226938558048313, min amounts 9580044 / same) — **whole pipeline in one tx, 37.27 Tgas**: Ref `Swapped 8323187 usdc for 1990959655784786422271024 wnear`, `Liquidity added [9676812 usdc, 1990959540775334128929981 wnear], minted 165640253516145704019022 shares`; events amm_deposit_confirmed → swap_confirmed → lp_confirmed (verified) → proof_of_liquidity |
| C3 | [8DCCtF7y…MrkA](https://testnet.nearblocks.io/txns/8DCCtF7yafVwXnGhziTAAHvxhS94nZiTPXZk5ry3MrkA) | `verify_liquidity`: `{onchain_shares = recorded_shares = 165640253516145704019022, ok: true}` at block 277334232 |
| C4 | [CoAgrgQE…Lk6o](https://testnet.nearblocks.io/txns/CoAgrgQEhmktNEK1hvgZpwUHjsaTR6XvS9z1NSNpLk6o) | FUEL `register_position(0)` → `position_admitted` season 0: usdc_in_lp 9676812 → reward **9.676812 FUEL** (creator 7.7414496 / community 1.9353624) |
| C5 | [DUuoq2XZ…haH9](https://testnet.nearblocks.io/txns/DUuoq2XZsmVbwp8zjzhW3gHRqjiDwokwbTMSNufdhaH9) | `close_season(0)` (2026-11-13): event `season_closed {status Success, progress 9676812 / target 5000000, burned 0, level 1}` |
| C6 | [6g13fiwv…hXxu](https://testnet.nearblocks.io/txns/6g13fiwvEbSoHhYLXGkDcN9tEsPLG2LXic88bmP3hXxu) | `claim(0)`: `ft_transfer` fuel → dev **7.7414496 FUEL** + event `reward_claimed`; dev balance 349 000 → 349 007.7414496 FUEL; position `claimed: true`, `reward_status: Claimed` |
| C7 | [J8UEKyZy…AoWHi](https://testnet.nearblocks.io/txns/J8UEKyZyyYpHrzW8HTJiJ1tqtq23GdkX2VA8HdYAoWHi) | second `claim(0)` **fails as expected**: `Smart contract panicked: ERR_ALREADY_CLAIMED` (gas only, balance unchanged) |

**Batch C complete**: deposit → Treasury LP on Ref → on-chain verification → FUEL admission → season close → single claim, all with transaction hashes.

State after C2 (read-only): deposit #0 `LpConfirmed`, `lp_verified: true`, pool 2951, confirmed block 277334178 (07:49:55 UTC), unlock 07:59:55 UTC; **Ref `get_pool_shares(2951, treasury)` = `mft_balance_of` = Treasury `recorded_shares` = 165640253516145704019022**; reconciliation `usdc_swapped 8323187 + usdc_in_lp 9676812 + dust 1 = 18000000` exact; Treasury Ref deposits (USDC 1, wNEAR 0.000000115009452293341043) = recorded dust exactly; Treasury USDC wallet 2.0 = reserve 1.6 + community 0.4; no job in flight.

Zap cost on the shallow pool: 8.323187 USDC bought 1.990960 wNEAR (4.18 USDC/wNEAR vs Tidepool 3.56): a demo-pool effect, stated honestly.
