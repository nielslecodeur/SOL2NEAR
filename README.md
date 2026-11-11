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
4. (checkpoint 2) unlocks **FUEL**, a fixed-supply NEP-141, only for verified LP — the mechanic, not the chart.

The rules (split, lock, token ids, pool) are fixed at deployment, and nobody holds an admin key over them.

## Status — what is proven and what is not

| Feature | Status | Proof |
|---|---|---|
| Treasury logic (split, state machine, guards, replay safety) | ✅ unit-tested | `cargo test` → 33 passed |
| Official wasm build | ✅ | cargo-near 0.22.0, SHA-256 `35e9a79a3cd0532298196bffffe73266242cd59b4299ff845fa6163c4e9a8168` |
| Tidepool route Solana Devnet → NEAR testnet | ⚠️ quote only | dry quote, 2026-11-11 (`docs/FEASIBILITY.md` T6) |
| Treasury deployed on testnet | ❌ not yet | — |
| Ref pool + LP shares held by Treasury | ❌ not yet | — |
| Proof of Liquidity on-chain | ❌ not yet | — |
| FUEL, frontend | ❌ checkpoint 2 | — |
| Cross-chain package | ⏳ teammate | `packages/crosschain` |

A feature is only marked ✅ once a transaction hash or a reproducible command output backs it. Missing pieces are tracked in `CHECKPOINT.md`.

## Try it — action → expected result

Prerequisites: Rust stable (tested with 1.98) with the `wasm32-unknown-unknown` target, Node ≥ 20 and pnpm 10. For the wasm build: cargo-near (Linux/WSL).

| # | Action | Expected result |
|---|---|---|
| 1 | `git clone https://github.com/nielslecodeur/SOL2NEAR && cd SOL2NEAR` | repo checked out, `LICENSE` (MIT) present |
| 2 | `cargo test -p sol2near-treasury` (on Windows, set the CMake env from `docs/ARCHITECTURE.md` §7 first) | `test result: ok. 33 passed; 0 failed` |
| 3 | `cd contracts/treasury && cargo near build non-reproducible-wasm` | `Contract successfully built!` + wasm ≈ 249 KB with embedded ABI |
| 4 | `pnpm install && pnpm --filter @sol2near/shared typecheck` | exits 0, no errors |
| 5 | `pnpm --filter @sol2near/near-client test` | `pass 6, fail 0`. The first test reproduces a live Ref `get_return` value exactly |
| 6 | `node scripts/probes/verify-testnet.mjs` (read-only, no keys) | `PASS` lines for Tidepool health, tokens, a **dry** quote (fee read from the quote), and Ref `state=Running`, ending with `all checks passed`. `INFO` lines show what is not deployed yet |
| 7 | Read `docs/ARCHITECTURE.md` §2 | the deposit state machine, including every async failure path |

On-chain steps (pool creation, Treasury deploy, full cycle) will be added here **with their transaction hashes** once executed. Until then they are not claimed.

## Repository

```
apps/web/              frontend (lead, checkpoint 2)
contracts/treasury/    Treasury: USDC intake, 90/8/2, Ref LP pipeline, Proof of Liquidity (lead)
contracts/fuel/        FUEL NEP-141 fixed supply (lead, checkpoint 2)
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
- **Libraries:** `near-sdk` 5.30.1 (Rust). Dev and build tools: cargo-near 0.22.0 (runs wasm-opt), near-cli-rs 0.31.1, TypeScript 5.6.3, @types/node 22.10.2, pnpm 10. Node's built-in test runner. No runtime npm dependency.
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
