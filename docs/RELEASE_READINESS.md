# Release readiness — SOL2NEAR (2026-11-14)

Technical readiness only. No X post, video, pitch deck or submission is prepared here. Nothing was pushed.

**Verdict: `READY WITH LIMITATIONS`.**
- The repository is reproducible and every claim is backed by its kind of evidence.
- The limitations are product limits, not hidden defects:
  - the only executable pool is a test USDC/wNEAR pool;
  - the memecoin adapters are local-sandbox only;
  - G8 is not done;
  - there is no tested exit on the deployed V3 Treasury.

## 1. Functional audit of the Creator Portal (categories never mixed)

Legend: ✅ yes · — no · ⛔ blocked by a dependency

| Feature | Implemented | Tested locally (unit / sandbox) | Tested in browser | Verified on public testnet | Verified on public mainnet | Not available |
|---|---|---|---|---|---|---|
| Landing, evidence-tagged status table | ✅ | ✅ unit (`FEATURES`) | ✅ @live | n/a | n/a | |
| Live / Explore modes, strict separation | ✅ | ✅ unit (`poolOffers`) | ✅ @live (explore: nothing enabled can execute) | n/a | n/a | |
| Phantom connect, devnet USDC balance, session restore | ✅ | — | ✅ @mock provider + real Solana devnet read | ✅ real Phantom signature once (G7) | — | |
| NEAR wallet (Wallet Selector, testnet) | ✅ | ✅ unit (41, G4) | ✅ real modal (G5) | ✅ G6 (Meteor) | — | |
| Pool selection (Live: #2951 only) | ✅ | ✅ unit | ✅ @live | ✅ pool 2951 LP (C2, G6-LP, G6-LP2) | — | |
| Contribution simulator (14 rows) | ✅ | ✅ unit | ✅ @mock quote + live pool read | the pool views are live testnet; the quote is mocked in tests and live in use | — | |
| Bridge Solana devnet → NEAR testnet | ✅ | ✅ unit (mocked) | ✅ | ✅ **G7, once** | — | |
| Treasury deposit 90/8/2 | ✅ | ✅ unit | ✅ @mock wallet | ✅ C1, G6-D, G6-D2, G7-TREAS | — | |
| LP execution (Classic, pool 2951) | ✅ | ✅ unit | ✅ review only | ✅ C2, G6-LP, G6-LP2 | — | |
| FUEL register / claim (pool 2951) | ✅ | ✅ unit | ✅ | ✅ C4–C7, G6 | — | |
| End-to-end reconciled operation (G8) | — | — | — | — | — | ✅ not done |
| V3 position tracking (unified card) | ✅ | ✅ unit on real testnet reads | ✅ @live (G6/G7 creator) | ✅ reads | — | |
| V3 LP exit | code exists | ✅ unit | — | never exercised | — | ✅ not offered |
| V4.1 TreasuryV4 Classic pilot | ✅ | ✅ 47 unit + **sandbox** | ✅ @preview / @mock | — not deployed | — | ⛔ deployment approval |
| V4.2A TreasuryDCL (DCL position, fees, NFT exit) | ✅ | ✅ 41 unit + **sandbox (real DCL + Nearly wasm)** | ✅ @preview | — not deployed | — | ⛔ deployment approval + a network where pool and USDC route coexist |
| Real Nearly pools: classification, reference simulation | ✅ | ✅ unit on mainnet fixture | ✅ @live (mainnet views) | n/a | ✅ **reads only** | |
| Fund a real memecoin pool | — | — | — | — | — | ✅ ⛔ |
| Phantom-only journey | — | — | — | — | — | ✅ needs a new custody / delegation design |
| Creator-fee capture (Pump.fun / Bags) | — | — | — | — | — | ✅ |

**No SOL2NEAR transaction exists on mainnet**, and none can be prepared from the dashboard.

## 2. Reproducibility audit

| Check | Result |
|---|---|
| Clean clone | `git clone` of the local repo → `pnpm install --frozen-lockfile` (11.6 s) → `pnpm typecheck` → `pnpm test:ts` (57 + 36) → web test (48) → web build → `pnpm check:release` → `cargo test --workspace` (34 / 31 / 47 / 3 / 41): **all green** |
| Windows caveat | from a deep folder, `cargo test` can hit the 260-character path limit inside `aws-lc-sys` (a near-sdk unit-testing dependency built with CMake). Use a short `CARGO_TARGET_DIR` or enable long paths. Linux / WSL are unaffected |
| Toolchain | **Node ≥ 22.18** (tests run `.ts` through Node's type stripping; tested 24.12), pnpm 10.34.9 (`packageManager`), Rust 1.98 + `wasm32-unknown-unknown`, cargo-near 0.22.0 for builds, Chrome for e2e. README corrected (it said Node ≥ 20) |
| Dependencies | `pnpm-lock.yaml` and `Cargo.lock` committed; `--frozen-lockfile` succeeds; `sandbox-tests` has its own lockfile |
| Start / test commands | README "Try it" table, steps 1–10, each with its expected output |
| Sandbox wasm | **not committed** (third-party code). Fetched read-only with `scripts/probes/fetch-sandbox-wasm.mjs` and `fetch-dcl-wasm.mjs`, which print the SHA-256 and compare the Nearly tokens with their published hashes |
| Fixtures | all referenced fixtures are tracked (`check:release`). Each states its source (`read_at`, `note`) |
| Personal paths | none in code or config (`check:release`). Docs cite the author's folder as context only |
| Secrets | no key material, `.env`, keypair or PEM tracked; none in the bundle (`check:release`). `.gitignore` covers `.env*`, `*.pem`, `*.key`, `*-keypair.json`, `.near-credentials/`, `neardev/` |
| Unlabelled simulated data | none: the demo data source is bannered `SIMULATED`; sandbox previews have striped banners; simulator rows carry their basis; mainnet cards say read-only |
| Destructive commands | none in `scripts/` or the sandbox runner (`check:release`); the testnet runbooks are manual and approval-gated |
| Network dependence | live tests use public NEAR / Solana / Tidepool endpoints without SLA; one Playwright retry. A blocked Tidepool domain makes the quote "unavailable", never invented |

## 3. Git (local, not pushed)

`origin/main` = `2a16cb4`. Local commits:

| Commit | Content | Files |
|---|---|---|
| `cbb2f84` V4.0 | Pool Explorer, registry, live checks, preflight, scan probe, fixture | 15 (10 added) |
| `0011330` V4.1A | TreasuryV4 + S2NMEME crates, sandbox-tests, probes, docs | 36 (25 added) |
| `63d0302` V4.1B | dashboard pilot + Position Manager, sandbox views fixture, reconcile fix | 29 (10 added, 3 deleted) |
| `d7c0812` V4.2A | TreasuryDCL, DCL probes and sandbox runs, client, UI section, docs, captures | 32 (25 added) |
| `ab1d7c0` V4.3A | Creator Portal, portal model, unified positions, S1, docs correction, release checks | 25 (9 added) |
| `25dd7a6` V4.3A | DCL plan drift fix, exact e2e locators, the three V4.3A docs, README numbers | 11 |

Total vs `origin/main`: ≈ 92 files, + 19 k lines. Largest files are JPEG captures (≤ 400 KB).

No secret, no wasm and no `node_modules` are in these commits.

**Push: waiting for your approval.**

## 4. Re-check commands (read-only)

```sh
node scripts/probes/verify-testnet.mjs        # Treasury / FUEL / Ref pool 2951 / Tidepool
node scripts/probes/verify-g6-g7.mjs          # every G6 / G7 transaction, final with its events
node scripts/probes/v42-dcl-audit.mjs         # Rhea DCL / Nearly mainnet views → fixture
pnpm check:release                            # after `pnpm --filter @sol2near/web build`
```

## 5. Risks to state in any presentation

- Testnet / devnet only. Test tokens have no value. Tidepool is a community sandbox, not NEAR Intents.
- The executable pool (2951) is USDC/wNEAR, **not a memecoin**. Memecoin funding is sandbox-proven only.
- Unaudited contracts. Ref and Rhea are upgradeable by their DAOs.
- No tested exit on the deployed V3 Treasury.
- G8 is not done.
- No yield is promised. Fees can be zero; a concentrated position earns nothing out of range.
- FUEL rewards only V3 pool-2951 positions; V4 positions are `FUEL_NOT_ELIGIBLE`.

## 6. Verdict and what would change it

**`READY WITH LIMITATIONS`.**
- **UX:** the journey is guided and honest.
- **Technical:** all suites green; reproducible from a clean clone.
- **Security:** the inflated-balance case is proven on real code; the async model is documented receipt by receipt.

It would become `READY FOR RELEASE REVIEW` with your decisions on:
1. **push** of the local commits;
2. optionally **G8** (a small bridged deposit whose LP fits the impact guard, signed by you);
3. optionally a public deployment path for a memecoin adapter (V4.2A §8 options a/b/c), each step separately approved.
