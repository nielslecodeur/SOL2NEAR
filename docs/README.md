# SOL2NEAR documentation map

Start with the [project README](../README.md). Every document below says which kind of evidence it relies on:
**on-chain testnet/devnet**, **local sandbox** (real contract code, local state), **mainnet read-only**, or **unit test**.
They are never merged.

## For a reviewer (start here)

| Document | What it is for |
|---|---|
| [JUDGE_QUICKSTART.md](JUDGE_QUICKSTART.md) | Reproduce everything without a key, funds or a public transaction |
| [HACKATHON_MEMECOIN_PROOF.md](HACKATHON_MEMECOIN_PROOF.md) | What the NEARLY memecoin demo proves, and on which evidence |
| [G8_PROOF_LEDGER.md](G8_PROOF_LEDGER.md) | Every testnet / devnet transaction hash, re-verifiable read-only |
| [G9_INDEPENDENT_AUDIT.md](G9_INDEPENDENT_AUDIT.md) · [G9_PUBLIC_REVIEW_CHECKLIST.md](G9_PUBLIC_REVIEW_CHECKLIST.md) | Security / release audit simulation and the review checklist |
| [H6_UI_UX_RELEASE.md](H6_UI_UX_RELEASE.md) | The current product interface: navigation, screens, tests |

## Product

| Document | Content |
|---|---|
| [SOL2NEAR_V3_Specification_Projet_Complete.md](SOL2NEAR_V3_Specification_Projet_Complete.md) | Original product and economics specification (French) |
| [SOL2NEAR_V4_Memecoin_Liquidity_Router.md](SOL2NEAR_V4_Memecoin_Liquidity_Router.md) | V4 direction: memecoin liquidity router (French) |
| [V4_3A_CREATOR_PORTAL.md](V4_3A_CREATOR_PORTAL.md) | Creator journey design (now the testnet console + Explore) |
| [FUEL_REACTOR.md](FUEL_REACTOR.md) | FUEL token and Reactor season rules |
| [HACKATHON_CHECKLIST.md](HACKATHON_CHECKLIST.md) | Hackathon rules mapped to the workflow (French) |

## Architecture and contracts

| Document | Content |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | V3 Treasury state machine, invariants, Windows build notes |
| [V4_1_ARCHITECTURE.md](V4_1_ARCHITECTURE.md) | TreasuryV4 Classic pilot (local sandbox only) |
| [V4_2A_DCL_FEASIBILITY.md](V4_2A_DCL_FEASIBILITY.md) | Rhea DCL / Nearly audit and the TreasuryDCL design (local sandbox only) |
| [FEASIBILITY.md](FEASIBILITY.md) | Verified facts vs hypotheses (H1–H11) |
| [crosschain/](crosschain/README.md) | Solana devnet → NEAR testnet client (Tidepool, a community sandbox — not NEAR Intents) |

Code: `contracts/treasury` (V3, deployed on testnet), `contracts/fuel` (deployed on testnet), `contracts/treasury-v4`,
`contracts/treasury-dcl` and `contracts/sandbox-meme` (local sandbox only, not deployed).

## Tests and sandboxes

| Where | What |
|---|---|
| `contracts/*/src/tests.rs` | Rust unit tests (`cargo test --workspace`) |
| `sandbox-tests/` | near-workspaces runs against the real Ref, Rhea DCL, NEARLY token and Tidepool USDC code (`bash sandbox-tests/run.sh`) |
| `packages/*/src/*.test.ts`, `apps/web/src/*.test.ts` | TypeScript unit tests |
| `apps/web/e2e/` | Playwright: `offline` (deterministic, every public endpoint blocked) and `live` (public endpoints) |
| `scripts/check-release.mjs`, `scripts/check-public-bundle.mjs`, `scripts/check-doc-links.mjs` | Release, public read-only bundle and documentation link checks |

## Proofs

| Kind | Document / command |
|---|---|
| On-chain, NEAR testnet (deploy, deposit, LP, FUEL) | [G2_EXECUTION.md](G2_EXECUTION.md), [G6_LIVE_WALLET_E2E.md](G6_LIVE_WALLET_E2E.md) |
| On-chain, Solana devnet → NEAR testnet bridge | [G7_CROSSCHAIN_LIVE.md](G7_CROSSCHAIN_LIVE.md) |
| Not completed: one end-to-end operation (G8) | [G8_FINAL_EXECUTION.md](G8_FINAL_EXECUTION.md) |
| Local sandbox, NEARLY on Rhea DCL (58 steps) | `bash scripts/proofs/nearly-proof.sh` → `packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json` |
| Local sandbox logs | [v4/sandbox-run.log](v4/sandbox-run.log), [v4/v42-dcl-sandbox-run.log](v4/v42-dcl-sandbox-run.log) |
| Mainnet read-only quote (pinned block) | `node scripts/probes/nearly-reference-sim.mjs` → `packages/near-client/src/fixtures/nearly_reference_sim.json` |

## Archive

[archive/](archive/README.md) keeps the reports of earlier checkpoints (A1, A2, G2 readiness, G4, G5, V4.0–V4.3A execution
logs, G9.1 deployment record, release audits). They are kept unchanged as history; where they describe the interface or
the status, the documents above are more recent.
