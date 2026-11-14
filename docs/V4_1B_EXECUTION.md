# V4.1B — TreasuryV4 frontend, Position Manager, transaction safety

Date: 2026-11-14. Solo project. Builds on [`V4_1_ARCHITECTURE.md`](V4_1_ARCHITECTURE.md) and [`V4_1_EXECUTION.md`](V4_1_EXECUTION.md).

**Verdict: `READY FOR V4.1 TESTNET DEPLOYMENT`**, with the scope stated in §9.

| | |
|---|---|
| **Not done** (no approval given) | no transaction, signature, deployment or push |
| **Not deployed** | TreasuryV4 and S2NMEME do not exist on testnet. `view_account` → UNKNOWN_ACCOUNT, read 2026-11-14 |
| **Signing** | disabled in the dashboard **by construction**: `V4_SIGNING_ENABLED = false` |

## 1. Initial state

| Item | State |
|---|---|
| Git | `0011330` (V4.1A, local). origin at `2a16cb4`. **Nothing pushed since V4.0** |
| G6 / G7 | `node scripts/probes/verify-g6-g7.mjs` → **12/12** re-verified on public RPC (G6 wallet path; G7 bridge Solana → NEAR → Treasury) |
| G8 | **no report: not done** |
| Tests before V4.1B | Rust 34 + 31 + 44 + 3, near-client 23, crosschain 36, web 48, e2e 20, sandbox 1 (all green) |
| Funds | `sol2near-dev.testnet` **6.7587 NEAR** (was 1.7587: the faucet top-up arrived) and 29.9 USDC(tp). `lowarena9362.testnet` 4.9351 NEAR. Read only; nothing moved |

## 2. Phase A — interface audit of TreasuryV4

Source of truth: `contracts/treasury-v4/src/lib.rs`, real wasm SHA-256 `66479af1…00ed`.

| Method | Args | Returns | Gas | Attached | Who / preconditions | Events | State before → after | Failure → recovery |
|---|---|---|---|---|---|---|---|---|
| `new` (init) | `network`, `pool{dex,pool_id,usdc_token,base_token,usdc_decimals,base_decimals}`, `min_deposit`, `lp_lock_duration_ns`, `guards{max_slippage_bps≤500,max_price_impact_bps≤2000,max_plan_ttl_ns≤1h}` | — | deploy tx | — | once. All accounts `*.testnet` (or `*.test.near` in sandbox) | — | — → not ready | panics: `ERR_NETWORK*`, `ERR_GUARD_*`, `ERR_SAME_TOKENS`, `ERR_DECIMALS`, `ERR_MIN_DEPOSIT_ZERO` |
| `setup` | — | Promise→bool | 300 Tgas | ≥ 0.105 NEAR | anyone; idempotent | `setup_done` / `setup_failed{stage}` | not ready → `ready` only if pool kind, tokens and both `ft_metadata` decimals match | not ready: deposits are refunded. Fix and call again |
| deposit = `usdc.ft_transfer_call(receiver=TreasuryV4, msg={"action":"deposit"})` | `amount` | used amount | 100 Tgas | 1 yocto | sender = creator. USDC only, ready, ≥ `min_deposit` | `deposit_allocated` / `deposit_refused{reason}` | — → `BudgetAllocated` (90/8/2) | refused → the token refunds 100 % |
| `execute_lp` | `deposit_id`, `plan?{swap_amount_in,min_swap_out,min_amounts[2],deadline_ns}` | Promise | ≥ 200, **300** Tgas | 0 | creator, no job in flight, plan guards > 0, deadline in (now, now+ttl], status `BudgetAllocated` / `InRef` / `Swapped` | `amm_deposit_confirmed`, `swap_confirmed`, `lp_confirmed`, `proof_of_liquidity`, `lp_job_failed{reason}`, `callback_ignored` | → `LpConfirmed` (locked), or parked in `InRef` / `Swapped` with `last_error` | resume (`execute_lp` + fresh plan), `abort_lp`, or `reconcile` if a callback is lost |
| `reconcile` | — | Promise | 50 Tgas | 0 | anyone, ≥ 10 min after the job's last progress | `reconciled`, `reconcile_failed`, `leftover_recovered` / `leftover_withdraw_failed` | stuck job → stage re-derived from Ref balances | views failed → call again |
| `abort_lp` | `deposit_id` | — | 30 Tgas | 0 | creator, no job, status `BudgetAllocated` / `InRef` / `Swapped` | `lp_aborted` | → `Aborted`. The budget goes to the reserve (if not yet sent to Ref) or becomes this deposit's leftovers | final for that deposit |
| `withdraw_leftover` | `deposit_id`, `token_id` | Promise→bool | 150 Tgas | 1 yocto | creator, no job, status `LpConfirmed` / `LpWithdrawn` / `Aborted`, leftover > 0 | `leftover_recovered` / `leftover_withdraw_failed` | Ref `withdraw` → credited to the creator's reserve (USDC) or base balance **only if Ref's balance dropped** | nothing changes, retry. Lost callback → `reconcile` (**fixed in V4.1B**) |
| `withdraw_reserve` | `amount` | Promise→bool | 100 Tgas | 1 yocto | the caller's own reserve | `reserve_withdrawn` / `reserve_withdraw_failed` | reserve → creator wallet | re-credited |
| `withdraw_base` | `amount` | Promise→bool | 100 Tgas | 1 yocto | the caller's own base balance; caller registered on the base token | `base_withdrawn` / `base_withdraw_failed` | base balance → creator wallet | re-credited |
| `withdraw_lp` | `deposit_id` | Promise | 100 Tgas | 1 yocto | creator, no job, `LpConfirmed`, `now ≥ unlock_at`; **creator `mft_register(":pool")` on Ref first** | `lp_withdraw_started`, `lp_withdrawn` + `proof_of_liquidity` / `lp_withdraw_failed` | `LpConfirmed → LpWithdrawPending → LpWithdrawn` | rollback to `LpConfirmed`, retry. Double withdrawal → `ERR_NO_CONFIRMED_LP` |
| `verify_liquidity` | — | Promise→Proof | 20 Tgas | 0 | anyone | `proof_of_liquidity` | `last_proof` updated | — |
| views | `get_config`, `get_deposit(id)`, `get_position(id)`, `get_creator_deposits(creator, from_index?, limit?)`, `get_reserve(creator)`, `get_base_balance(creator)`, `get_accounting`, `get_in_flight`, `get_last_proof` | JSON | view | — | — | — | — | — |

The `on_*` callbacks are `#[private]`: they cannot be called from outside.

Ref methods used by the dashboard (all views, all present in the fetched wasm):
- `get_pool`, `get_return`, `metadata` (`admin_fee_bps`);
- `get_pool_shares`, `mft_has_registered`, `predict_remove_liquidity`, `storage_balance_of`.

**Gaps found and how they are handled:**

| # | Gap | Decision |
|---|---|---|
| 1 | **A lost `on_leftover` callback left `in_flight` set forever.** `reconcile` refused anything but an LP job (`ERR_NOT_AN_LP_JOB`), which would have blocked every job of the contract | **Fixed locally**, since the contract is not deployed. `reconcile` now settles a Leftover job from Ref `get_deposits` (`on_reconcile_leftover`, sharing `settle_leftover` with `on_leftover`). +3 unit tests: recovered, not moved, too early. The sandbox run passes with the new wasm |
| 2 | Transaction hashes are not visible to a contract | `marks[]` record the block and time of each stage. A future signing flow pairs them with the local transaction history (G4 pattern) |
| 3 | Classic LP fees are not a separate balance | not a contract gap: Ref keeps fees inside the share value. The UI shows `predict_remove_liquidity` vs what entered the pool, labelled "fees AND price moves, not a profit figure" |
| 4 | `withdraw_lp` needs the creator's `mft_register` on Ref | shown as an explicit prerequisite (live `mft_has_registered`), with its own call |
| 5 | One job at a time for the whole contract (`in_flight`) | by design (V3 invariant). The UI says which deposit holds the lock |
| 6 | The 2 % community bucket has no spending method | unchanged from V3 (out of V4.1 scope) |

## 3. Architecture actually implemented

```text
packages/near-client (pure, unit-tested)
  treasuryV4.ts   V41_PILOT (planned ids), planV4, checkPlanGuards, v4CallsFor(ids) → exact payloads, pilotDeployment, fuelEligibility
  v4Position.ts   contract JSON types · positionState / journeyState (14 UI states) · withdrawGate · recoveryActions
                  · estimateDeposit · valueChange · usdcReconciles · signingGate (V4_SIGNING_ENABLED = false)
  fixtures/v4_sandbox_views.json   REAL TreasuryV4 / Ref views captured by sandbox-tests at 9 lifecycle stages
apps/web
  src/v4/chain.ts  two READ-ONLY sources: testnetChain (live RPC, planned accounts) · sandboxChain(stage) (bannered preview)
  src/v4/V4.tsx    Pools page: A pool · B estimator · C review · D tracker   |   #/positions: Position Manager
  src/near/rpc.ts  + blockTimestampNs() (chain clock for locks and deadlines)
contracts/treasury-v4   + reconcile for leftover jobs (gap 1)
sandbox-tests           + exports the real views fixture
```

**Environment separation (Phase D):**
- **Testnet**: public reads only. Every V4 account is the planned `*.sol2near-dev.testnet` account.
- **Sandbox**: only as a static, bannered preview of real local views. Network `sandbox` and accounts `*.test.near`, so the network gates refuse it.
- **Mainnet**: V4.0 reference pools only, read only.
- **No test hook was added.** A "deployed" pilot is simulated in browser tests by intercepting the public RPC responses. The production bundle contains no `__SOL2NEAR_E2E` and no `eval(`, checked.

## 4. Frontend features (Phase B, C, E)

**Pools page → "V4.1 Classic memecoin pilot · TreasuryV4"**
- **Data source:** live testnet (default), or PREVIEW of the local sandbox at one of 9 real stages.
- **A · Pool:**
  - DEX, pool id, network, exact tokens and decimals;
  - live fee and the LP share after Ref's `admin_fee_bps` (testnet Ref: 2000 → about 24 of 30 bps go to LPs);
  - liquidity, token tax, route, TreasuryV4 compatibility, FUEL (from the deployed FUEL config).
- **B · Estimator:**
  - the 90/8/2 split;
  - USDC to swap, expected base token, Ref `get_return` cross-check (live only);
  - estimated LP shares (within 1 ppm of what the contract minted in the sandbox);
  - potential leftovers, price impact against the contract limit, max slippage, lock;
  - every reason the contract would refuse: minimum deposit, balance, USDC storage, slippage, impact, deadline, no pool.
- **C · Review:**
  - wallet, Treasury, pool, amount and token;
  - price limits (`min_swap_out`, `min_amounts`), deadline, lock;
  - storage (creator on USDC and Ref; Treasury pays its own add_liquidity storage), risks;
  - the **exact payloads** of `ft_transfer_call` and `execute_lp`, with gas and the maximum gas cost.

  "Sign deposit — locked" lists why.
- **D · Tracker:** `NOT_DEPLOYED` / `READY` / `DEPOSIT_PENDING` / … derived by `journeyState` from views.

**#/positions → Position Manager.** One card per TreasuryV4 position, showing:
- the state badge (`DEPOSIT_CONFIRMED`, `SWAP_PENDING`, `LP_PENDING`, `LOCKED`, `WITHDRAWABLE`, `WITHDRAW_PENDING`, `WITHDRAWN`, `ABORTED`, `RECOVERY_REQUIRED`, `FAILED`) and the contract status;
- economic owner, Treasury, DEX and pool, deposit and split;
- amounts actually used, with "✓ USDC reconciles";
- LP shares (verified, and what Ref shows TreasuryV4 holding) and leftovers (in Ref / recovered / returned);
- creation date, lock end against chain time;
- value now (`predict_remove_liquidity`, not a profit figure);
- FUEL_NOT_ELIGIBLE and its reason;
- on-chain history (`marks`) and `last_error`.

Each card also has:
- **Withdraw LP** (`withdraw_lp`): the blocking reasons, which mirror the contract:
  - wrong network, sandbox or non-testnet account, not the creator;
  - lock running, withdrawal in progress, already withdrawn, no shares;
  - a job in flight;
  - Ref holding fewer shares than the position.

  The `mft_register` prerequisite is shown, and so is the exact payload once allowed. The button stays locked.
- **Recovery:** only the actions the contract supports for that state, each with its **objective, funds, preconditions, recipient, risks**, payload and blocking reasons:
  - resume (`execute_lp`) and `abort_lp` while a stage is parked;
  - `reconcile` after the timeout, for an LP or leftover job;
  - `withdraw_leftover` (USDC / base), `withdraw_reserve`, `withdraw_base`.

  There is no generic "recover funds" button. While a job is in flight, nothing is offered except reconcile once it is due.
- **Fees:** pool fee, the LP share of the fee after the admin fee, and the value change, kept separate. No APR, no daily income, no FUEL yield.

## 5. Screens and journeys tested

| Journey | Evidence |
|---|---|
| Live testnet: NOT DEPLOYED, FUEL from the deployed config, no quote, no position, nothing signable | e2e `@live` + manual check in Chrome |
| Sandbox preview: estimator 20 USDC = the contract's plan (swap 8.97332 USDC); 900 USDC refused by the impact guard; review with sandbox payloads | e2e `@preview` + screenshot `docs/v4/v41b-pool-estimator.jpg`, `v41b-review-tracker.jpg` |
| LOCKED → WITHDRAWABLE (with and without `mft_register`) → WITHDRAWN | e2e `@preview` + `v41b-position-locked.jpg` |
| RECOVERY_REQUIRED (price-impact guard) → ABORTED → leftover recovered (810 USDC) | e2e `@preview` + `v41b-withdraw-recovery.jpg` |
| Deployed with the wrong config → DEPLOYED · NOT READY | e2e `@mock` (intercepted RPC) |
| Deployed and READY: the estimator plans against the pool, Ref `get_return` matches, review prepared, signing locked | e2e `@mock` |
| Job in flight: SWAP_PENDING, **the same after a reload**, reconcile "too early", no resume | e2e `@mock` |
| RPC down: "Live read failed", nothing unlocked | e2e `@mock` |
| Phone 390 px, no horizontal scroll | e2e (Pools and Positions) |

## 6. Test results (2026-11-14)

| Suite | Result | Kind |
|---|---|---|
| `cargo test --workspace` | Treasury V3 **34**, FUEL **31**, TreasuryV4 **47** (+3), sandbox-meme **3** | mocked VM |
| `sandbox-tests` (WSL, neard 2.14) | **1/1**: full pilot journey against the real Ref and Tidepool USDC wasm. It now also exports the real-view fixture | **local sandbox**, not testnet |
| `packages/near-client` | **39** (+16): every UI state from real views, the withdraw gate (before / after the lock, double withdrawal, wrong wallet / network, job in flight, shares missing), recovery actions, estimator (plan = contract, shares within 1 ppm, refusals), value change, journey, signing gate, wrong config, stuck leftover job | unit, real sandbox views + marked SYNTHETIC variants |
| `packages/crosschain` | 36 | unchanged |
| `apps/web` unit | 48 | unchanged (RPC mocks gained `blockTimestampNs`) |
| e2e, real Chrome | **29/29** (+9) | @live / @preview / @mock |
| `pnpm typecheck`, web build | OK. Bundle 571 kB (wallet chunk 1.04 MB on demand). No `eval(`, no e2e hook |
| `verify-testnet.mjs`, `verify-g6-g7.mjs` | all checks passed, 12/12 |

**Required scenarios → where each is covered:**

| Scenario | Covered by |
|---|---|
| Pool allowed / unknown | `pools.test.ts` (V4.0) + pilot gating |
| Wrong network | withdraw and signing gates, sandbox preview |
| No TreasuryV4 | `pilotDeployment` + e2e @live |
| Wrong configuration | unit + e2e @mock |
| Expired quote, excessive slippage, excessive impact | estimator unit + e2e |
| Insufficient balance, missing storage | estimator unit |
| Deposit prepared correctly | estimator vs the real contract plan, review payload |
| Refused transaction | `journeyState` (a wallet rejection sends nothing) |
| Failed or lost callback | RECOVERY_REQUIRED / reconcile, unit + e2e |
| LP not confirmed / confirmed | unit (UNVERIFIED, LP_PENDING / Ref shares = recorded) |
| Reading positions | 9 real stages |
| Withdrawal before / after the lock, double withdrawal | unit + e2e |
| Leftover recovery | unit + e2e + sandbox |
| Reload during an operation | e2e @mock + unit |
| RPC failure | e2e |
| FUEL not eligible | live FUEL config + every view |

## 7. Problems fixed

| Problem | Fix |
|---|---|
| Stuck leftover job could block TreasuryV4 forever (gap 1) | `reconcile` for Leftover jobs + 3 tests |
| Preview review showed the testnet payloads next to sandbox ids | `v4CallsFor(ids)`: payloads always use the accounts of the current source |
| 1 atomic of base dust displayed as "0" (and "−0") | amounts below display precision are shown in atomic units |
| 390 px: the pages scrolled horizontally (select intrinsic width inflating grid tracks) | `minmax(0, 1fr)` tracks, `min-width: 0` |
| Ambiguous e2e locators (`Withdraw` matched 4 elements) | exact labels |
| Recovery test expected no reserve action while the 8 % reserve really is withdrawable | assertion corrected (the reserve card is right) |
| Obsolete V4.1A card (`PilotV41.tsx`) and its reader | replaced by `v4/V4.tsx`, dead code removed |

## 8. Limitations

- **Signing is disabled.** After deployment, enabling it is a separate change (V4.1C). It would wire `v4CallsFor(planned)` into the existing NEAR panel signing path, with history and outcome checks.
- The tracker's `DEPOSIT_PENDING` and `FAILED` need a local tx record, which only exists once signing is wired.
- The preview uses static views of one local run. It shows real contract shapes, not live behaviour.
- Fees cannot be separated from price moves in a Classic position, by nature.
- The S2NMEME pilot proves the adapter, not a live memecoin. FUEL_NOT_ELIGIBLE.
- Public RPC without SLA. Every failure locks, nothing degrades into a guess.

## 9. Non-deployed features (state)

| Feature | State |
|---|---|
| TreasuryV4 wasm `66479af1…00ed` (302.5 KB) | built and tested, **not deployed** |
| S2NMEME wasm `7265aa4e…283c` (149.3 KB) | built and tested, **not deployed** |
| Pool USDC(tp)/S2NMEME | **not created** |
| Dashboard pilot + Position Manager | **built**; live mode reports NOT DEPLOYED, every action locked |
| Registry entry for the pilot pool | **not added**: only after the pool exists and passes the V4.0 live checks |

## 10. Public validation plan (each step needs your explicit approval)

| # | Operation (signer `sol2near-dev.testnet` unless noted) | Precondition | Check after the step | Stop if |
|---|---|---|---|---|
| 1 | create `s2nmeme.sol2near-dev.testnet` (initial balance 1.6 NEAR), deploy `sol2near_sandbox_meme.wasm`, `new(owner_id=sol2near-dev.testnet, total_supply)` | wasm SHA-256 = `7265aa4e…` | `view_account` code_hash; `ft_metadata` = S2NMEME, 18 dec.; `ft_total_supply`; owner balance = supply | init fails |
| 2 | `s2nmeme.storage_deposit(ref-finance-101.testnet)` 0.00125 NEAR | 1 done | `storage_balance_of(Ref)` ≠ null | — |
| 3 | Ref `register_tokens([usdc(tp), s2nmeme])` 1 yocto | 2 done | `get_user_whitelisted_tokens(sol2near-dev)` contains both | — |
| 4 | Ref `add_simple_pool([usdc.tidepool-sandbox.testnet, s2nmeme.sol2near-dev.testnet], 30)` 0.1 NEAR → **N** | 3 done | `get_pool(N)`: SIMPLE_POOL, exact tokens, fee 30 | another pool / kind |
| 5 | seed: `usdc.ft_transfer_call(Ref, X)`, `s2nmeme.ft_transfer_call(Ref, Y)`, Ref `add_liquidity(N,[X,Y])` 0.01 NEAR. X and Y are **your call** (e.g. 20 USDC) | 4 done; USDC(tp) balance ≥ X (29.9 today) | `get_pool(N)` reserves = X / Y; Ref shares of sol2near-dev > 0 | reserves differ |
| 6 | create `treasury-v4.sol2near-dev.testnet` (initial balance 3.2 NEAR), deploy `sol2near_treasury_v4.wasm`, `new(network "testnet", pool{ref-finance-101.testnet, N, usdc(tp), s2nmeme, 6, 18}, min_deposit 1000000, lp_lock_duration_ns 600 s, guards{100, 1000, 600 s})` | wasm SHA-256 = `66479af1…` | `get_config` = these values, `ready=false` | init fails |
| 7 | `setup()` 0.105 NEAR, 300 Tgas (permissionless) | 6 done | event `setup_done`; `get_config.ready = true`; dashboard shows "DEPLOYED · awaiting validation" | `setup_failed` |
| 8 | code: `V41_PILOT.poolId = N`, registry v2 entry, after the V4.0 live checks pass | 7 done | V4.0 checks all ✓ for pool N | any check ✗ |
| 9 | V4.1C (separate approval): enable signing, then one small journey (e.g. 2 USDC) with an approval per transaction. Then `withdraw_lp` after 600 s, and `withdraw_leftover` | 8 done | every tx hash recorded; Ref shares = recorded; books = real balances, as in the sandbox `R` check | any mismatch |

**Recovery scenarios:**
- A failed init leaves an account with code but no state: deploy again with `new`, or delete the account. Its storage stake comes back, minus fees.
- A failed `setup` never accepts deposits: they are refunded.
- A wrong pool id in `new` is caught by `setup`.
- Pool 2951, the V3 Treasury and FUEL are never touched.

## 11. Resources (estimates from on-chain prices read 2026-11-14)

Storage costs **0.00001 NEAR per byte** (`storage_amount_per_byte = 10¹⁹`). Gas price is 10⁸ yocto per gas, so **0.0001 NEAR per Tgas**.

| Item | NEAR |
|---|---:|
| TreasuryV4 code 302 524 B + state | ≈ 3.03 + ~0.05 |
| S2NMEME code 149 341 B + state | ≈ 1.49 + ~0.02 |
| TreasuryV4 `setup` (Ref storage 0.1 + 4 × 0.00125) | 0.105 |
| Ref pool creation (storage, excess refunded) | ≤ 0.1 |
| Token storage on Ref, seed add_liquidity | ≈ 0.012 |
| Gas for ~10 deploy / setup / seed transactions | ≈ 0.05–0.1 |
| **Total** | **≈ 4.9–5.4 NEAR** |

Available on `sol2near-dev.testnet`: **6.7587 NEAR** (read only). This is enough, with about 1.4 NEAR of margin.

The storage stake stays locked in the two accounts, not burnt. A real `execute_lp` burnt **37 Tgas = 0.003444 NEAR** (G6-LP2). The pilot journey adds Ref `get_pool` + `get_return` views to that.

## 12. Next: V4.2 (not started)

- RHEA DCL study on `dclv2.ref-dev.testnet` / `dclv2.ref-labs.near`:
  - position NFT custody by a Treasury;
  - price ranges and out-of-range behaviour;
  - fee collection (`claim_fee`-type flows);
  - pool-level `tax` and Nearly token-level taxes;
  - exit.
- Find whether any testnet DCL pool can host a meaningful test (V4.0: none with a Tidepool token or a meme-cooking token).
- A versioned `PositionProof` for DCL, without changing FUEL until a separately approved version exists.
