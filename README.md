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
| Web dashboard (Dashboard / Vault / Reactor) | ✅ builds; live mode reads testnet; demo mode bannered SIMULATED | `pnpm --filter @sol2near/web build` |
| Tidepool route Solana Devnet → NEAR testnet | ⚠️ quote only | dry quote, 2026-11-11 (`docs/FEASIBILITY.md` T6) |
| Treasury / FUEL deployed on testnet | ❌ not yet | — |
| Ref pool + LP shares held by Treasury | ❌ not yet | — |
| Proof of Liquidity / FUEL admission on-chain | ❌ not yet | — |
| Cross-chain package | ⏳ teammate (SIMULATED adapter in the UI meanwhile) | `packages/crosschain` |

A feature is only marked ✅ once a transaction hash or a reproducible command output backs it. **Unit tests use a mocked NEAR VM: they prove contract rules, not the live Ref / Tidepool integration.** Missing pieces are tracked in `docs/CHECKPOINT_A2.md`.

## Try it — action → expected result

Prerequisites: Rust stable (tested with 1.98) with the `wasm32-unknown-unknown` target, Node ≥ 20 and pnpm 10. For the wasm build: cargo-near (Linux/WSL).

| # | Command | Expected result | How to verify |
|---|---|---|---|
| 1 | `git clone https://github.com/nielslecodeur/SOL2NEAR && cd SOL2NEAR` | repo checked out | `LICENSE` (MIT) present |
| 2 | `cargo test --workspace` (on Windows, set the CMake env from `docs/ARCHITECTURE.md` §7 first) | `34 passed` (treasury) and `31 passed` (fuel) | test names map to the rules in `docs/FUEL_REACTOR.md` §2–4 |
| 3 | `cargo test -p sol2near-fuel demo_walkthrough -- --nocapture` | 6 numbered steps: position admitted with its Ref/Treasury proof, a non-backed one refused, season progress, `close_season` → Success/level 1, claim paid, **second claim REJECTED** | output says "MOCKED NEAR VM (not testnet)" |
| 4 | `bash scripts/build-wasm.sh` (Linux/WSL, cargo-near) | `Contract successfully built!` twice | sizes and SHA-256 printed. The FUEL ABI has no mint method |
| 5 | `pnpm install && pnpm typecheck && pnpm test:ts && pnpm --filter @sol2near/web test` | all `fail 0` | the near-client test reproduces a live Ref `get_return` exactly |
| 6 | `pnpm --filter @sol2near/web dev` and open the URL | dashboard with a TESTNET badge. Live mode says the contracts are not deployed yet. Switch to `SIMULATED / DEMO DATA` to see every screen | a striped SIMULATED banner is on every demo screen |
| 7 | `node scripts/probes/verify-testnet.mjs` (read-only, no keys) | `PASS` lines for Tidepool health, tokens, a **dry** quote (fee read from the quote), Ref `state=Running`, then `all checks passed` | `INFO` lines list what is not deployed yet |

On-chain steps (pool creation, Treasury deploy, full cycle) will be added here **with their transaction hashes** once executed. Until then they are not claimed.

## Repository

```
apps/web/              read-only dashboard: Dashboard, Vault detail, FUEL Reactor (lead)
contracts/treasury/    Treasury: USDC intake, 90/8/2, Ref LP pipeline, Proof of Liquidity (lead)
contracts/fuel/        FUEL: fixed-supply NEP-141 + Reactor seasons gated by Ref-verified LP (lead)
packages/near-client/  LP plan from live Ref views (lead)
packages/shared/       shared constants + TypeScript interfaces (lead ⇄ teammate)
packages/crosschain/   Tidepool / Solana Devnet module (teammate)
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
- **Libraries:** `near-sdk` 5.30.1 and `near-contract-standards` 5.30.1 (the NEP-141/145 implementation used by FUEL), React 18.3.1 and Vite 5.4.11 (web, no wallet library). Dev and build tools: cargo-near 0.22.0 (runs wasm-opt), near-cli-rs 0.31.1, TypeScript 5.6.3, @vitejs/plugin-react 4.3.4, @types/node 22.10.2, pnpm 10, Node's built-in test runner.
- **External services:** Tidepool (community testnet sandbox, `www.usetidepool.tech`), Ref/Rhea exchange testnet `ref-finance-101.testnet`, NEAR testnet RPC.
- **Templates / boilerplate:** none.
- **AI assistance:** code and documentation were written with **Claude Code (Anthropic)** under the direction of the team, then reviewed and tested by the team. The teammate's module declares its own tooling in `docs/crosschain/CROSSCHAIN_HANDOFF.md`.

## Key docs

- `docs/HACKATHON_CHECKLIST.md`: official rules mapped to this project, with the final pre-submission check
- `docs/SOL2NEAR_V3_Specification_Projet_Complete.md`: product, economics, scope
- `docs/SOL2NEAR_V3_Workflow_Equipe_Prompt_B1.md`: team workflow
- `docs/FEASIBILITY.md`: verified facts, hypotheses, blockers, plan B
- `docs/ARCHITECTURE.md`: Treasury design
- `CHECKPOINT.md`: current checkpoint report

## License

MIT, see `LICENSE`.
