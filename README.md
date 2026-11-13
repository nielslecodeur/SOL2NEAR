# SOL2NEAR

> **SOL2NEAR turns Solana memecoin creator revenue into verifiable, programmable liquidity on NEAR.**
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

## Status — what is proven and what is not

| Feature | Status | Proof |
|---|---|---|
| Treasury logic (split, state machine, guards, replay safety) | ✅ unit-tested (mocked VM) | `cargo test -p sol2near-treasury` → 34 passed |
| FUEL token + Reactor (fixed supply, Proof of Liquidity, seasons, burn, claims, vesting) | ✅ unit-tested (mocked VM) | `cargo test -p sol2near-fuel` → 31 passed |
| Official wasm builds | ✅ | `scripts/build-wasm.sh` (cargo-near 0.22.0): Treasury 250.3 KB `73b99075…520e`, FUEL 256.8 KB `a33678f6…bbac` |
| NEAR wallet in the dashboard (Wallet Selector 10.1.4, testnet only): Treasury deposit, execute_lp, FUEL register / claim, each verified from the final outcome + contract state | ⚠️ built, unit-tested (41) and **validated in real Chrome** (12 Playwright tests: real Wallet Selector modal + testnet reads; deposit flow with a mocked wallet); ✅ **full path signed from the dashboard with a real wallet** (Meteor, `lowarena9362.testnet`): deposit → execute_lp → register_position → close_season (SUCCESS) → claim, every step verified on-chain (rows G6-* below) | `docs/G4_NEAR_WALLET.md`, `docs/G5_BROWSER_VALIDATION.md`, `docs/G6_LIVE_WALLET_E2E.md` |
| Web dashboard (Dashboard / Vault / Reactor) | ✅ builds; live mode reads testnet; demo mode bannered SIMULATED | `pnpm --filter @sol2near/web build` |
| Tidepool route Solana Devnet → NEAR testnet | ⚠️ quote only | dry quote, 2026-11-11 (`docs/FEASIBILITY.md` T6) |
| Treasury / FUEL deployed on testnet | ✅ `treasury.sol2near-dev.testnet`, `fuel.sol2near-dev.testnet` | B1 `HJTW4c6u…yUpY`, B4 `JBdFrx2j…rbBP` (see below) |
| Ref pool + LP shares held by Treasury | ✅ pool **2951**, Treasury holds 165 640 253 516 145 704 019 022 shares | C2 `4F2wXqzm…SSHA`, C3 `verify_liquidity` ok |
| Proof of Liquidity / FUEL admission on-chain | ✅ full cycle: admission → season close → single claim | C4–C7 (see below) |
| Cross-chain package (Tidepool client + Solana deposit tx) | ⚠️ unit-tested with mocks (quote echo checks, Solana confirmation, NEAR receipt check, reload-safe); wired into the live dashboard; **no live transfer yet**: our network's firewall sinkholes `usetidepool.tech` | `pnpm --filter @sol2near/crosschain test` → 34 passed · `docs/crosschain/CROSSCHAIN_HANDOFF.md` |

A feature is only marked ✅ once a transaction hash or a reproducible command output backs it. **Unit tests use a mocked NEAR VM: they prove contract rules, not the live Ref / Tidepool integration.** Missing pieces are tracked in `docs/CHECKPOINT_A2.md`.

## Try it — action → expected result

Prerequisites: Rust stable (tested with 1.98) with the `wasm32-unknown-unknown` target, Node ≥ 20 and pnpm 10. For the wasm build: cargo-near (Linux/WSL).

| # | Command | Expected result | How to verify |
|---|---|---|---|
| 1 | `git clone https://github.com/nielslecodeur/SOL2NEAR && cd SOL2NEAR` | repo checked out | `LICENSE` (MIT) present |
| 2 | `cargo test --workspace` (on Windows, set the CMake env from `docs/ARCHITECTURE.md` §7 first) | `34 passed` (treasury) and `31 passed` (fuel) | test names map to the rules in `docs/FUEL_REACTOR.md` §2–4 |
| 3 | `cargo test -p sol2near-fuel demo_walkthrough -- --nocapture` | 6 numbered steps: position admitted with its Ref/Treasury proof, a non-backed one refused, season progress, `close_season` → Success/level 1, claim paid, **second claim REJECTED** | output says "MOCKED NEAR VM (not testnet)" |
| 4 | `bash scripts/build-wasm.sh` (Linux/WSL, cargo-near) | `Contract successfully built!` twice | sizes and SHA-256 printed. The FUEL ABI has no mint method |
| 5 | `pnpm install && pnpm typecheck && pnpm test:ts && pnpm --filter @sol2near/web test` | all `fail 0`: near-client 6, crosschain 35, web 41. Browser: `pnpm --filter @sol2near/web e2e` (local Google Chrome via Playwright) → 12 passed | the near-client test reproduces a live Ref `get_return` exactly; crosschain tests are **mocked** (Tidepool + Solana RPC) |
| 6 | `pnpm --filter @sol2near/web dev`, open the URL, type `sol2near-dev.testnet` in *Creator account*, click **Load** | live testnet data: 20 USDC received, split 18 / 1.6 / 0.4, 0.1656 LP shares **BACKED ON REF**, deposit #0 `LP CONFIRMED`, FUEL `Claimed`; the FUEL Reactor tab shows season 0 Success. The cross-chain card shows Tidepool's live health | `SIMULATED / DEMO DATA` mode shows every screen with a striped SIMULATED banner |
| 7 | `node scripts/probes/verify-testnet.mjs` (read-only, no keys) | `PASS` for Ref `state=Running`, pool 2951, LP shares held by the dev account **and the Treasury**, FUEL supply 1 000 000, season 0 Success, position 0 claimed once; `PASS` for Tidepool health, tokens and a **dry** quote when the sandbox is reachable | Tidepool is a community service with no SLA: on a network that filters its domain the 3 Tidepool checks print `FAIL … fetch failed`; on 2026-11-13 from an unfiltered network the probe printed `all checks passed` (Tidepool, Ref, Treasury LP, FUEL) |

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

Pool 2951 is shallow (≈ 100 USD of test liquidity), so the zap price is worse than the Tidepool quote. This is a demo-pool effect. The Solana Devnet → NEAR leg via Tidepool is still quote-only: the client exists (`packages/crosschain`) but no live transfer has run yet.

## Repository

```
apps/web/              read-only dashboard: Dashboard, Vault detail, FUEL Reactor (lead)
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
- **External services:** Tidepool (community testnet sandbox, `www.usetidepool.tech`), Ref/Rhea exchange testnet `ref-finance-101.testnet`, NEAR testnet RPC.
- **Templates / boilerplate:** none.
- **AI assistance:** code and documentation were written with **Claude Code (Anthropic)** under the direction of the author (solo project), then reviewed and tested by the author. This includes the cross-chain package.

## Key docs

- `docs/HACKATHON_CHECKLIST.md`: official rules mapped to this project, with the final pre-submission check
- `docs/SOL2NEAR_V3_Specification_Projet_Complete.md`: product, economics, scope
- `docs/SOL2NEAR_V3_Workflow_Equipe_Prompt_B1.md`: team workflow
- `docs/FEASIBILITY.md`: verified facts, hypotheses, blockers, plan B
- `docs/ARCHITECTURE.md`: Treasury design
- `CHECKPOINT.md`: current checkpoint report

## License

MIT, see `LICENSE`.
