# V4.1A — Execution report (local implementation and validation)

Date: 2026-11-14. Solo project. Architecture: [`V4_1_ARCHITECTURE.md`](V4_1_ARCHITECTURE.md).

**Result: `READY WITH LIMITATIONS`.** The limitations are listed in §6.

**No transaction was signed or sent.** Not done:
- deploy;
- pool creation;
- liquidity on a public network;
- push.

The deployed contracts (Treasury V3, FUEL) and their proofs are untouched.

## 1. Initial checks

| Check | Result |
|---|---|
| Git | `main` = `cbb2f84` (V4.0, local, **not pushed**; origin at `2a16cb4`) |
| G6 / G7 proofs | `node scripts/probes/verify-g6-g7.mjs` (new, read-only) → **12/12 PASS**. All 11 NEAR tx are final with their expected events (deposits, execute_lp, register/reject, close, claim, Tidepool settlement, Treasury deposit #3), and the Solana devnet tx `bGUicpgy…887R` is `finalized`, `err = null` |
| G7 status | **Proven once**: 2 USDC Solana → 1.9948 USDC on NEAR → Treasury deposit #3 (whole balance, 87.9948 USDC) |
| G8 | **Not done: no report exists.** The bridged funds are in deposit #3, whose LP is blocked by the 20 % price-impact guard (29.13 %). Nothing in V4.1 depends on G8 |
| README | 3 obsolete passages fixed **from the proofs above**: Tidepool "quote only", "no live transfer yet", and the paragraph after the proof table. Checklist §5 row updated. G8 is stated as not done |
| Reference tests (before V4.1) | Rust 34 + 31, near-client 18, crosschain 36, web 48, e2e 18: all green |
| Regressions | none found |

## 2. What was built

| Piece | Where |
|---|---|
| TreasuryV4 contract | `contracts/treasury-v4` (lib.rs ~1 130 lines, 44 tests). wasm 299.3 KB, SHA-256 `ffffe9e794919c017c609d443d046b670ceaeccf537a31ac6582896525938c1c` (cargo-near 0.22.0, non-reproducible build) |
| Sandbox test token | `contracts/sandbox-meme` (S2NMEME, 18 dec., 3 tests). wasm 149.3 KB, SHA-256 `7265aa4e6cce5843a10f20fef4ab8c25d4268e5b22a28eee8cbd0e3767e9283c` |
| Local sandbox run | `sandbox-tests/` (near-workspaces 0.24, neard sandbox 2.14 in WSL). Run with `wsl -d Ubuntu -- bash sandbox-tests/run.sh`, after `node scripts/probes/fetch-sandbox-wasm.mjs` and `bash scripts/build-wasm.sh treasury-v4 sandbox-meme`. Log: `docs/v4/sandbox-run.log` |
| Client | `packages/near-client/src/treasuryV4.ts` (+5 tests) |
| UI | `apps/web/src/PilotV41.tsx` on the Pools page (+2 e2e). Screenshots `docs/v4/pilot-card.jpg`, `docs/v4/pilot-journey.jpg` |
| Probes | `scripts/probes/verify-g6-g7.mjs`, `scripts/probes/fetch-sandbox-wasm.mjs` (read-only `view_code`) |
| Build script | `scripts/build-wasm.sh [contract …]`. The default is still the two deployed contracts |

## 3. Evidence, by kind (kept separate)

| Kind | What it proves | Result |
|---|---|---|
| **Unit tests, MOCKED VM** (`cargo test -p sol2near-treasury-v4`) | contract rules and every state transition, including failures that a sandbox cannot easily force (lost callbacks, failed views) | **44 pass** (40 V4 + 4 ledger) |
| **LOCAL SANDBOX, real code** (`sandbox-tests`) | TreasuryV4 against the **real Ref wasm** of `ref-finance-101.testnet` (code_hash `AEAm8sQ5…6zDX`, SHA-256 `8918c505…34d2`) and the **real Tidepool USDC wasm** (code_hash `DgV3WsKJ…AHwj`, SHA-256 `bc699a78…aaae`), fetched read-only with `view_code` at block 277 577 210 | **1 pass**: the full journey below, ~29 s |
| **Mocks / synthetic** (TS) | plan, guard mirror, deployment status, FUEL eligibility, call shapes | near-client **23 pass**. The plan **reproduces the sandbox Ref `get_return` exactly** (swap 8 973 320 → 8 867 071 669 659 872 053 870) |
| **Real browser** (Playwright, local Chrome) | the pilot card: live testnet reads (NOT DEPLOYED, deployed FUEL config), every step locked, no sign call. RPC outage: nothing unlocks | e2e **20 pass** (+2) |
| **Public network proof** | — | **none for V4.1**, by design (no approval to deploy) |

### The local sandbox run, step by step (`docs/v4/sandbox-run.log`)

| Step | Result |
|---|---|
| A1–A5 | Ref, Tidepool USDC (local copy, 6 dec.) and S2NMEME deployed in the **local** sandbox. Storage set, USDC minted to test accounts |
| B1–B4 | Ref Classic pool **USDC/S2NMEME, 30 bps**, seeded with 1 000 USDC + 1 000 000 S2NMEME (sandbox only) |
| C0 | TreasuryV4 configured with the **wrong decimals** (24) → `setup_failed`, `ready = false` |
| C1 | correct TreasuryV4 → `setup_done` (storage, register_tokens, get_pool + both ft_metadata checks) |
| D0 | S2NMEME sent to the Treasury → `deposit_refused`, 0 used (refunded) |
| D1 | alice deposits 20 USDC → split **18 / 1.6 / 0.4** |
| E1 | bob runs alice's `execute_lp` → `ERR_NOT_CREATOR` |
| E2 | alice's plan sets `min_swap_out` at 50 % of the quote → **refused by the contract** before the swap (`guard_slippage`). Funds parked `InRef`, nothing swapped |
| E3 | alice resumes with a correct plan → swap, add_liquidity, verify → **LpConfirmed**: 8 946 400 039 999 999 999 998 shares. **Ref reports the same number held by the Treasury.** USDC: swapped 8 973 320 + in LP 9 026 679 + dust 1 = **18 000 000**. `lp_verified`, `locked`, `FUEL_NOT_ELIGIBLE` |
| F1–F2 | 900 USDC deposit (LP budget 810 USDC vs a ~1 000 USDC pool) → **refused on-chain: 25.57 % price impact > 10 %** |
| F3–F5 | `abort_lp`, then `withdraw_leftover` (real Ref `withdraw`, verified with `get_deposits`), then `withdraw_reserve`. Alice gets back **exactly 883.6 USDC** (810 budget + 72 + 1.6 reserves) |
| G1 / G2 | `withdraw_lp` during the lock → `ERR_LP_LOCKED`. bob → `ERR_NOT_CREATOR` |
| G3–G4 | after the lock (sandbox time advanced): `mft_register`, then `withdraw_lp`. Ref: **alice holds the 8 946 400 039 999 999 999 998 shares, the Treasury 0**. A fresh proof was recorded |
| G5 | second `withdraw_lp` → `ERR_NO_CONFIRMED_LP` |
| H1 | alice `remove_liquidity` on Ref → 9.026678 USDC + 8 867.071669659872053868 S2NMEME in her Ref deposit |
| H2 | leftovers 1 + 1 atomic recovered through Ref |
| R | **reconciliation against real balances**: Treasury USDC on the token 18 400 001 = reserve 1 + community 18 400 000 + pending 0. S2NMEME on the token 1 = base balances 1. Ref deposits 0 / 0 = expected. Recorded shares 0, total received 920 USDC |

## 4. Required scenarios, and where each one is covered

| Scenario | Covered by |
|---|---|
| Unknown or unauthorised pool | contract: pool fixed at init, `setup` refuses another pool or kind (unit). V4.0 `selectPool` refuses unknown keys (TS). The pilot is not in the allowlist (UI locked) |
| Wrong token contract | unit (imposter pool token, wrong deposit token). Sandbox D0 (S2NMEME refunded) and C0 (wrong decimals) |
| No USDC route | §1 of the architecture doc: the testnet memecoin pools stay OBSERVE_ONLY. The pre-swap guard refuses a pool whose tokens changed (unit) |
| Uncontrolled tax | the sandbox token has none (unit: an exact transfer, supply unchanged). Taxed or unknown tokens stay OBSERVE_ONLY (V4.0). Limit noted |
| Excessive fee or slippage | unit (impact, loose `min_swap_out`, add guards, ceilings at init). **Sandbox E2 and F2** |
| Deposit and 90/8/2 split | unit + sandbox D1 |
| Partially executed swap | Ref swaps are atomic; a partial Ref acceptance of the budget is returned to the reserve and reconciled (unit) |
| Failed callback | unit (amm deposit, swap, add_liquidity, failed views, lp withdraw, reserve/base transfer) |
| Resume without double spend | unit (resume from `InRef` re-runs the guard, no second transfer) + sandbox E2 → E3 |
| LP actually held by the Treasury | sandbox E3 (Ref `get_pool_shares` = recorded), unit (unverified when not backed) |
| Unauthorised withdrawal | unit + sandbox G2 |
| Withdrawal during the lock | unit + sandbox G1 |
| Withdrawal after the lock | unit + sandbox G3–G4, then real `remove_liquidity` (H1) |
| No double withdrawal | unit (LP, leftovers, replayed callbacks) + sandbox G5 |
| FUEL refused without an admissible proof | live read of the deployed FUEL config (TS + e2e). The contract code proves it reads only V3 / pool 2951 |
| RPC failure | TS (`pilotDeployment` rejects) + e2e (testnet RPC down → "Live read failed", nothing unlocked) |
| Reconciliation after interruption | unit (`reconcile` from pre-swap and after minted shares) + sandbox R (books = real balances) |

## 5. Regression (2026-11-14, after V4.1)

| Suite | Result |
|---|---|
| `cargo test --workspace` (Windows) | Treasury V3 **34**, FUEL **31**, TreasuryV4 **44**, sandbox-meme **3**: all pass |
| `pnpm typecheck` | OK (4 packages) |
| `packages/near-client` | **23** (+5) |
| `packages/crosschain` | 36 |
| `apps/web` unit | 48 |
| e2e (real Chrome) | **20/20** (+2): all G5, G6 and V4.0 browser tests still pass |
| `pnpm --filter @sol2near/web build` | OK. 0 `eval(`, no e2e hook in `dist/` |
| `node scripts/probes/verify-testnet.mjs` | all checks passed (Ref, Treasury LP, FUEL, Tidepool) |
| `node scripts/probes/verify-g6-g7.mjs` | 12/12 |

## 6. Remaining risks and limitations

| Level | Item |
|---|---|
| P1 | **Not a real memecoin.** S2NMEME is a sandbox test token, and its pool would hold only our own seed liquidity. It proves the adapter, not market depth or demand |
| P1 | **Not deployed.** The sandbox uses the real Ref and Tidepool code, but not testnet state (gas prices, Ref's whitelist/guardians as configured on testnet, real latency). A testnet deployment must re-run the journey |
| P1 | **FUEL_NOT_ELIGIBLE** until a separately approved FUEL version exists (§7 of the architecture doc) |
| P2 | Single-hop route only. Real testnet memecoins are paired with `wrap.testnet`: a 2-hop route plus a wNEAR source would be needed |
| P2 | The dashboard has no V4 signing flow, by design (locked). After deployment, V4.1B would wire the review and signatures through the existing NEAR panel code |
| P2 | Tidepool USDC has minters. Unaudited contract: TreasuryV4 has had no external review |
| P2 | Leftover withdrawal needs the creator registered on the token. A failed `withdraw_base` / `withdraw_reserve` is re-credited, not lost |
| P3 | `marks` are block heights, not tx hashes. The pairing is done off-chain |

## 7. On-chain operations needed (none executed; each needs your explicit OK)

Today `sol2near-dev.testnet` holds **1.7587 NEAR** and **29.9 USDC(tp)**. Code storage alone needs ≈ 3.0 NEAR (TreasuryV4) + ≈ 1.5 NEAR (S2NMEME), so **about 5.5–6 NEAR of testnet faucet funds are needed first**.

| # | Operation | Signer | Attached / cost (estimate) |
|---|---|---|---|
| 1 | create `s2nmeme.sol2near-dev.testnet`, deploy `sol2near_sandbox_meme.wasm`, `new(owner_id = sol2near-dev.testnet, total_supply)` | sol2near-dev | ~1.6 NEAR (storage) |
| 2 | `s2nmeme.storage_deposit(ref-finance-101.testnet)` | sol2near-dev | 0.00125 NEAR |
| 3 | Ref `register_tokens([usdc(tp), s2nmeme])` | sol2near-dev | 1 yocto |
| 4 | Ref `add_simple_pool([usdc.tidepool-sandbox.testnet, s2nmeme.sol2near-dev.testnet], 30)` → **pool id N** | sol2near-dev | ~0.1 NEAR (refund of the excess) |
| 5 | seed: `usdc.ft_transfer_call(Ref, X)` + `s2nmeme.ft_transfer_call(Ref, Y)` + Ref `add_liquidity(N, [X, Y])` | sol2near-dev | 2 × 1 yocto + 0.01 NEAR. **Labelled sandbox seed liquidity**; the amount is your call (e.g. 20 USDC) |
| 6 | create `treasury-v4.sol2near-dev.testnet`, deploy `sol2near_treasury_v4.wasm`, `new(network "testnet", pool {dex ref-finance-101.testnet, pool_id N, usdc_token, base_token, 6, 18}, min_deposit 1000000, lp_lock_duration_ns 600 s, guards {100, 1000, 600 s})` | sol2near-dev | ~3.1 NEAR |
| 7 | TreasuryV4 `setup()` (permissionless) | anyone | 0.105 NEAR, 300 Tgas. Must emit `setup_done` |
| 8 | Code: set `V41_PILOT.poolId = N` and add the pool to the V4.0 registry as `ELIGIBLE` **only after** the live checks pass (V4.1B) | — | commit |
| 9 | creator journey (each its own OK): deposit → execute_lp → (after 600 s) mft_register → withdraw_lp → remove_liquidity | creator | as in §3 |

## 8. Deployment plan (separate, NOT executed)

1. Top up `sol2near-dev.testnet` from the testnet faucet (you).
2. Rebuild both wasm and check the two SHA-256 above, or record new ones.
3. Steps 1–7 of §7, each approved individually. After each step, read it back: `view_account`, `ft_metadata`, `get_pool(N)`, `get_config.ready`.
4. Re-run the V4.0 live checks for pool N. Only then mark it ELIGIBLE (registry v2) and unlock the card for read-only quotes.
5. One small creator journey (e.g. 2 USDC) with separate approvals. Record every tx hash in a V4.1B report. Run `withdraw_lp` only after the lock.
6. Keep pool 2951, the V3 Treasury and FUEL untouched throughout.

**Stop rules:** stop and report if:
- `setup` does not emit `setup_done`;
- a guard refuses a plan that the client mirror accepted;
- Ref shares ≠ recorded shares after an LP.
