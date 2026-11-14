# G2 — Pre-deployment readiness (NEAR testnet)

Prepared 2026-11-11 ~22:30 UTC on branch `feat/core`. **Nothing has been signed, deployed or pushed.**
All facts below come from read-only RPC calls on `https://rpc.testnet.near.org`, Tidepool `GET` /
dry quotes, and local tests. Network: **NEAR testnet only** (Solana devnet for the bridge leg).

## 1. Summary

| Question | Answer |
|---|---|
| Ref compatibility | **Confirmed for everything checkable read-only**; exact storage costs are measured on the first receipts (safe: an under-funded call fails and refunds) |
| Pool USDC(tp)/wNEAR(tp) | **Does not exist → to be created** on `ref-finance-101.testnet` (permissionless); expected id **2951** if nobody creates a pool first |
| Budget | **No faucet top-up needed**: dev 4.99289 NEAR (needs ≥ 3.45), treasury 5.0 NEAR (needs ≥ 2.65) |
| Critical risks A/B | **Fixed** (§5), with new tests |
| Tests | Treasury 34, FUEL 31, near-client 6, web 5, all passing; wasm built with cargo-near |
| Blocking prerequisite | **You** claim the Tidepool faucet for `sol2near-dev.testnet` (site-only, from ~23:20 UTC) |

## 2. Ref / Rhea audit (`ref-finance-101.testnet`)

| Check | Result | How verified |
|---|---|---|
| Contract and state | v**1.9.19**, `state: Running`, owner `reflabs.sputnikv2.testnet` (DAO), 4 guardians, `admin_fee_bps` 2000 | `metadata` |
| Pools | 2 951; **none contains** `usdc.tidepool-sandbox.testnet` or `wnear.tidepool-sandbox.testnet` | full `get_pools` scan |
| Whitelist | neither token is whitelisted → each depositor calls `register_tokens` (1 yocto, guard verified) | `get_whitelisted_tokens`, view-probe |
| Non-whitelisted tokens in pools | accepted (pools 2948–2950 use non-whitelisted tokens) | `get_pools` |
| Pool creation | `add_simple_pool` permissionless (reaches `storage_write`, no owner check before it) | view-probe |
| Ref storage per account | min **0.00102 NEAR** (`E17` below) | `storage_balance_bounds` |
| Ref registered on Tidepool tokens | **No** for both → `storage_deposit` 0.00125 NEAR each (min = max) | `storage_balance_of`, `storage_balance_bounds` |
| Deposit | `ft_transfer_call(ref, amount, msg "")` | NEP-141 standard + Ref doc |
| Swap | `swap(actions, referral_id)`; exists; deposit guard **unknown (H11)**, Treasury attaches 1 yocto | view-probe |
| Add liquidity | `add_liquidity(pool_id, amounts, min_amounts?)`, **≥ 1 yocto** (`E35`) | view-probe |
| LP shares | MFT `":<pool_id>"`, 24 decimals; read with `get_pool_shares(pool_id, account)` or `mft_balance_of(":<id>", account)` | `mft_metadata`, views |
| Swap math | local formula = live `get_return` exactly | `packages/near-client` test |
| Source code | `github.com/ref-finance/ref-contracts` not public (404); no other public repo found | GitHub API |

**Not provable read-only:** the exact NEAR charged by `add_simple_pool` (H3) and `add_liquidity`
(H4), the refund on an unregistered deposit (H5), and the 1-yocto deposit on `swap` (H11). Safe
attachments cap each one: `add_simple_pool` 0.1 NEAR, dev `add_liquidity` 0.01 NEAR. An
insufficient deposit makes the receipt fail and the attached NEAR comes back. Batch A (§6)
measures them, and the Treasury constant `ADD_LIQ_DEPOSIT` (0.005 NEAR) is adjusted before G3 if
needed.

## 3. Exact tokens and accounts

| Role | Account | Decimals | Note |
|---|---|---|---|
| Test USDC (NEAR) | `usdc.tidepool-sandbox.testnet` | 6 | Tidepool, "no value", NEP-141 + NEP-145 |
| Test wNEAR (NEAR) | `wnear.tidepool-sandbox.testnet` | 24 | Tidepool. **Not** `wrap.testnet` |
| Test USDC (Solana devnet) | mint `7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr` / `nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet` | 6 | bridge leg (teammate) |
| AMM | `ref-finance-101.testnet` | — | official Ref/Rhea testnet exchange |
| Dev / creator / signer | `sol2near-dev.testnet` | — | 4.99289 NEAR, keys in Windows keychain |
| Treasury | `treasury.sol2near-dev.testnet` | — | 5.0 NEAR, no code yet |
| FUEL | `fuel.sol2near-dev.testnet` | 18 | **does not exist yet** |

No mainnet token or address appears in any testnet flow.

## 4. Budget (live network values: 1e19 yocto/byte storage, gas price 1e8 yocto/gas → 1 Tgas = 0.0001 NEAR)

**Locked as storage** (stays on the account, recoverable by deleting state):

| Item | Bytes / basis | NEAR |
|---|---|---|
| Treasury wasm | 250 329 B | 2.5033 |
| Treasury state (config + a few deposits) | ~2 KB | 0.02 |
| FUEL wasm | 256 801 B | 2.5680 |
| FUEL state (token ledger, metadata, config, positions, season) | ~2.5 KB | 0.025 |
| FUEL account itself | 182 B | 0.0018 |

**Deposits paid to other contracts** (storage balances, mostly withdrawable later):

| Item | Payer | NEAR |
|---|---|---|
| Ref on USDC + wNEAR (`storage_deposit`) | dev | 0.0025 |
| Dev on Ref (`storage_deposit`, excess withdrawable) | dev | 0.1 |
| `add_simple_pool` (≤ attached; excess expected refunded, H3) | dev | ≤ 0.1 |
| Dev `add_liquidity` (H4) | dev | ≤ 0.01 |
| Optional H5 test (Ref on USDT) | dev | 0.00125 |
| Treasury `setup()` (Ref 0.1 + 4 × 0.00125) | dev attaches | 0.105 |
| Treasury `add_liquidity` per LP job | Treasury balance | 0.005 |
| Dev on FUEL (`storage_deposit`, to receive the claim) | dev | ≤ 0.0125 |

**Gas burnt** (paid by the signer, only for gas actually used): ~22 transactions, most < 30 Tgas
(< 0.003 NEAR), plus `execute_lp` and the deploys up to ~0.03 each. **Estimate 0.05–0.10 NEAR, worst
case 0.4 NEAR.**

| Account | Minimum | Recommended | Has | Top-up needed |
|---|---|---|---|---|
| `sol2near-dev.testnet` | 3.45 (incl. 2.7 to fund FUEL) | 4.0 (3.0 to FUEL) | **4.99289** | no |
| `treasury.sol2near-dev.testnet` | 2.65 | 3.0 | **5.0** | no |
| `fuel.sol2near-dev.testnet` | 2.62 | 3.0 | funded by dev at creation | — |

If a top-up ever becomes necessary for an *existing* account, use **https://near-faucet.io/**
(listed by docs.near.org). `near create-account … --useFaucet` only works when creating an
account. **The Tidepool faucet is used only for test tokens** (USDC / USDT / wNEAR), never for NEAR.

## 5. Vulnerabilities fixed in this gate

| # | Risk | Fix | Tests |
|---|---|---|---|
| V1 | Treasury could mark an LP `lp_verified` when the Ref **deposits** view failed. `usdc_in_lp` was then an upper bound (dust counted as LP) | `lp_verified` now requires **both** views (`get_pool_shares` and `get_deposits`) | `unverified_when_consumed_amounts_cannot_be_read` |
| V2 | FUEL trusted `usdc_in_lp` blindly | FUEL re-checks the Treasury's books: (1) `lp_budget/reserve/community` = exact 90/8/2 of the credited `amount`; (2) **`usdc_swapped + usdc_in_lp + dust_usdc == lp_budget`**. `usdc_swapped` is a new Treasury field set when the swap is *confirmed*, not taken from the user's plan, which a resumed plan could change | `rejected_positions_write_nothing` (inflated, bad split), Treasury `happy_path…` (reconciliation) |
| V3 | A season could close before the late proofs of its last positions arrived | **Deterministic window by request time.** A position confirmed in season *k* counts for *k* iff `register_position` was *called* before `end_k + registration_grace`. `close_season(k)` is allowed only from `end_k + grace + 60 s`. A callback that still lands after the close is refused: no retroactive reward, no move to *k+1*. Positions are keyed by id, so each is counted once | `registration_window_boundary_is_by_request_time`, `close_waits_for_grace_and_settlement`, `late_callback_after_close_is_refused_not_retroactive`, `concurrent_proofs_in_one_block_are_each_counted_once` |

Why `usdc_in_lp` cannot be inflated by a user:
- the credited `amount` comes from `ft_on_transfer`, whose predecessor must be the USDC contract;
- the plan only says how much to swap. The amounts actually used are measured from Treasury's
  **own** Ref deposit balance deltas, and capped by the plan;
- Ref credits a deposit to its *sender*. If someone could credit Treasury's Ref balance (H12,
  unverified), that would *lower* `usdc_in_lp`, never raise it;
- FUEL then reconciles every USDC and cross-checks the share backing on Ref.

**Residual (documented, not fixed):**
- Capital recycling: deposit, wait for the lock, withdraw, deposit again. It is bounded by the
  2 000 FUEL / 30-day vault cap and by `min_lock`, which is 10 min in the demo and 30 days in
  production.
- The **global LP lock** in the Treasury serializes creators. It is safe: one job at a time is
  what makes the deltas unambiguous (`one_lp_job_at_a_time`), and `reconcile` releases a stuck job
  after 10 min. Its cost is throughput, accepted for the MVP.

## 6. Transactions — exact list (nothing executed)

Shorthand: `call <contract> <method> <json> <deposit> <gas> <signer>` =
`near contract call-function as-transaction <contract> <method> json-args '<json>' prepaid-gas '<gas>' attached-deposit '<deposit>' sign-as <signer> network-config testnet sign-with-keychain send`.
DEV = `sol2near-dev.testnet`, REF = `ref-finance-101.testnet`, USDC/WNEAR = Tidepool tokens, T = treasury, F = fuel.

### Batch 0 — your action, no signature by me (from ~23:20 UTC)
Claim **https://app.usetidepool.tech/faucet**, mode *wallet*, account `sol2near-dev.testnet`.
Expected: 100 USDC, 100 USDT, 40 wNEAR (+ others), with storage auto-registered.
Verify: `ft_balance_of` on each token (I run it, read-only).

### Batch A — G2: real pool and LP on Ref (signer DEV, all on NEAR testnet)

| # | Receiver · method | Args | Deposit | Gas | Expected result | Verify | Failure risk |
|---|---|---|---|---|---|---|---|
| A1 | USDC · `storage_deposit` | `{"account_id":REF,"registration_only":true}` | 0.00125 NEAR | 30 Tgas | Ref registered on USDC | `storage_balance_of(REF)` ≠ null | none known |
| A2 | WNEAR · `storage_deposit` | same | 0.00125 NEAR | 30 Tgas | idem on wNEAR | idem | none known |
| A3 | REF · `storage_deposit` | `{"account_id":DEV,"registration_only":false}` | 0.1 NEAR | 30 Tgas | DEV has a Ref storage balance | `storage_balance_of(DEV)` | none known |
| A4 | REF · `register_tokens` | `{"token_ids":[USDC,WNEAR]}` | 1 yocto | 30 Tgas | tokens allowed for DEV | `get_user_whitelisted_tokens(DEV)` | storage too low (then top up A3) |
| A5 (opt., H5) | USDT · `storage_deposit` then `ft_transfer_call` | REF, then `{"receiver_id":REF,"amount":"1000000","msg":""}` | 0.00125 NEAR / 1 yocto | 30 / 100 Tgas | **refund**: USDT not registered on Ref for DEV | DEV USDT balance unchanged | proves the failure path; costs gas only |
| A6 | USDC · `ft_transfer_call` | `{"receiver_id":REF,"amount":"50000000","msg":""}` | 1 yocto | 100 Tgas | 50 USDC in DEV's Ref deposit | `get_deposits(DEV)` | refund if A1/A4 missing |
| A7 | WNEAR · `ft_transfer_call` | `{"receiver_id":REF,"amount":"13440000000000000000000000","msg":""}` | 1 yocto | 100 Tgas | 13.44 wNEAR in deposit (≈ Tidepool price 3.72; recomputed just before) | `get_deposits(DEV)` | idem |
| A8 | REF · `add_simple_pool` | `{"tokens":[USDC,WNEAR],"fee":30}` | 0.1 NEAR | 50 Tgas | returns the new pool id (expected 2951) | `get_number_of_pools`, `get_pool(id)` = SIMPLE_POOL, our tokens | under-funded → fails and refunds (measure H3) |
| A9 | REF · `add_liquidity` | `{"pool_id":id,"amounts":["50000000","13440000000000000000000000"],"min_amounts":["49500000","13305600000000000000000000"]}` | 0.01 NEAR | 100 Tgas | DEV holds LP shares | `get_pool_shares(id, DEV)` > 0, `mft_balance_of(":id", DEV)` | under-funded → fails, funds stay in deposit (measure H4) |
| A10 (H11) | USDC · `ft_transfer_call`, then REF · `swap` | 0.1 USDC; `{"actions":[{"pool_id":id,"token_in":USDC,"amount_in":"100000","token_out":WNEAR,"min_amount_out":"1"}]}` | 1 yocto each | 100 Tgas | wNEAR received in DEV's deposit | `get_deposits(DEV)` | if 1 yocto is refused, fix `launch_swap` before G3 |

Batch A costs ≤ 0.215 NEAR in deposits (part refundable) plus ~0.01 NEAR of gas, and uses 50.1
test USDC and 13.44 test wNEAR. After it I read every receipt (`EXPERIMENTAL_tx_status`) and
record H3/H4/H5/H11 plus the pool id here.

### Batch B — G3: deploy (separate approval)

| # | Signer → receiver · action | Deposit / locked | Gas | Expected | Verify |
|---|---|---|---|---|---|
| B1 | **T → T** · deploy `target/near/treasury/sol2near_treasury.wasm` (SHA-256 `73b99075…520e`) + `new` | locks 2.50 NEAR | 100 Tgas | code deployed, config fixed (pool id from A8, lock 10 min, min 1 USDC) | `view_account` code_hash, `get_config` |
| B2 | DEV → T · `setup` | 0.105 NEAR | 150 Tgas | event `setup_done`, `ready: true`, `usdc_pool_index` | `get_config`, `storage_balance_of(T)` on Ref and tokens |
| B3 | DEV → F · create account | 3.0 NEAR transfer | 30 Tgas | `fuel.sol2near-dev.testnet` exists | `view_account` |
| B4 | **F → F** · deploy `target/near/fuel/sol2near_fuel.wasm` (SHA-256 `a33678f6…bbac`) + `new` (demo config §7) | locks 2.57 NEAR | 100 Tgas | 3 `ft_mint` events, supply 1 000 000 | `ft_total_supply`, `get_buckets`, `get_reactor` |
| B5 | DEV → F · `storage_deposit` `{"account_id":DEV}` | bounds read first (≤ 0.0125) | 30 Tgas | DEV can receive FUEL | `storage_balance_of(DEV)` |

### Batch C — first real cycle (separate approval; must start ≤ 25 min after B4 so it fits season 0)

| # | Signer → receiver · method | Amount | Gas | Expected | Verify |
|---|---|---|---|---|---|
| C1 | DEV → USDC · `ft_transfer_call` `{"receiver_id":T,"amount":"20000000","msg":"{\"action\":\"deposit\"}"}` | 20 test USDC + 1 yocto | 100 Tgas | event `deposit_allocated`: 18 / 1.6 / 0.4 | `get_deposit("0")`, `get_accounting`, `ft_balance_of(T)` = 20 |
| C2 | DEV → T · `execute_lp` `{"deposit_id":"0","plan":<node scripts/plan-lp.ts id 18000000 100>}` | 0 | **300 Tgas** | `amm_deposit_confirmed` → `swap_confirmed` → `lp_confirmed` (verified) | `get_deposit("0")` LpConfirmed, `lp_verified: true`, `usdc_swapped + usdc_in_lp + dust = 18`; Ref `get_pool_shares(id, T)` = recorded |
| C3 | DEV → T · `verify_liquidity` | 0 | 50 Tgas | event `proof_of_liquidity` ok | `get_last_proof` |
| C4 | DEV → F · `register_position` `{"position_id":"0"}` | 0 | 100 Tgas | event `position_admitted` (≈ 9.7 FUEL: 7.7 creator / 1.9 community, from the measured `usdc_in_lp`) | `get_position("0")` Pending, `get_reactor` progress |
| C5 | DEV → F · `close_season` `{"season_id":0}` (at ≥ genesis + 36 min) | 0 | 50 Tgas | Success, level 1 (target 5 USDC) | `get_season(0)` |
| C6 | DEV → F · `claim` `{"position_id":"0"}` (after unlock, 10 min after C2) | 0 | 50 Tgas | event `reward_claimed`, DEV FUEL balance + creator reward | `ft_balance_of(DEV)` delta, `get_position` Claimed |
| C7 | DEV → F · `claim` again | 0 | 50 Tgas | **fails** `ERR_ALREADY_CLAIMED` (gas only) | tx status Failure |

Every hash goes into the README with `https://testnet.nearblocks.io/txns/<hash>`. If a step
fails, I stop, read the receipt and report. I never retry blind.

## 7. FUEL demo configuration (testnet only; production values in `docs/FUEL_REACTOR.md` §5)

`season_duration` 30 min · `registration_grace` 5 min · `season_target_usdc` **5 USDC** (one 20 USDC
deposit puts ≈ 9.68 USDC in the LP on a 50/13.44 pool) · `season_reward_budget` 5 000 FUEL ·
`season_burn` 10 FUEL · `min_lock` 10 min (= Treasury lock) · `vault_cap` 2 000 FUEL ·
team cliff 1 h / vesting 10 h · ecosystem/liquidity/team = DEV (simplification declared).

## 8. Tidepool and teammate

- Live on 2026-11-11 22:25 UTC: `network: testnet`, Solana route `ok`, dry quote 1 USDC → 0.9974
  (cost 2600 atomic, taken from the quote). **A dry quote is not a transfer**; no bridge has been
  executed by us.
- `packages/crosschain` is empty and no `feat/crosschain` branch exists. The interface to
  implement is still `packages/shared/src/crosschain.ts`. The web app keeps its SIMULATED adapter
  separate (demo mode only). Batch C does **not** depend on the bridge: DEV uses faucet USDC, the
  same contract the bridge delivers.

## 9. Actions requiring your authorization

1. Batch 0: your faucet claim (site).
2. **Batch A** (10 txs, signer DEV, ≤ 0.215 NEAR + gas, 50.1 USDC + 13.44 wNEAR of test tokens).
3. Batch B (deploys, ~5.2 NEAR locked as storage + 3 NEAR transfer to FUEL).
4. Batch C (first cycle).
5. Any push of `feat/core`.
