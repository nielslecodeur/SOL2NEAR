# CHECKPOINT A1 — Core protocol (lead)

Date: 2026-11-11 (evening, UTC+1). Status: **IN PROGRESS — code done, on-chain gates pending**.

## Done

- Monorepo skeleton (pnpm workspaces + Cargo workspace), ownership boundaries per workflow V3.
- `contracts/treasury` (near-sdk 5.30.1):
  - NEP-141 intake restricted to `usdc.tidepool-sandbox.testnet`, msg `{"action":"deposit"}`, min deposit;
    everything else refunded.
  - 90/8/2 split in atomic units, residue to community, total conserved.
  - LP pipeline Ref: deposit → partial swap → add_liquidity → on-chain verification
    (get_pool_shares + get_deposits), persisted stages, resumable, single in-flight job,
    replay-safe callbacks, timeout `reconcile` from on-chain balances.
  - Creator-owned LP: shares held by Treasury, locked until `unlock_at`, `withdraw_lp` (mft_transfer)
    by the creator only; `withdraw_reserve` with re-credit on failure.
  - Proof of Liquidity snapshot + `EVENT_JSON` events (namespace `sol2near`).
  - No admin, immutable config.
- **Tests: 33 unit tests passing** (`cargo test -p sol2near-treasury`), covering spec V3 §8 table:
  single credit, spoofed deposit, wrong token, rounding, unauthorised withdrawal, failed AMM call,
  replayed callback, unconfirmed LP proof, lock not finished, reserve bounds.
- wasm builds: 302 KB stripped (raw `cargo build`, not cargo-near).
- `packages/shared`: verified asset constants + proposed `CrosschainClient` interface (typechecks).
- Testnet accounts: `sol2near-dev.testnet` (≈5 NEAR), `treasury.sol2near-dev.testnet` (5 NEAR).
- near-cli-rs 0.31.1 installed.

## Not done / blocked

| Item | Blocker | Next action |
|---|---|---|
| cargo-near | Windows: OpenSSL build needs Strawberry Perl; WSL: clock 140 s behind breaks `make` | lead runs the sudo clock fix, then rebuild in WSL |
| G2 real LP on Ref | Tidepool faucet needs account ≥ 3 h (≈23:20 UTC) | run `scripts/testnet-bootstrap.md` with approval |
| H3/H4/H5/H11 (Ref storage costs, swap deposit) | Ref source unavailable (repo 404) | measured during G2 |
| H8 wasm accepted by nearcore | needs a deploy | after G2, with approval |
| Treasury deploy + setup | depends on G2 pool id | approval required |

## Interface for the teammate

`packages/shared/src/crosschain.ts` — to validate quickly; the frontend will only use it.
Important verified fact: Tidepool delivers on NEAR with a plain `ft_transfer`, so `nearRecipient`
must be the user's account (Treasury cannot attribute a plain transfer).
