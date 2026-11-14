# V4.2A — Execution report: local DCL adapter (TreasuryDCL)

Date: 2026-11-14. Solo project. Feasibility, audit and decisions: [`V4_2A_DCL_FEASIBILITY.md`](../V4_2A_DCL_FEASIBILITY.md).

**Verdict: `READY WITH LIMITATIONS`.**

| | |
|---|---|
| **Not done** (no approval) | no transaction, signature, deployment, pool creation on a public network or push. Mainnet was only read, with view calls |
| **Not deployed** | `contracts/treasury-dcl` exists as code, unit tests and a local sandbox run |
| **Untouched** | Treasury V3, FUEL, TreasuryV4 (V4.1) and their tests; the Classic UX |

## 1. What was built

| Piece | Where | What it does |
|---|---|---|
| **TreasuryDCL contract** | `contracts/treasury-dcl` (lib 1 057 lines, plan 231, types 228; 41 unit tests). wasm 349.6 KB, SHA-256 `245fcab3a15968c0b523818f4e5d2ac7762f223289933c44fda13df2654eb9f6` at V4.2A; rebuilt at V4.3A (doc-comment change only, which the embedded ABI carries): `66889832d7c0a7462949f03ea68f28caaad0011d3cbc851896d710452b887a83`, 349.6 KB (cargo-near 0.22.0, `bash scripts/build-wasm.sh treasury-dcl`) | Option A of the feasibility doc. 90/8/2 intake (unchanged `ledger.rs`); one allowlisted DCL pool; fixed USDC routes; `setup` checks; HotZap creation; position lookup and confirmation; fee claims; NFT exit; leftover recovery; `reconcile` |
| Plan / guard logic (pure) | `contracts/treasury-dcl/src/plan.rs` | `check_plan`, `check_entry`, `check_preflight` (with `predict_hotzap`), `check_target_pool`, `check_route`, `tax_verdict`, `find_new_position`, `hotzap_msg` |
| Client | `packages/near-client/src/dcl.ts` (+10 tests) | candidate registry (3 real Nearly pools); `assessDcl` → the 6 verdicts; point/price math; `rangeAround`; `rangeStatus` (out of range); `checkDclPlan` (mirror of the contract); `parsePredictHotzap`; `buildDclPlan` (same bisection as the sandbox run); `estimateDcl`; `dclPositionState`; FUEL requirements |
| Dashboard | `apps/web/src/v4/Dcl.tsx` on the Pools page (+4 e2e) | **DCL pools:** 3 cards read live from mainnet, on demand. **Estimator:** a mainnet reference simulation using `quote` + `predict_hotzap` views. **Position card:** a preview of real TreasuryDCL views from the sandbox, in 4 stages. Every action is `READ_ONLY` / `NOT_DEPLOYED`: no button exists for them |
| Probes (read-only) | `scripts/probes/fetch-dcl-wasm.mjs`, `scripts/probes/v42-dcl-audit.mjs` | code of DCL / wNEAR / Nearly raw v1 and tax v6 (SHA-256 checked against Nearly's README); mainnet + testnet audit → fixture |
| Sandbox runs | `sandbox-tests/tests/v42_dcl_probe.rs`, `v42_dcl_probe_hotzap.rs`, `v42_dcl_explore.rs`, **`v42_dcl.rs`** | init-argument discovery, a free exploration of the real DCL, then the TreasuryDCL end-to-end run |
| Evidence | `docs/v4/v42-dcl-explore.log`, `docs/v4/v42-dcl-sandbox-run.log`, `docs/v4/v42a-dcl-pools.jpg`, `docs/v4/v42a-dcl-position.jpg`, fixtures `v42_dcl_mainnet_2026-11-14.json`, `v42_dcl_sandbox_views.json` | |

### Contract interface

| Method | Who | Effect |
|---|---|---|
| `new(network, pool{dex, pool_id, token_x, token_y, x/y/usdc decimals, fee, point_delta, usdc_token, route_x, route_y}, min_deposit, lock_duration_ns, guards{max_slippage_bps ≤ 500, max_price_impact_bps ≤ 2000, max_plan_ttl_ns ≤ 1 h, min/max_range_width})` | deployer, once | testnet / sandbox accounts only; `pool_id == x\|y\|fee`; USDC must not be a pool token; routes 1–3 hops |
| `setup()` ≥ 0.6075 NEAR | anyone | DCL storage 0.5 + `register_tokens` 0.1; FT storage ×6. Reads target + route pools, decimals and `get_tax`. `ready` or `setup_error` |
| `ft_on_transfer` (USDC, `{"action":"deposit"}`) | creator | 90/8/2; the 8 % reserve is credited to the creator's USDC balance |
| `execute_dcl_lp(deposit_id, plan)` 300 Tgas | creator | `check_plan` → views (`get_pool`, `predict_hotzap`, 2 small quotes) → `check_preflight` → USDC HotZap → `list_liquidities` → `get_liquidity_view` + `list_user_assets` → `PositionConfirmed` (locked) |
| `claim_fees(deposit_id)` | creator | `remove_liquidity(lpt, 0, 0, 0, skip_refund_transfer)`; books DCL's returned `[fee_x, fee_y]` |
| `withdraw_position(deposit_id)` 1 yocto | creator, after the lock | `nft_transfer` to the creator, then `get_liquidity.owner_id == creator` |
| `withdraw_dex_balance(deposit_id, token)` 1 yocto | creator | `withdraw_asset` of this deposit's leftovers + claimed fees; credited only if the DCL balance dropped |
| `withdraw_token(token, amount)` 1 yocto | owner of the balance | `ft_transfer`, re-credited on failure |
| `abort(deposit_id)` | creator, before any zap | budget → USDC balance |
| `reconcile()` | anyone, 10 min after the last progress | re-derives a stuck stage from the DCL |
| views | — | `get_config`, `get_deposit`, `get_position` (proof model + `fuel_status`), `get_creator_deposits`, `get_balance`, `get_in_flight`, `get_accounting` |

**Proof model (`DclDeposit`):**
- identity: creator, `dex`, `pool_id`, `token_x` / `token_y`, `lpt_id`, range;
- liquidity units, and `position_x` / `position_y` at confirmation;
- USDC: `usdc_used`, `usdc_unused_to_reserve`;
- balances in the DEX account: `dex_x` / `dex_y` / `dex_usdc`;
- `fees_claimed_x` / `fees_claimed_y`, and `recovered_*`;
- `unlock_at`, `confirmed_block`, `last_error`, `marks` (block and time of each stage).

`get_position` adds `treasury_id`, `locked`, `withdrawable`, `fees_claimable` and `fuel_status`. `lp_shares` is not used.

## 2. Evidence, by kind (kept separate)

| Kind | Proves | Result |
|---|---|---|
| **Unit, MOCKED VM** (`cargo test -p sol2near-treasury-dcl`) | contract rules, every transition, lost and failed callbacks | **41 pass** |
| **LOCAL SANDBOX, real code** (`wsl -d Ubuntu -- bash sandbox-tests/run.sh v42_dcl`, after `node scripts/probes/fetch-dcl-wasm.mjs` and the build) | TreasuryDCL against the **real Rhea DCL v2.4.2 wasm** (mainnet code), wrap.near wasm, Tidepool USDC wasm, Nearly raw v1 and tax v6 wasm. Local state and local test tokens | **1/1**, ~65 s |
| Sandbox exploration (`v42_dcl_explore`) | DCL behaviour without our contract | log in `docs/v4/v42-dcl-explore.log` |
| **TS, on real reads** (`pnpm --filter @sol2near/near-client test`) | classification of the 3 mainnet pools, math, plan mirror, states from sandbox views. SYNTHETIC variants are labelled | **49 pass** (+10) |
| **Real Chrome** (`pnpm --filter @sol2near/web e2e`) | DCL cards from live mainnet views, the estimator, the preview, an RPC outage, 390 px | **33 pass** (+4) |
| **Public network** | — | **none**, by design |

### The sandbox run, step by step (`docs/v4/v42-dcl-sandbox-run.log`)

| Step | Result |
|---|---|
| A1–B2 | Real DCL / wNEAR / USDC / RAWMEME (raw v1) / TAXMEME (tax v6, 3 % / 4 %) deployed locally. Pools USDC/wNEAR 0.2 %, RAWMEME/wNEAR 1 %, TAXMEME/wNEAR 1 % seeded by `lp` |
| C0 | Treasury targeting the **taxed** pool: `setup_failed`, `token_x token transfer tax buy=300 sell=400 bps: BLOCKED_TAX` |
| C1 | Treasury with wrong decimals (24 vs 18): `setup_failed`, not ready |
| C2 | Good Treasury: `setup_done`. DCL storage 0.5 NEAR, 40 slots, tokens registered |
| D0 / D1 | RAWMEME sent: refunded. Alice deposits 20 USDC → 18 / 1.6 / 0.4 |
| E1 / E2 | bob → `ERR_NOT_CREATOR`. Range off the 200 grid → `ERR_RANGE_NOT_ON_POINT_DELTA` |
| E3 | Range above the price → refused on-chain: `price out of range: current point 0 not in (2000, 8000)` |
| E4 | Both min outs at 50 % → refused: `min_x_out … looser than 100 bps of quote …` |
| E4b | Amounts that do not fit the range → refused: `DCL predict_hotzap refused this plan … nothing sent` |
| E5 | **Books = real balances** (nothing moved by E1–E4b) |
| **F1** | `execute_dcl_lp`: preflight → zap → found → **position_confirmed**, 139 Tgas. DCL `get_liquidity`: `owner_id = treasury-dcl.test.near`, `nft_token` owner the same, liquidity 222 745 662 302 570 594 080 = recorded, range [−20 000, 20 200]. USDC used 17 + 1 back to the reserve = 18 budget. Leftovers 0.5 % of each side |
| F3–F6 | 300 USDC plan → **price-impact guard**: `impact_x 3300 bps > 1000 bps`, nothing sent. Abort; Alice withdraws 394.6 USDC = her Treasury balance exactly |
| G1–G5 | Trades → unclaimed fees 4 489.556 RAWMEME + 0.005365 wNEAR. bob's claim → `ERR_NOT_CREATOR`. **Claim books exactly the DCL's unclaimed fees**; a second claim books 0. Books = real |
| K1–K6 | Narrow position (±2 000 points), then the price leaves it (point 21 776 vs [−1 200, 3 000]): position = 0 RAWMEME + 5.84 wNEAR. After a claim, further trades outside → **0 / 0 fees**. Books = real |
| H1–H7 | Lock → `ERR_POSITION_LOCKED`; bob → `ERR_NOT_CREATOR`. After the lock: **`nft_token` owner = alice**. Second exit and a claim after exit are refused. Alice removes 50 %, then the rest, on the DCL herself → position deleted |
| J1–J3 | Leftovers + fees recovered: RAWMEME +17 698.4777 and wNEAR +0.021004, **= booked to the atomic unit**. A second recovery is refused |
| R | **Final books = real balances**: Treasury USDC 11.4 = owed + community + pending; DCL account X / Y = booked |

## 3. Required tests (checkpoint §10) → coverage

| Test | Covered by |
|---|---|
| Unknown pool | `setup` (pool identity, route checks; unit `target_pool_identity…`, `routes_must_connect…`); client `assessDcl` contract check (SYNTHETIC) |
| Wrong network | `new` refuses mainnet ids / network (unit ×2); client: mainnet never executable |
| Wrong token contract | unit imposter token; sandbox D0 (refund) |
| Insufficient storage | DCL slot cap (40): a 41st position makes the zap fail inside the DCL → refunded (unit `zap_refused…`; limit documented, not forced in the sandbox) |
| Price out of range | sandbox E3; unit preflight |
| Non-conforming range | sandbox E2; unit `plan_guards` (order, grid, bounds, width) |
| Excessive price impact | sandbox F4; unit; client |
| Excessive slippage | sandbox E4; unit |
| Taxed token | sandbox C0 (real tax v6 wasm); unit `setup_refuses_a_taxed_token`; client DRAGON (real mainnet read) |
| Tax on deposit / withdrawal / fee collection | **measured** on the real tax v6 wasm (explore J1/J2, K2–K8: −4 % in, −3 % out). These tokens are refused, so no TreasuryDCL path runs with them |
| Position creation, id and owner verified | sandbox F1 (DCL `get_liquidity` + `nft_token`); unit `confirm_refuses_a_position_not_owned…` |
| No liquidity actually created | unit `missing_position_keeps_the_job…` (nothing recorded without a DCL row); zap refused → refund |
| Out of range | sandbox K3–K5; client `rangeStatus` on the real views |
| Zero fees | sandbox K5; unit `zero_fees_out_of_range…` |
| Unclaimed fees, claim | sandbox G1–G3 |
| Double claim / double count | sandbox G4; unit replay |
| Withdrawal allowed / refused | sandbox H1–H3; unit |
| Partial / total withdrawal | sandbox H6 / H7 (by the creator on the DCL, after the NFT exit) |
| Lost callback | unit: lost preflight, lost zap (found / not found), lost fee claim, unreadable transfer check |
| Reconciliation | sandbox E5 / F2 / F7 / G5 / K6 / R (books = real balances); unit |
| Resume after interruption | unit `reconcile_*`; a failed fee claim does not block other positions (unit) |
| No double spend | unit: reconcile decided from the DCL (gifted USDC cannot fake a refund); replays; `lpt_index` |
| 90/8/2 not broken by fees and taxes | unit `ninety_eight_two_unchanged…`; sandbox accounting |

**What the mocks do not prove:**
- the gas of a lost-callback path on a real chain;
- behaviour under a Rhea upgrade;
- a 41st position.

**Not proven anywhere:** a real Nearly pool, or any public-network execution.

## 4. Bugs found and fixed during V4.2A

| Bug | Found by | Fix |
|---|---|---|
| Deposits silently refunded by DCL v2.4.2 | sandbox exploration | `register_tokens` (0.1 NEAR) in `setup`. ref-ui does not show this step |
| `quote` over 2 hops fails at 5 Tgas | sandbox E3 ("preflight views failed") | 15 Tgas per quote |
| Independent quotes overestimate the second leg (shared USDC pool, −1.3 %) | sandbox F1 refused by our own guard | on-chain guard uses DCL `predict_hotzap` (sequential) |
| `predict_hotzap`'s second element read as "outputs" | sandbox (planner off by 2×) | it is what is **left after the add**: out = left + need |
| Out-of-range plan gave a vague error (`predict_hotzap` panics) | sandbox E3 | the pool and range are checked first, then the precise reason is reported |
| `list_liquidities` refused `"0"` (U64 strings) | sandbox F1 (`zap_confirmed` then lookup failed, job left for reconcile) | raw u64 |
| **Reconcile of a lost zap trusted Treasury's USDC balance** (inflatable by anyone, so a possible double spend) | own audit | decided from the DCL (matching position owned by Treasury) |
| Mainnet RPC rate limit (HTTP 429) broke the DCL cards and an existing V4.1B e2e (shared providers) | e2e | mainnet reads only on demand, sequential, with retries. A failed read gives `OBSERVE_ONLY` ("nothing is concluded"), not a contract verdict |
| Preview compared every stage with the final pool price | e2e | the pool point is captured per stage in the fixture |
| DCL cards counted as V4.0 cards (`article.pool`) | e2e | own class `dclpool` |

## 5. Regression (2026-11-14, after V4.2A)

| Suite | Result |
|---|---|
| `cargo test --workspace` | Treasury V3 **34**, FUEL **31**, TreasuryV4 **47**, sandbox-meme **3**, TreasuryDCL **41** |
| V4.1 sandbox `run.sh v4_pilot` | **1/1**, books = real balances |
| V4.2A sandbox `run.sh v42_dcl` | **1/1** |
| near-client | **49** (39 + 10) |
| crosschain | 36 |
| web unit | 48 |
| e2e real Chrome | **33/33** (29 + 4) |
| `pnpm typecheck`, web build | OK; no `eval(`, no e2e hook in `dist/` |

## 6. Screens

- `docs/v4/v42a-dcl-pools.jpg`: the 3 live mainnet cards (NEARLY / NEARKAT `FEASIBLE FOR LOCAL DCL TEST`, DRAGON `BLOCKED TAX`), the NEARLY estimator (100 USDC → 87 740.6 NEARLY + 13.43 wNEAR into a [30 200, 70 400] position, reference only) and the position preview.
- `docs/v4/v42a-dcl-position.jpg`: the narrow position out of range ("entirely wNEAR, earns no fee").

## 7. Limitations (still true)

- **Real Nearly pools are mainnet.** SOL2NEAR is testnet-only, so nothing real is funded. The mainnet estimator is a simulation.
- **No testnet DCL pool holds a Tidepool token.** A public testnet run would need us to create pools: USDC(tp)/wNEAR(tp) and a token pool. That is pool creation on a public network, which needs your approval, and it would again be our own liquidity, not a memecoin's market.
- **Testnet DCL (v2.3.14) differs from mainnet (v2.4.2):** no `register_tokens` there; `setup` would fail at that step. A testnet TreasuryDCL would need a version switch.
- **Taxed tokens are refused.** Supporting them would need net-of-tax accounting on every DCL transfer, plus tests with real receipts.
- **Ownership is at the contract level:**
  - creators hold rights on TreasuryDCL until they withdraw the NFT;
  - Rhea's DAO can upgrade the DCL;
  - TreasuryDCL is unaudited.
- **Capacity:** ≤ 40 live positions per TreasuryDCL (DCL slots); one job at a time.
- **Gifts** to Treasury's DCL account are booked to the deposit in flight. They cannot be stolen, but they can be mis-attributed.
- **Fees** are exact per claim, but they are not a forecast. No APR is shown.
- **`marks`** are block heights, not tx hashes (as in V4.1).

## 8. Possible public deployment plan (NOT executed; every step needs your explicit OK)

Precondition: decide **what** to fund on a public network. The options are not equivalent:

| Option | What it would prove | Cost / risk |
|---|---|---|
| **a. Testnet, our own pools** on `dclv2.ref-dev.testnet`: create USDC(tp)/wNEAR(tp) and S2NMEME/wNEAR(tp) DCL pools, seed them, deploy TreasuryDCL (with a v2.3.14 variant without `register_tokens`) | the adapter on a public chain | ~4–5 NEAR of testnet storage; still not a real memecoin; requires a code variant for v2.3.14 |
| **b. Mainnet, a real Nearly pool (NEARLY)** | real memecoin liquidity | **outside the project's testnet-only rule**: real funds, an audit first, a mainnet bridge instead of Tidepool. Not recommended for the hackathon |
| **c. Stay local** (V4.2B = dashboard signing against a local sandbox, or a forked state) | the full UX with real DCL code | no public proof |

Conditions before **any** transaction:
1. your choice among a / b / c;
2. a per-step approval (the same format as `V4_1B_EXECUTION.md` §10);
3. wasm rebuilt and SHA-256 re-checked;
4. `setup_done` read back;
5. one small journey with every tx hash recorded and books checked against real balances (the `R` check of the sandbox);
6. no FUEL change without a separate approval.

## 9. Not started

- V4.2B (signing).
- Any FUEL change.
- Any push.
- X post, video, pitch deck and submission: untouched.
