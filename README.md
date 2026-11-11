# SOL2NEAR

> **SOL2NEAR turns Solana memecoin creator revenue into verifiable, programmable liquidity on NEAR.**
>
> ⚠️ **TESTNET DEMO ONLY** — Solana Devnet → Tidepool (community 1Click-compatible sandbox) → NEAR Testnet.
> Test tokens have no value. Never send real funds.

NEAR Hackathon 2026 — track *Memecoins With Mechanics*.

## Status (2026-11-11, checkpoint A1 in progress)

| Piece | State |
|---|---|
| Feasibility study | ✅ `docs/FEASIBILITY.md` — verdict **GO-WITH-FALLBACK** |
| Treasury contract (Rust) | ✅ implemented + 33 unit tests passing — **not deployed** |
| Real LP on Ref testnet | ⏳ manual gate G2 pending (`scripts/testnet-bootstrap.md`) |
| Cross-chain package | ⏳ teammate, branch `feat/crosschain` |
| FUEL, frontend | ⏳ checkpoint 2 |

Nothing in this repository is presented as working on-chain until a transaction hash proves it.

## Repository

```
apps/web/              frontend (lead, checkpoint 2)
contracts/treasury/    Treasury: USDC intake, 90/8/2, Ref LP pipeline, Proof of Liquidity (lead)
contracts/fuel/        FUEL NEP-141 fixed supply (lead, checkpoint 2)
packages/shared/       shared constants + TypeScript interfaces (lead ⇄ teammate)
packages/crosschain/   Tidepool / Solana Devnet module (teammate)
docs/                  spec V3, workflow, feasibility, architecture, crosschain docs
scripts/               testnet runbooks (manual, approval required)
tests/                 end-to-end (checkpoint 2)
```

## Quick check for judges (do X, see Y)

1. `cargo test -p sol2near-treasury` → see `33 passed` (on Windows, see `docs/ARCHITECTURE.md` §7 for the CMake env).
2. Read `docs/ARCHITECTURE.md` §2 → the deposit state machine, every async failure path.
3. Live testnet steps and transaction hashes will be listed here once executed.

## Key docs

- `docs/SOL2NEAR_V3_Specification_Projet_Complete.md` — product, economics, scope
- `docs/SOL2NEAR_V3_Workflow_Equipe_Prompt_B1.md` — team workflow and teammate prompt
- `docs/FEASIBILITY.md` — verified facts, hypotheses, blockers, plan B
- `docs/ARCHITECTURE.md` — Treasury design
- `CHECKPOINT.md` — current checkpoint report
