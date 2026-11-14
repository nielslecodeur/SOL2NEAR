# V4.3A — Execution report: Creator Portal, unified positions, async safety

Date: 2026-11-14. Solo project. Product doc: [`V4_3A_CREATOR_PORTAL.md`](../V4_3A_CREATOR_PORTAL.md). Release audit: [`RELEASE_READINESS.md`](RELEASE_READINESS.md).

**Verdict: `READY WITH LIMITATIONS`** (see `RELEASE_READINESS.md` §6).

| | |
|---|---|
| **Not done** (no approval) | no transaction, signature, deployment or push |
| **Untouched** | deployed contracts, FUEL, tokenomics. The only contract file changed is a doc comment in `contracts/treasury-dcl` (not deployed) |

## 1. Initial state (verified, not assumed)

| Item | Result |
|---|---|
| Git | `main` = `d7c0812`, **4 local commits** ahead of `origin/main` (`2a16cb4`): V4.0 `cbb2f84`, V4.1A `0011330`, V4.1B `63d0302`, V4.2A `d7c0812` — confirmed |
| G6 / G7 | `node scripts/probes/verify-g6-g7.mjs` → **12/12 PASS** (11 NEAR tx final with their expected events + Solana `bGUicpgy…887R` finalized) |
| Testnet state | `node scripts/probes/verify-testnet.mjs` → `all checks passed`. The Treasury holds 268 750 243 691 052 670 214 318 LP shares of pool 2951 |
| G8 | **not done**: no report. Deposit #3 (bridged funds, 79.19532 USDC LP budget) is still `BudgetAllocated` (live read, 2026-11-14) |

## 2. What was built

| Piece | Where | Notes |
|---|---|---|
| Creator Portal | `apps/web/src/portal/CreatorPortal.tsx`, route `#/` (Dashboard moved to `#/dashboard`) | landing hero + *What is real today*; Live / Explore modes; 5-step journey; mode and step kept per viewer |
| Unified position card | `apps/web/src/portal/UnifiedCard.tsx` | used by step 5 and by `#/positions` |
| Portal model (pure) | `packages/near-client/src/portal.ts` (+7 tests) | `FEATURES` (evidence kinds), `poolOffers`, `simulateLiveContribution` (14 rows), `fromV3Deposit` / `fromV4View` / `fromDclView` |
| Positions page | `apps/web/src/App.tsx` | V3 live positions in the common shape, then the V4.1B cards, then the V4.2A DCL preview |
| Phantom session restore | `apps/web/src/BridgeLive.tsx` | `connect({ onlyIfTrusted: true })`: silent only if the user approved the site before; never signs |
| DCL explorer reuse | `apps/web/src/v4/Dcl.tsx` | `withPreview` prop, exported `DclPositionPreview`, disabled "Fund — execution not available yet" button |
| DCL plan robustness | `packages/near-client/src/dcl.ts` (+1 test), mirrored in `sandbox-tests/tests/v42_dcl.rs` | 5 bps cap margin between the two `predict_hotzap` calls (see §4) |
| Inflated-balance scenario | `sandbox-tests/tests/v42_dcl.rs`, step S1 | a plain `ft_transfer` of 5 USDC to TreasuryDCL moves no book and credits nobody |
| Release checks | `scripts/check-release.mjs` (`pnpm check:release`) | key material, personal paths, bundle hygiene, fixtures, destructive scripts, toolchain, no committed wasm |
| Docs | this file, `V4_3A_CREATOR_PORTAL.md`, `RELEASE_READINESS.md`; README restructured by evidence kind; `V4_2A_DCL_FEASIBILITY.md` §3.1 (HotZap atomicity) | |
| Captures | `docs/v4/v43a-portal-home.jpg`, `v43a-simulator.jpg`, `v43a-positions.jpg` (+ refreshed `v42a-*.jpg`) | written by the e2e run |

## 3. Phase F — async safety re-check

| Point | Status |
|---|---|
| Job identity | one job at a time per contract (`in_flight` with deposit id + job kind) in V3, V4.1 and V4.2A; callbacks check job **and** stage (unit-tested replays) |
| DEX receipts | V4.1: Ref `get_pool_shares` / `get_deposits` deltas. V4.2A: DCL return values, `get_liquidity`, `list_user_assets`. Never the plan |
| Expired deadlines | V4.1: re-checked before the swap and the add. V4.2A: re-checked in `on_preflight`. Portal: dry quote stale after 60 s → blocking |
| Refunds | NEP-141 `ft_resolve_transfer` (V4.2A R6); V4.1 parks funds `InRef` |
| Resume after interruption | `reconcile` after 10 min (unit tests for each lost callback) |
| Deposit replay | `ft_on_transfer` creates one deposit per transfer; a replayed callback is ignored |
| Double withdrawal | refused (sandbox H4 / J3, V4.1 G5) |
| **Inflated balance** | V4.2A `reconcile` decides a lost zap from the **DCL** (does Treasury own the matching new position?), never from Treasury's USDC balance. Unit test (gift-independent) + **sandbox S1 on the real code**: Treasury USDC 11.4 → 16.4, accounting identical, gifter credited 0, 5 USDC reported unattributed |
| Incomplete operation | V4.2A §3.1 lists the receipt where each state is committed and what `reconcile` derives |
| **HotZap "atomic"** | **corrected**: atomic only inside the DCL's `ft_on_transfer` receipt (all swaps + add, or none). The flow is asynchronous across 7 receipts. Price can move between the views and the zap (bounded by min outs); the position is recorded only after it is read back; leftovers need a later job |

## 4. Problems found and fixed in V4.3A

| Problem | Found by | Fix |
|---|---|---|
| Mainnet DCL estimate failed with `E101: insufficient balance` | e2e (live mainnet), reproduced with the real planner | the second `predict_hotzap` capped at the first one's outputs; a new block in between lowers the outputs. Caps now sit 5 bps under them; +1 unit test simulating the drift. Sandbox run unchanged (positions identical) |
| README said Node ≥ 20, but the tests run `.ts` with Node's type stripping | reproducibility audit | `engines.node >= 22.18`, README prerequisites |
| README tagline implied capturing creator revenue | release review | "route USDC they control"; creator fees not captured, stated |
| Release checker flagged itself, a Tidepool quote **signature** (public) as a key, and Nearly's own build path in on-chain metadata | clean-clone run | self-exclusion; a `"signature"` field is not a key; only the author's paths count. All three documented as false positives |
| `cargo test` from a clone under a long Windows path fails (aws-lc-sys CMake, 260-char limit) | clean-clone run | environment limit, not code: use a short `CARGO_TARGET_DIR` (e.g. `%USERPROFILE%\s2nct`) or Windows long paths. Documented |
| e2e V4.1B tests matched the new DCL banner (`role=note`) and the "Estimate problems" list | full e2e | exact locators |
| Public RPC blips (HTTP 429, failed fetch) made different live tests fail on each run | full e2e (three runs) | Playwright `retries: 1`; retried tests are reported as "flaky", not hidden |
| 390 px overflow from non-wrapping badges in tables | e2e mobile | badges wrap inside the portal tables |

## 5. Tests (final pass, 2026-11-14)

| Suite | Result | Kind |
|---|---|---|
| `cargo test --workspace` | Treasury V3 **34**, FUEL **31**, TreasuryV4 **47**, sandbox-meme **3**, TreasuryDCL **41** | mocked VM |
| Sandbox Classic `run.sh v4_pilot` | **1/1**, books = real balances | local sandbox, real Ref + Tidepool USDC wasm |
| Sandbox DCL `run.sh v42_dcl` | **1/1**, including S1 | local sandbox, real DCL v2.4.2 + Nearly + wrap wasm |
| near-client | **57** (49 + 7 portal + 1 drift) | unit, on real read fixtures + labelled synthetic variants |
| crosschain | 36 | mocked Tidepool / Solana |
| web unit | 48 | — |
| `pnpm typecheck`, web build | OK | — |
| e2e, real Chrome | **43 tests: 42 passed + 1 flaky** (passed on its retry; a public-RPC blip) | @live / @mock / @preview |
| `pnpm check:release` | all checks passed (repo and clean clone) | — |
| Clean clone (`git clone` → `pnpm install --frozen-lockfile` → typecheck → test:ts → web test → build → check:release → `cargo test`) | all green (`cargo` with a short target dir on Windows) | — |
| `verify-testnet.mjs`, `verify-g6-g7.mjs` | all passed, 12/12 | public testnet / devnet reads |

**Checkpoint browser scenarios → tests** (all in `apps/web/e2e/app.spec.ts`):

| # | Scenario | Test |
|---|---|---|
| 1–2 | new visitor, value proposition | `@live V4.3A … a new visitor lands on the portal` |
| 3, 14 | wallet connection, session restore | `@mock … Phantom (MOCK injected provider) …` (absent / connect / trusted restore after reload / no signature); NEAR wallet: G5 tests (real Wallet Selector modal) |
| 4–6 | select / compatible / refused pool | `live mode, step 2 …` |
| 7 | Classic / DCL separation | live step 2 (Classic only) vs explore (DCL cards); unit `poolOffers` |
| 8–9 | estimator, amounts and decimals | `@mock simulator: 14 rows …` (1.9948 → LP 1.79532 · 0.159584 · 0.039896) |
| 10 | expired quote | same test, clock +65 s → STALE + blocking |
| 11 | RPC error | `Tidepool down …`, V4.1B `testnet RPC down`, V4.2A `mainnet RPC down` |
| 12 | no balance | Phantom test (real devnet read → 0, explained); simulator below-minimum test |
| 13 | reload | `reload keeps the mode and the step`; V4.1B `SWAP_PENDING survives a reload` |
| 15–16 | locked / withdrawable | V4.1B `@preview` LOCKED / WITHDRAWABLE; V4.2A preview stages |
| 17–18 | DCL out of range, zero fees | V4.2A `@preview` (out-of-range stage); sandbox K5 (0 / 0) |
| 19 | FUEL not eligible | V4.1B / V4.2A previews; portal step 5 shows the real FUEL status of V3 positions |
| 20 | mainnet never signable | explore test: every Fund/Execute button disabled, no enabled action button; mainnet reads use a separate read-only client |
| 21 | sandbox labelled | DCL preview banner; V4.1B snapshot banner |
| 22 | 390 px | portal (5 steps), Pools, Positions, DCL section |
| 23 | JS errors | `watchErrors` in the landing, dashboard, pools and DCL tests |
| 24 | no secrets in bundles | `scripts/check-release.mjs` (bundle: no key material, no `eval(`, no e2e hook) |

**Mock-only coverage (not claimed as live):**
- the Tidepool quote in the simulator tests: the response shape is copied from the live API fixtures;
- the Phantom provider;
- a deployed TreasuryV4 (intercepted RPC).

## 6. Limits

- The portal's executable path is the V3 one: pool 2951 is **not a memecoin**, and its exit is not offered.
- Memecoin pools are Explore-only: TreasuryV4 / TreasuryDCL are not deployed; Nearly pools are on mainnet.
- Two wallets and five to six approvals: see the friction table in `V4_3A_CREATOR_PORTAL.md`.
- Live tests depend on public endpoints without SLA (one retry configured).
- G8 is still not done.
