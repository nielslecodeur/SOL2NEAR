# SOL2NEAR

> **SOL2NEAR lets Solana memecoin creators route USDC they control into verifiable, programmable liquidity on NEAR.** (Creator fees are not captured automatically: the creator chooses and sends the amount.)
>
> ⚠️ **TESTNET DEMO ONLY.** Solana Devnet → Tidepool → NEAR Testnet. Test tokens have no value; never send real funds.
> **Tidepool is a community-built 1Click-compatible sandbox — not the official NEAR Intents service.**
> NEAR Intents has no testnet; production would target the official 1Click API.

NEAR Hackathon 2026 · tracks **`memecoins`** (main) and **`defi`** · built at NEAR HACKATHON.

## What it is

Memecoin creators earn fees on Solana, but that revenue rarely becomes transparent, long-term liquidity elsewhere.
SOL2NEAR lets a creator **voluntarily** route USDC from Solana to a NEAR **Treasury** contract that:

1. accepts only the configured test USDC (NEP-141) and splits every deposit **90 % LP / 8 % creator reserve / 2 % community**, in atomic units;
2. deploys the LP budget into a real **Ref/Rhea AMM pool** (deposit → partial swap → add_liquidity);
3. **measures the LP shares on-chain**, holds them for the creator, locks them, and publishes a **Proof of Liquidity**;
4. feeds the **FUEL Reactor**: FUEL is a fixed-supply NEP-141 memecoin earned only for LP that Ref itself confirms the Treasury holds. Community seasons level the Reactor up, or level it down and burn a small prefunded slice of supply. The mechanic reads LP state, never the price chart. See `docs/FUEL_REACTOR.md`.

The rules (split, lock, token ids, pool, FUEL supply and season parameters) are fixed at deployment, and nobody holds an admin key over them.

## Status — what is proven, and how (2026-11-14)

Every line names its kind of evidence. They are never mixed: a sandbox run is not a testnet transaction, a mainnet read is not a mainnet transaction, a unit test is not an integration. Re-check the public proofs with `node scripts/probes/verify-testnet.mjs` and `node scripts/probes/verify-g6-g7.mjs` (read-only, no keys).

### 1. Executed on NEAR testnet (transaction hashes below, re-verified 2026-11-14)
| Feature | Proof |
|---|---|
| Treasury and FUEL deployed (`treasury.sol2near-dev.testnet`, `fuel.sol2near-dev.testnet`) | B1 `HJTW4c6u…yUpY`, B4 `JBdFrx2j…rbBP` |
| Deposit → 90/8/2 split on-chain, from CLI and **from the dashboard with a real wallet** (Meteor) | C1, G6-D, G6-D2, G7-TREAS |
| LP into Ref Classic **pool 2951 USDC/wNEAR — a test pool, not a memecoin**; shares held by the Treasury and verified against Ref | C2, C3, G6-LP, G6-LP2 |
| FUEL: Proof-of-Liquidity admission, season close, single claim, second claim rejected, late registration rejected | C4–C7, G6-REG2, G6-CLOSE, G6-CLAIM, G6-REJ |

### 2. Bridge really verified (Solana devnet → NEAR testnet)
| Feature | Proof |
|---|---|
| 2 USDC sent from Phantom on Solana devnet, through **Tidepool (a community 1Click-compatible sandbox, not NEAR Intents)**, arrived as 1.9948 USDC on NEAR testnet and was deposited into the Treasury | G7-SOL `bGUicpgy…887R` → G7-NEAR `J58H2uyu…RFqf` → G7-TREAS `J7uMjikj…Bdhz` |
| Correlation Solana tx ↔ Tidepool record ↔ NEAR settlement re-verified (intent hashes match the on-chain events); the Treasury deposit contains the bridged USDC by balance arithmetic (86 + 1.9948, USDC is fungible) | `node scripts/probes/g8-audit.mjs` · `docs/G8_PROOF_LEDGER.md` |
| **G8 — `READY FOR USER SIGNATURE`, not done:** deposit #3 (the bridged funds) is `BudgetAllocated`, no job in flight, books = balances. Its LP plan is prepared from live Ref reads (29.13 % price impact on the test pool, so the dashboard refuses it; the contract would accept it) and waits for the creator's signature; FUEL then has a 30 min + 5 min window | `docs/G8_FINAL_EXECUTION.md` |

### 3. Tested only in a local sandbox (real contract code, local state — NOT deployed)
| Feature | Evidence |
|---|---|
| **V4.1 TreasuryV4** — Classic memecoin pilot with the S2NMEME test token: on-chain guards, LP custody, lock, exit, leftover recovery | 47 unit tests + `sandbox-tests` run against the real Ref and Tidepool USDC wasm (`docs/v4/sandbox-run.log`) |
| **V4.2A TreasuryDCL** — Rhea DCL concentrated-liquidity position for a Nearly-type memecoin: USDC → two swaps + add_liquidity in one DCL HotZap, position (NEP-171) held for the creator, exact fee claims, exit by NFT transfer after a lock, taxed tokens refused | 41 unit tests + `sandbox-tests` run against the **real Rhea DCL v2.4.2 wasm (mainnet code)** and the real Nearly token wasm (`docs/v4/v42-dcl-sandbox-run.log`) |

### 4. Mainnet integrations — read-only
| Feature | Evidence |
|---|---|
| Real NEAR memecoin pools (Ref Classic CHILL / BLACKDRAGON, Nearly DCL NEARLY / NEARKAT / DRAGON): identity, fee tier, taxes, routes, reference simulations (`quote`, `predict_hotzap`) | public view calls only; **no SOL2NEAR transaction has ever been sent on mainnet** |

### 5. Not available
- Funding a **real memecoin pool**: no testnet memecoin pool is reachable from Tidepool USDC, and Nearly pools are on mainnet.
- Exit from the deployed V3 Treasury: `withdraw_lp` exists in code but was never exercised on-chain, so the dashboard does not offer it.
- One-wallet (Phantom-only) journey: the NEAR side needs a NEAR wallet signature.
- Automatic capture of Pump.fun / Bags creator fees: the creator sends the USDC they choose, by hand.

### 6. FUEL, custody and transfer risks
- **FUEL** recognises only the V3 Treasury and pool 2951 (no setter). V4.1 and V4.2A positions are `FUEL_NOT_ELIGIBLE`.
- **Custody:** LP shares and DCL positions are held by the Treasury contract for the creator (no admin key, no setter). The deployed contracts are **unaudited**; Ref/Rhea contracts are upgradeable by their DAOs.
- **Transfers:** Tidepool is a third-party test service without SLA (deposit address, settlement). Test tokens have no value.
- **No yield is promised.** Pool fees are variable and can be zero; a concentrated position earns nothing out of its range.

## Try it — action → expected result

Prerequisites:
- **Node ≥ 22.18** (tested with 24.12): the TypeScript tests run `.ts` files with Node's built-in type stripping, so Node 20 is not enough.
- pnpm 10 (`packageManager` pins 10.34.9).
- Rust stable (tested with 1.98) with the `wasm32-unknown-unknown` target. On Windows from a deep folder, use a short `CARGO_TARGET_DIR` (the near-sdk test dependency `aws-lc-sys` builds with CMake and can hit the 260-character path limit).
- For the wasm builds and the sandbox runs: Linux or WSL, with cargo-near 0.22.0.
- For the browser tests: a local Google Chrome (Playwright `channel: "chrome"`).

| # | Command | Expected result | How to verify |
|---|---|---|---|
| 1 | `git clone https://github.com/nielslecodeur/SOL2NEAR && cd SOL2NEAR` | repo checked out | `LICENSE` (MIT) present |
| 2 | `cargo test --workspace` (on Windows, set the CMake env from `docs/ARCHITECTURE.md` §7 first) | `34 passed` (treasury), `31 passed` (fuel), `47 passed` (treasury-v4, V4.1, not deployed), `3 passed` (sandbox-meme), `41 passed` (treasury-dcl, V4.2A, not deployed) | test names map to the rules in `docs/FUEL_REACTOR.md` §2–4 |
| 3 | `cargo test -p sol2near-fuel demo_walkthrough -- --nocapture` | 6 numbered steps: position admitted with its Ref/Treasury proof, a non-backed one refused, season progress, `close_season` → Success/level 1, claim paid, **second claim REJECTED** | output says "MOCKED NEAR VM (not testnet)" |
| 4 | `bash scripts/build-wasm.sh` (Linux/WSL, cargo-near) | `Contract successfully built!` twice | sizes and SHA-256 printed. The FUEL ABI has no mint method |
| 5 | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test:ts && pnpm --filter @sol2near/web test` | all `fail 0`: near-client 57, crosschain 36, web 48 | the near-client tests run on real read fixtures (labelled); crosschain tests are **mocked** (Tidepool + Solana RPC) |
| 6 | `pnpm --filter @sol2near/web e2e` (or `e2e:offline` / `e2e:live`) | **offline** project: 12 deterministic tests (replayed RPC snapshot + fixtures, every public endpoint blocked, no retry). **live** project: 31 smoke tests on public NEAR / Solana / Tidepool endpoints, one retry, retried tests listed as "flaky" | `@offline`, `@preview`, `@live`, `@mock` in the test names |
| 7 | `pnpm --filter @sol2near/web dev`, open the URL | **Creator Portal**: the journey Connect → Choose pool → Amount → Review → Track, with two separate modes (*Live · NEAR testnet* and *Explore · NEAR memecoins*, read-only). `#/dashboard`: type `sol2near-dev.testnet`, click **Load** → 20 USDC received, split 18 / 1.6 / 0.4, LP **BACKED ON REF**, FUEL `Claimed` | the *What is real today* table on the portal shows the evidence kind of every feature |
| 8 | `node scripts/probes/verify-testnet.mjs` and `node scripts/probes/verify-g6-g7.mjs` (read-only, no keys) | `all checks passed`; `all G6/G7 proofs re-verified` | Tidepool is a community service with no SLA: on a network that filters its domain the Tidepool checks print `FAIL … fetch failed` |
| 9 | Sandbox runs (Linux/WSL): `node scripts/probes/fetch-sandbox-wasm.mjs && node scripts/probes/fetch-dcl-wasm.mjs`, then `bash scripts/build-wasm.sh treasury-v4 sandbox-meme treasury-dcl`, then `bash sandbox-tests/run.sh v4_pilot` and `bash sandbox-tests/run.sh v42_dcl` | `test result: ok. 1 passed` for each | the wasm come from the chains with read-only `view_code` (SHA-256 printed). Nothing is committed |
| 10 | `pnpm --filter @sol2near/web build && pnpm check:release` | `all release checks passed` (no key material, no personal path, no eval or e2e hook in the bundle, fixtures tracked, no destructive script) | `scripts/check-release.mjs` |

### On-chain proof (NEAR testnet, 2026-11-11 → 2026-11-13)

Full log with gas, costs and read-only checks: [`docs/G2_EXECUTION.md`](docs/G2_EXECUTION.md).

| Step | What | Transaction |
|---|---|---|
| A8 | Ref `add_simple_pool` USDC(tp)/wNEAR(tp) → pool **2951** | [BXcJeRyX…7f7B](https://testnet.nearblocks.io/txns/BXcJeRyXUUEwniGP46KJeYRjWHxgHcPK2RCQdpYZ7f7B) |
| A9 | seed liquidity 50 USDC + 14.0392 wNEAR | [5MahUPdU…fBRp](https://testnet.nearblocks.io/txns/5MahUPdUvWNSbD14RuijZXGTpHmA66ZpN67yR1EHfBRp) |
| B1 | deploy Treasury (wasm `73b99075…520e`) | [HJTW4c6u…yUpY](https://testnet.nearblocks.io/txns/HJTW4c6uNaSVmuzNRG84NcCQaRMeunAoiP3omquNyUpY) |
| B2 | Treasury `setup` (`ready = true`) | [6sMPV5RT…eVgy](https://testnet.nearblocks.io/txns/6sMPV5RToZRd77cjaUa32QgpU9f8poWFawpFAKSEeVgy) |
| B4 | deploy FUEL (wasm `a33678f6…bbac`), supply 1 000 000 | [JBdFrx2j…rbBP](https://testnet.nearblocks.io/txns/JBdFrx2j7ToEWWY77aKpbpw8B6PivPhowM9ZZWQtrbBP) |
| C1 | deposit 20 USDC → split 18 / 1.6 / 0.4 | [AsD2o2aV…ZWzw](https://testnet.nearblocks.io/txns/AsD2o2aVxkSmhm4c3TVsLs9aZgKjMTog2KW42pieZWzw) |
| C2 | `execute_lp`: swap + add_liquidity, LP shares held by the Treasury | [4F2wXqzm…SSHA](https://testnet.nearblocks.io/txns/4F2wXqzmyBVaPqKa6mE3KMFjFv2S3U3GxXJYJfNsSSHA) |
| C3 | `verify_liquidity`: on-chain shares = recorded shares | [8DCCtF7y…MrkA](https://testnet.nearblocks.io/txns/8DCCtF7yafVwXnGhziTAAHvxhS94nZiTPXZk5ry3MrkA) |
| C4 | FUEL `register_position(0)` → reward 9.676812 FUEL | [CoAgrgQE…Lk6o](https://testnet.nearblocks.io/txns/CoAgrgQEhmktNEK1hvgZpwUHjsaTR6XvS9z1NSNpLk6o) |
| C5 | `close_season(0)` → Success, level 1 | [DUuoq2XZ…haH9](https://testnet.nearblocks.io/txns/DUuoq2XZsmVbwp8zjzhW3gHRqjiDwokwbTMSNufdhaH9) |
| C6 | `claim(0)` → 7.7414496 FUEL to the creator | [6g13fiwv…hXxu](https://testnet.nearblocks.io/txns/6g13fiwvEbSoHhYLXGkDcN9tEsPLG2LXic88bmP3hXxu) |
| C7 | second `claim(0)` → rejected `ERR_ALREADY_CLAIMED` (expected failure) | [J8UEKyZy…AoWHi](https://testnet.nearblocks.io/txns/J8UEKyZyyYpHrzW8HTJiJ1tqtq23GdkX2VA8HdYAoWHi) |
| G6-D | **from the dashboard**: `lowarena9362.testnet` (Meteor wallet) deposits 2 USDC → deposit #1, 1.8 / 0.16 / 0.04, verified by event + `get_deposit` (`docs/G6_LIVE_WALLET_E2E.md`) | [FaBKjLRU…haHV](https://testnet.nearblocks.io/txns/FaBKjLRUuYMgH4SgVgurTyUinDPvPvdH5Rxc69X1haHV) |
| G6-LP | **from the dashboard**: `execute_lp(1)` signed in Meteor, plan from the live pool; 0.904526 USDC in LP, 0.0153 shares, `lp_verified`, Treasury shares = Ref shares | [CniqxoxZ…bRdN](https://testnet.nearblocks.io/txns/CniqxoxZ5qzJBLZ9RCwJ9nH4evbNwaGV6Y1nE4aDbRdN) |
| G6-D2 | **from the dashboard**: deposit 12 USDC → deposit #2, 10.8 / 0.96 / 0.24 | [DmbsT6ce…g9Gi](https://testnet.nearblocks.io/txns/DmbsT6ce7U9GPqVZYPgv2Kc5hmMn8cNeYKKDq8u1g9Gi) |
| G6-LP2 | `execute_lp(2)`: 5.586053 USDC in LP, verified, Treasury shares = Ref shares | [CundGCKW…pHyD](https://testnet.nearblocks.io/txns/CundGCKWCSnC14tTRkaJ8EiRzDRttQvhQ3SjFgfTpHyD) |
| G6-REG2 | `register_position(2)` → admitted in season 70 (5.586053 / 5 USDC) | [SrFHSmHC…sghM](https://testnet.nearblocks.io/txns/SrFHSmHCx41j2ytekUvZhV5sX4AHkSsQCrBNLZbsghM) |
| G6-CLOSE | `close_season(70)` → **Success**, level 1 → 2, 0 burned | [ELiyFHpW…Ay3s](https://testnet.nearblocks.io/txns/ELiyFHpWnJSMrQamjP1cxYZsRXnUNBg5t32r1nMjAy3s) |
| G6-CLAIM | `claim(2)` → 4.4688424 FUEL to `lowarena9362.testnet` | [8CRvXVJg…A7F8](https://testnet.nearblocks.io/txns/8CRvXVJgk7sEiapJZSYiiFhhMRANPxZL9rGmAsFsA7F8) |
| G6-REJ | `register_position(1)` after its window → `position_rejected ERR_REGISTRATION_WINDOW_CLOSED` (expected refusal) | [3HsEr7b3…XQRzF](https://testnet.nearblocks.io/txns/3HsEr7b3Mr1zYLmLi3q6ApgcthXarUTwe9tg5xxXQRzF) |
| G7-SOL | **Solana devnet → Tidepool**: user deposit of 2 USDC to the live-quote deposit address (signed in the user's Solana wallet from the dashboard) | [bGUicpgy…887R](https://explorer.solana.com/tx/bGUicpgyYtePFP3BcEXYHQ9me67uqFjFQWmS8FsKWhYSzwpcVDv5SZyyLxYneLX93Bic4JZRFrWvphQUkEs887R?cluster=devnet) |
| G7-NEAR | **Tidepool → NEAR**: settlement `ft_transfer` 1.9948 USDC to `lowarena9362.testnet`, verified by balance (+1994800) | [J58H2uyu…RFqf](https://testnet.nearblocks.io/txns/J58H2uyuGo4wJsjbNuX1AEEwszD4Z8CMAppCqCirRFqf) |
| G7-TREAS | **NEAR → Treasury**: the user deposits the bridged balance (whole 87.9948 USDC incl. the 1.9948 bridged) → deposit #3, 79.19532 / 7.039584 / 1.759896. Path B complete | [J7uMjikj…Bdhz](https://testnet.nearblocks.io/txns/J7uMjikj935TeunPoHj2i7xrCSSDrYEAmvdHv7DYBdhz) |

Pool 2951 is shallow (≈ 80 USDC + 14 wNEAR of test liquidity), so the zap price is worse than the Tidepool quote, and a large LP budget is refused by the price-impact guard (deposit #3: 29 % impact, LP not offered). This is a demo-pool effect. The Solana Devnet → NEAR leg via Tidepool ran for real once (G7-SOL → G7-NEAR). **G8 (one operation reconciled end to end: Solana → Treasury → LP → FUEL) is not done yet**: the bridged funds are in deposit #3, whose LP is blocked by the impact guard. Re-check every G6/G7 proof: `node scripts/probes/verify-g6-g7.mjs`.

## Repository

```
apps/web/              dashboard: Creator Portal (#/), Dashboard, Vault, FUEL Reactor, Pools, Positions; signing only in the user's wallets
contracts/treasury-dcl/ TreasuryDCL (V4.2A, local only): Rhea DCL adapter, NOT deployed
contracts/treasury/    Treasury: USDC intake, 90/8/2, Ref LP pipeline, Proof of Liquidity (lead)
contracts/fuel/        FUEL: fixed-supply NEP-141 + Reactor seasons gated by Ref-verified LP (lead)
packages/near-client/  LP plan from live Ref views (lead)
packages/shared/       shared constants + TypeScript interfaces
packages/crosschain/   Tidepool / Solana Devnet client: quotes, unsigned SPL deposit tx, status tracking
docs/                  spec V3, workflow, feasibility, architecture, hackathon checklist
scripts/               testnet runbooks (manual, approval required)
tests/                 end-to-end (checkpoint 2)
```

## Fees

The code contains **no hard-coded bridge, swap or protocol fee**. Costs are read from real quotes:
Tidepool `POST /v0/quote` (`amountIn`, `amountOut`, `minAmountOut`) and Ref `get_return` / `predict_add_simple_liquidity` / `get_pool.total_fee`.
SOL2NEAR takes **0 %** during the hackathon.

## Prior work, libraries, templates, AI assistance

- **Prior work:** none. The repository was created on 2026-11-11, inside the hackathon window, and all code was written during the hackathon.
- **Libraries:** `near-sdk` 5.30.1 and `near-contract-standards` 5.30.1 (the NEP-141/145 implementation used by FUEL), React 18.3.1 and Vite 5.4.11 (web), NEAR Wallet Selector 10.1.4 (`@near-wallet-selector/core`, `modal-ui`, `my-near-wallet`, `meteor-wallet`) and `@near-js/transactions` 2.5.1 (NEAR wallet), `@solana/web3.js` 1.98.4 and `@solana/spl-token` 0.4.14 (cross-chain). Dev and build tools: cargo-near 0.22.0 (runs wasm-opt), near-cli-rs 0.31.1, TypeScript 5.6.3, @vitejs/plugin-react 4.3.4, @types/node 22.10.2, pnpm 10, Node's built-in test runner.
- **External services:** Tidepool (community testnet sandbox, `www.usetidepool.tech`), Ref/Rhea exchange testnet `ref-finance-101.testnet`, NEAR testnet RPC. Read-only mainnet view calls (public RPC) of Ref/Rhea pools, Rhea DCL `dclv2.ref-labs.near` and Nearly (`nearlytrade.near`, token code from github.com/sam3dsol/Nearlytrade), used only to classify pools and, in V4.2A, to run their deployed code in a local sandbox. No mainnet transaction.
- **Templates / boilerplate:** none.
- **AI assistance:** code and documentation were written with **Claude Code (Anthropic)** under the direction of the author (solo project), then reviewed and tested by the author. This includes the cross-chain package.

## Key docs

- `docs/HACKATHON_CHECKLIST.md`: official rules mapped to this project, with the final pre-submission check
- `docs/G8_FINAL_EXECUTION.md`, `docs/G8_PROOF_LEDGER.md`, `docs/FINAL_RELEASE_AUDIT.md`: G8 state of deposit #3, the prepared LP transaction, the full proof ledger, final release audit
- `docs/RELEASE_READINESS.md`, `docs/V4_3A_CREATOR_PORTAL.md`, `docs/V4_3A_EXECUTION.md`: V4.3A Creator Portal, unified positions, release readiness and reproducibility audit
- `docs/V4_2A_DCL_FEASIBILITY.md`, `docs/V4_2A_EXECUTION.md`: V4.2A Rhea DCL / Nearly audit (interfaces measured on the real wasm, taxes, ownership, 3 real pools), TreasuryDCL local adapter and its sandbox run
- `docs/V4_1B_EXECUTION.md`: V4.1B dashboard integration, TreasuryV4 interface audit, Position Manager, public validation plan
- `docs/V4_1_ARCHITECTURE.md`, `docs/V4_1_EXECUTION.md`: V4.1 Classic memecoin pilot (TreasuryV4, sandbox token), local validation and the deployment plan awaiting approval
- `docs/V4_0_EXECUTION.md`: V4.0 Pool Explorer (dashboard `#/pools`, read-only). Verified Ref/RHEA memecoin pools with live checks; only the pilot pool 2951 is fundable by the deployed Treasury, everything else is observe only, with the reasons
- `docs/SOL2NEAR_V3_Specification_Projet_Complete.md`: product, economics, scope
- `docs/SOL2NEAR_V3_Workflow_Equipe_Prompt_B1.md`: team workflow
- `docs/FEASIBILITY.md`: verified facts, hypotheses, blockers, plan B
- `docs/ARCHITECTURE.md`: Treasury design
- `CHECKPOINT.md`: current checkpoint report

## License

MIT, see `LICENSE`.
