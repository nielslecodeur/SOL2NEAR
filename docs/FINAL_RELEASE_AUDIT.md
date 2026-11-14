# Final release audit — SOL2NEAR (2026-11-14)

Technical freeze audit. No X post, video, deck or submission. Nothing pushed, nothing signed.

**Release status: `READY WITH LIMITATIONS`.**
- Everything is reproducible and labelled by evidence kind.
- Open: G8's LP is waiting for your signature, and the memecoin adapters are sandbox-only.

**G8 status: `G8 READY FOR USER SIGNATURE`** (`G8_FINAL_EXECUTION.md`).

## 1. Architecture (what runs where)

```text
Solana devnet ──Phantom──▶ Tidepool (community 1Click-compatible sandbox) ──▶ NEAR testnet wallet
NEAR wallet ──ft_transfer_call──▶ Treasury V3 (deployed, no admin) ── 90/8/2 ──▶ execute_lp ──▶ Ref Classic #2951 (USDC/wNEAR test pool)
Treasury LP shares ──Proof of Liquidity──▶ FUEL (deployed, fixed supply, seasons of 30 min)
V4.1 TreasuryV4 (Classic memecoin pilot)  ─ local sandbox only
V4.2A TreasuryDCL (Rhea DCL / Nearly)      ─ local sandbox only; Nearly pools read on mainnet (views only)
apps/web: Creator Portal (#/), Dashboard, Vault, FUEL Reactor, Pools, Positions — signing only in the user's wallets
```

Deployed code = the local builds, **checked byte for byte**:

| Contract | Deployed `code_hash` | SHA-256 |
|---|---|---|
| Treasury | `8njzxUPU…7F3` | `73b99075…520e` |
| FUEL | `Bz7dZyzX…9inP` | `a33678f6…bbac` |

## 2. Available / not available

| Available (proven) | Kind |
|---|---|
| Treasury deposit 90/8/2, LP into pool 2951, Proof of Liquidity, FUEL admission / close / claim | executed on NEAR testnet (C1–C7, G6) |
| Bridge Solana devnet → NEAR testnet, correlated to the Treasury deposit | executed once (G7) + correlation re-verified |
| Creator Portal, Pool Explorer, Positions, DCL explorer | browser, live reads |
| TreasuryV4 Classic pilot, TreasuryDCL | local sandbox (real contract code) |

| Not available | Why |
|---|---|
| G8 LP + FUEL of deposit #3 | waiting for the creator's signature (29.13 % impact on the test pool; the dashboard refuses ≥ 20 %) |
| A real memecoin pool | no testnet route from Tidepool USDC; Nearly pools are mainnet |
| V3 LP exit | `withdraw_lp` never exercised on-chain |
| Phantom-only journey, creator-fee capture | not built |
| FUEL for V4 positions | `FUEL_NOT_ELIGIBLE` |
| Any mainnet operation | out of scope; **SOL2NEAR is not a mainnet service** |

## 3. Tests (final pass, 2026-11-14)

| Suite | Result |
|---|---|
| Rust: Treasury V3 / FUEL / TreasuryV4 / sandbox-meme / TreasuryDCL | 34 / 31 / 47 / 3 / 41 — all pass (mocked VM) |
| Sandbox Classic (`run.sh v4_pilot`) / DCL (`run.sh v42_dcl`) | 1/1 / 1/1 (real Ref, Tidepool USDC, Rhea DCL v2.4.2, Nearly, wrap wasm; local state) |
| near-client / crosschain / web unit | 57 / 36 / 48 |
| typecheck, web build | OK |
| **e2e `offline` project** (12 tests: replayed RPC snapshot + fixtures, public endpoints blocked, **0 retry**) | **12/12, twice in a row** |
| **e2e `live` project** (31 smoke tests on public endpoints, 1 retry) | 31/31, one of them passed on its retry |
| `pnpm check:release` | passes once the new RPC snapshot fixture is tracked (it caught it untracked) |
| Read-only proofs | `verify-testnet.mjs` all passed · `verify-g6-g7.mjs` 12/12 · `g8-audit.mjs` correlation 3/3 |

## 4. The flaky test — exact cause and fix

| Finding | Evidence | Fix |
|---|---|---|
| V4.1B `@mock` tests were **not** offline: the mock answered only the pilot accounts, and every other call (`route.continue()`) went to the public testnet RPC | flaky failures showed "every provider failed (test.rpc.fastnear.com: Failed to fetch)" and "Estimate problems" (wallet balances unreadable) | real responses recorded once (`E2E_RECORD=1`, 26 view calls, `e2e/fixtures/testnet-rpc-snapshot.json`) and replayed; mainnet, Tidepool and Solana blocked; an unrecorded call returns an explicit RPC error. Renamed `@offline` |
| The remaining flaky test (`@live V4.2A`) | FastNEAR's free tier answers bursts with HTTP 429 **without a CORS header**. Chrome logs it as a CORS error and the app falls back; the test fails on "no console error" | live dependency, kept in the `live` project with one retry and documented. Not hidden: Playwright reports it as `flaky` |
| **Real bug found by the same flake** | a DCL quote that could not be read (429) made the NEARLY card say `BLOCKED_ROUTE` | a failed read now concludes nothing (`OBSERVE_ONLY`, unreadable); only a DCL answer of 0 means "no route" |
| Locators | `getByLabel("Estimate")` also matched "Estimate problems" | exact locators |

Commands: `pnpm --filter @sol2near/web e2e` (both projects), `e2e:offline`, `e2e:live`.

## 5. Bugs resolved across V4.3A → G8

- DCL plan drift between two `predict_hotzap` calls (`E101` on mainnet).
- A failed quote read classified as "no route".
- Non-deterministic `@mock` tests.
- README Node version (≥ 22.18, not 20).
- README tagline overclaim.
- Release checker false positives (a public signature, a third-party build path, itself).
- Portal 390 px overflow.
- e2e locator ambiguity.

## 6. Remaining risks

- Unaudited contracts; Ref and Rhea upgradeable by their DAOs.
- G8 needs one creator signature. Its 29 % impact is irreversible and moves the test pool price for every LP of pool 2951.
- FUEL registration is time-bound (season end + 5 min).
- Public endpoints have no SLA (Tidepool, FastNEAR, drpc, Solana devnet). The live smoke tests depend on them.
- Windows: `cargo test` from a deep folder needs a short `CARGO_TARGET_DIR` (aws-lc-sys, 260-character path limit).

## 7. Reproducibility

- **Clean clone (V4.3A):** `pnpm install --frozen-lockfile` → typecheck → TS tests → web test → build → `check:release` → `cargo test` (short target dir) — all green.
- **Unchanged since:** the toolchain and the lockfiles. The G8 changes are a probe, a fixture, the e2e split, one UI read fix and docs.
- **Prerequisites:** Node ≥ 22.18, pnpm 10.34.9, Rust 1.98 + wasm32, cargo-near 0.22.0 (WSL/Linux) for builds and sandbox, Chrome for e2e.
- **Sandbox wasm:** fetched read-only (`fetch-sandbox-wasm.mjs`, `fetch-dcl-wasm.mjs`), never committed.

## 8. Git

| Item | Value |
|---|---|
| `origin/main` | `2a16cb4` |
| Local commits not pushed | the 8 verified at the start of this checkpoint (`cbb2f84` … `3d6ffaf`) + the G8 commits (`abed3f9` and two small follow-ups); exact list: `git log --oneline origin/main..HEAD`. History not rewritten |
| Content check | no secret, keypair, `.env`, wasm, `node_modules`, build directory or temporary file; the largest files are JPEG captures ≤ 400 KB; fixtures and logs hold public chain data only (accounts, hashes, amounts) |
| Push preconditions | (1) your explicit approval; (2) `pnpm check:release` green on the pushed tree; (3) a quick live re-run of `verify-testnet.mjs`. The push publishes those commits (≈ 100 files, + 20 k lines), all docs and fixtures included |

## 9. Maturity (objective)

| Layer | Level |
|---|---|
| V3 Treasury + FUEL | **working on testnet**, proven by 20+ verified transactions; unaudited; no tested exit |
| Bridge | proven **once** on devnet via a community sandbox |
| End-to-end (G8) | **one signature away** from LP proof; FUEL depends on timing |
| Memecoin adapters (V4.1 Classic, V4.2A DCL) | **prototype**: strong local evidence on real contract code, never deployed |
| Frontend | guided and honest: each kind of evidence labelled; offline-deterministic + live smoke e2e |
| Production readiness | **not production**: testnet only, no audit, no mainnet route |

## 10. Release freeze re-check (2026-11-14 ~14:25 UTC)

| Check | Result |
|---|---|
| Rust 34 / 31 / 47 / 3 / 41 | pass |
| near-client 57 · crosschain 36 · web 48 · typecheck · build | pass |
| e2e `offline` (deterministic, 0 retry) | 12/12 |
| `pnpm check:release` | all passed, no uncommitted file |
| Clean clone of `HEAD` | `pnpm install --frozen-lockfile` → typecheck → test:ts → build → check:release: all green |
| Push | prepared, **not executed**: needs your approval, independent of the G8 transaction |

**Scope reminder:**
- **G8 / V3** concerns the deployed Treasury and the **USDC/wNEAR test pool #2951**.
- **V4** targets NEAR memecoins: TreasuryV4 Classic and TreasuryDCL run only in a local sandbox, and Nearly pools are read on mainnet.

A V3 proof is not a proof of funding a memecoin.
