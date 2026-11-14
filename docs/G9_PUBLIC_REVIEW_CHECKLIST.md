# G9 — Public review checklist (verify SOL2NEAR without signing anything)

For an independent reviewer who only has the public repository. **No wallet, key, signature or funds are needed.**
Every command below only reads public chains or runs locally. Expected results were observed on 2026-11-14 from a fresh clone of `https://github.com/nielslecodeur/SOL2NEAR`.

There is **no hosted frontend** (`NO PUBLIC FRONTEND CONFIRMED`): run the dashboard locally (step 4).

## 0. Prerequisites (≈ 5 min)

- **Node ≥ 22.18**: the tests run `.ts` files with Node's type stripping (tested with 24.12).
- **pnpm 10** (`packageManager` pins 10.34.9).
- **Rust stable** (tested 1.98) + `wasm32-unknown-unknown`.
- **Google Chrome**, for the browser tests.
- For the sandbox runs only: **Linux or WSL** with cargo-near 0.22.0.
- On Windows, run `cargo test` with a short `CARGO_TARGET_DIR`: the CMake build of a test dependency can exceed the 260-character path limit.

## 1. Fast path (≈ 15 min, no chain write)

```sh
git clone https://github.com/nielslecodeur/SOL2NEAR && cd SOL2NEAR
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test:ts && pnpm --filter @sol2near/web test
pnpm --filter @sol2near/web build && pnpm check:release
pnpm --filter @sol2near/web e2e:offline          # deterministic browser tests, no network
cargo test --workspace
node scripts/probes/verify-testnet.mjs           # read-only: deployed contracts, pool 2951, Treasury LP, FUEL
node scripts/probes/verify-g6-g7.mjs             # read-only: every G6/G7 transaction final with its events
node scripts/probes/g8-audit.mjs                 # read-only: deposit #3 + Solana ↔ Tidepool ↔ NEAR correlation
```

## 2. What to check, and what each proof is worth

| Feature | Proof type | Link / command | Expected result | Limitation |
|---|---|---|---|---|
| Treasury and FUEL deployed with the published code | on-chain state | `verify-testnet.mjs`; `node scripts/probes/g8-audit.mjs` prints the `code_hash` values | Treasury `8njzxUPU…7F3` (= SHA-256 `73b99075…520e` of `scripts/build-wasm.sh`), FUEL `Bz7dZyzX…9inP` (= `a33678f6…bbac`) | the contract accounts **still have a full-access key**: the developer could redeploy them |
| 90/8/2 split | executed tx + contract rule | C1 `AsD2o2aV…ZWzw`, G7-TREAS `J7uMjikj…Bdhz`; `cargo test -p sol2near-treasury` | `deposit_allocated` events: 20 → 18 / 1.6 / 0.4 and 87.9948 → 79.19532 / 7.039584 / 1.759896 | — |
| LP into Ref pool 2951, held by the Treasury | executed tx + on-chain state | C2, G6-LP, G6-LP2; `verify-testnet.mjs` | `PASS Treasury holds 268750243691052670214318 LP shares of pool 2951` | pool 2951 is **USDC/wNEAR test liquidity, not a memecoin** |
| FUEL Proof of Liquidity, season, single claim | executed tx | C4–C7, G6-REG2/CLOSE/CLAIM, G6-REJ | `position_admitted`, `season_closed` Success, `reward_claimed`; a second claim and a late registration are rejected | FUEL accepts only V3 / pool 2951 positions |
| Bridge Solana devnet → NEAR testnet | executed tx (two chains) + third-party record | `verify-g6-g7.mjs` (G7-SOL, G7-NEAR, G7-TREAS); `g8-audit.mjs` → `correlation` | Solana tx finalized; NEAR settlement 1.9948 USDC to `lowarena9362.testnet`; correlation flags all `true` | Tidepool is a **community sandbox**, not NEAR Intents. The Treasury deposit contains the bridged USDC by balance arithmetic (86 + 1.9948), not by tag |
| G8: bridged deposit → LP → FUEL | on-chain state | `g8-audit.mjs` | deposit #3 `BudgetAllocated`, LP budget 79195320, `lp_shares` 0, `in_flight` null | **NOT COMPLETED**: its LP plan has 29.13 % impact and was not authorised; `docs/G8_FINAL_EXECUTION.md` |
| TreasuryV4 Classic memecoin pilot (S2NMEME) | **local sandbox** (real Ref + Tidepool USDC wasm) | `docs/v4/sandbox-run.log`; re-run: README step 9 (`run.sh v4_pilot`) | `test result: ok. 1 passed`; books = real balances | **not deployed**; S2NMEME is a test token with no value |
| TreasuryDCL (Rhea DCL adapter, Nearly-type token) | **local sandbox** (real Rhea DCL v2.4.2 + Nearly wasm) | `docs/v4/v42-dcl-sandbox-run.log`; README step 9 (`run.sh v42_dcl`) | position owned by the Treasury, exact fee claims, NFT exit, step S1 "accounting unchanged = true" | **not deployed**; local test tokens |
| Real Nearly pools (NEARLY, NEARKAT, DRAGON) | mainnet **reads only** | `node scripts/probes/v42-dcl-audit.mjs` | NEARLY / NEARKAT raw tokens (no tax), DRAGON tax v2 (1 % / 1 %) | no SOL2NEAR transaction exists on mainnet |
| Creator Portal, Pools, Positions | browser | `pnpm --filter @sol2near/web dev` → `#/`, `#/pools`, `#/positions`; `e2e:offline` | 12/12 offline tests; the portal shows each feature's evidence kind | no hosted demo; signing needs your own testnet wallets |
| Release hygiene | static check | `pnpm check:release` | `all release checks passed` | false positives handled: public signatures, a third-party build path |

## 3. Notes for automated reviewers

- **NearBlocks** pages show a Cloudflare check to headless browsers and `curl` (HTTP 403). Use the read-only scripts above, which query NEAR RPC directly, or open the links in a normal browser.
- The Solana explorer works in a browser (`curl` may get HTTP 429).
- **Live browser tests** (`e2e:live`, 31 tests) read public endpoints without SLA. FastNEAR answers bursts with HTTP 429 without a CORS header, so one retry is configured and the report lists retried tests as `flaky`. The **offline** project is deterministic and needs no network.
- Nothing in this checklist signs, deploys or moves funds.
