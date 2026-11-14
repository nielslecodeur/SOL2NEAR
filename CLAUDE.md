# SOL2NEAR — instructions for coding agents

NEAR Hackathon 2026 (tracks `memecoins` + `defi`), deadline **2026-11-14T23:59:00Z**.
Solo project since 2026-11-13: the lead owns everything, including `packages/crosschain` and `docs/crosschain` (planned teammate did not join).

## Hard rules
- **TESTNET / DEVNET ONLY.** No mainnet, no real funds, never handle or print private keys / seed phrases.
- **No deploy, on-chain transaction, push, making repo public, X post or hackathon submission without the lead's explicit approval** for that specific action.
- Never invent an API, a pool, a transaction or a proof. A feature is "working" only with a transaction hash or a reproducible command output.
- Fees always come from real quotes (Tidepool `/v0/quote`, Ref `get_return` / `predict_add_simple_liquidity`), never hard-coded.
- Tidepool is a **community sandbox**, not official NEAR Intents — say so wherever it appears.

## Required reading
- **`docs/HACKATHON_CHECKLIST.md`** — official rules (https://nearhackathon.com/HACKATHON.md) mapped to our workflow, including the **final rules check before submission**. Re-read the live rules before submitting.
- `docs/SOL2NEAR_V3_Specification_Projet_Complete.md` — product and economics.
- `docs/archive/SOL2NEAR_V3_Workflow_Equipe_Prompt_B1.md` — team workflow, branches, handoff.
- `docs/FEASIBILITY.md` — verified facts vs hypotheses (H1–H11), blockers.
- `docs/ARCHITECTURE.md` — Treasury state machine and invariants.
- `docs/README.md` — map of the documentation (product, architecture, contracts, tests, proofs, archive).
- `docs/archive/CHECKPOINT_A1.md` — historical status of checkpoint A1 (archived).
- `docs/archive/G2_READINESS.md` — verified Ref audit and the G2 transaction batches (executed: `docs/G2_EXECUTION.md`).

## Commands
```powershell
# Treasury unit tests (Windows)
$vs = "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake"
$env:PATH = "$vs\CMake\bin;$vs\Ninja;$env:PATH"; $env:AWS_LC_SYS_NO_ASM = "1"
cargo test --workspace                      # Treasury + FUEL

# Official wasm builds (WSL, cargo-near 0.22.0)
wsl -d Ubuntu -- bash scripts/build-wasm.sh

# TypeScript
pnpm typecheck; pnpm test:ts;   # near-client + crosschain (mocked)
pnpm --filter @sol2near/crosschain live:dry   # read-only Tidepool check
 pnpm --filter @sol2near/web test; pnpm --filter @sol2near/web build
```
FUEL rules: `docs/FUEL_REACTOR.md`. Current status: `README.md`; history in `docs/archive/`.
