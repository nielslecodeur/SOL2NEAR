# CHECKPOINT A1 — Core protocol (lead)

Last update: 2026-11-11 21:40 UTC. Status: **READY WITH LIMITATIONS — code, tests and official
build done; nothing deployed; real Ref/Rhea LP not yet proven on-chain.**

## 1. Verified results

| Check | Result |
|---|---|
| WSL clock vs external time (Cloudflare `ts`) | WSL **+0.4 s** ✅ (was −140 s). Windows host is −6 s (no impact on WSL builds) |
| `cargo test -p sol2near-treasury` (Windows) | **33 passed, 0 failed** (4 ledger + 29 contract) |
| `cargo near build non-reproducible-wasm` (WSL, cargo-near **0.22.0**) | ✅ `target/near/treasury/sol2near_treasury.wasm` **248.9 KB**, SHA-256 `35e9a79a3cd0532298196bffffe73266242cd59b4299ff845fa6163c4e9a8168`, embedded ABI (26 functions; 10 callbacks `private`; `setup` / `withdraw_lp` / `withdraw_reserve` `payable`) |
| `packages/shared` typecheck | ✅ |
| `packages/near-client` (LP plan from live Ref views) | ✅ `pass 6, fail 0`; swap formula reproduces live `get_return` exactly (9418312462); add-liquidity minimums come from the live `predict_add_simple_liquidity` view (a local formula was 0.01 % off) |
| `node scripts/probes/verify-testnet.mjs` (read-only) | ✅ `all checks passed` (2026-11-11 ~22:00 UTC): Tidepool testnet + Solana route ok, dry quote 1 USDC → 0.9974 (cost 2600 atomic, read from the quote), Ref v1.9.19 Running; Treasury not deployed, no pool yet |
| Hackathon rules | ✅ `docs/HACKATHON_CHECKLIST.md` (live HACKATHON.md read), `LICENSE` MIT, README disclosures, `CLAUDE.md` |
| Git identity | ✅ local commits rewritten as `nielslecodeur <188048354+nielslecodeur@users.noreply.github.com>` (repo-local config); initial commit `ec13f38` on GitHub still shows the placeholder |
| Testnet accounts | `sol2near-dev.testnet` (~5 NEAR), `treasury.sol2near-dev.testnet` (5 NEAR, no code) |
| On-chain transactions by SOL2NEAR | only the 2 account creations (`6rTeGov…82wB`, `bi1cErW…eCma`) |

### cargo-near: root cause analysis

1. Windows `cargo install cargo-near`: `openssl-src` needs a full Perl (`perl` absent; Git's msys perl lacks `IPC::Cmd`).
2. WSL, before the fix: OpenSSL configured, then `make depend` looped — `configdata.pm has modification time 138 s in the future` (WSL clock −140 s).
3. WSL, after the fix: OpenSSL builds; **new failure** in `hidapi v2.6.6` (Ledger support, default feature `ledger` of cargo-near 0.23.0) — `pkg-config` and `libudev` are not installed.
4. Resolution: a working **cargo-near 0.22.0** binary was already present in WSL (`~/.local/bin/cargo-near`, installed 2026-11-02) and builds the contract. 0.23.0 can be built without sudo via `cargo install --locked cargo-near --no-default-features` (no Ledger) if ever needed; not required now.

## 2. Implemented (A1)

- Monorepo skeleton (pnpm + Cargo workspaces), ownership boundaries per workflow V3.
- `contracts/treasury` (near-sdk 5.30.1): USDC-only NEP-141 intake, 90/8/2 split, resumable Ref LP
  pipeline (deposit → partial swap → add_liquidity → on-chain verification), single in-flight job,
  replay-safe callbacks, timeout `reconcile`, creator-owned locked LP + `withdraw_lp`,
  `withdraw_reserve`, Proof of Liquidity snapshot and `EVENT_JSON` events, no admin.
- `packages/shared`: verified constants + proposed `CrosschainClient` interface.
- Docs: `docs/FEASIBILITY.md`, `docs/ARCHITECTURE.md`, `scripts/testnet-bootstrap.md` (not executed).

## 3. Still missing — Rhea/Ref integration and LP

| # | Missing | Why / dependency | Gate |
|---|---|---|---|
| M1 | **No Ref pool USDC(tp)/wNEAR(tp) exists** — must be created (`add_simple_pool`) and seeded | needs Tidepool NEAR faucet tokens (account ≥ 3 h → from ~23:20 UTC) + your approval to sign | G2 |
| M2 | Real costs of `add_simple_pool` (H3) and `add_liquidity` storage (H4) unknown | Ref source repo is 404; only guards probed | G2 |
| M3 | Refund on unregistered deposit (H5) and 1-yocto on `swap` (H11) unproven | same | G2 |
| M4 | **No LP share has ever been minted or read for SOL2NEAR** | depends on M1 | G2 |
| M5 | Treasury not deployed; `setup()` (storage + `register_tokens` + pool check) never run | needs pool id from M1 + approval | G3 |
| M6 | wasm acceptance by nearcore testnet (H8) — official build OK, deploy not done | deploy | G3 |
| M7 | Full on-chain cycle deposit → LP → `verify_liquidity` never executed | M5 | G3 |
| M8 | Integration tests against real Ref (near-workspaces import of `ref-finance-101.testnet`) | not written | G3 |
| M9 | FUEL contract, frontend, community-vault rules, dust withdrawal | checkpoint 2 | — |
| M10 | Cross-chain package | teammate (`feat/crosschain`) | B1 |

Until M4/M7 have transaction hashes, the README and demo must state that **LP integration is unproven**.

## 4. Next actions (each signing step needs your explicit approval)

1. Claim Tidepool NEAR faucet for `sol2near-dev.testnet` (site, ≥ 23:20 UTC).
2. Run `scripts/testnet-bootstrap.md` §1–§5 (≈0.21 NEAR) → pool id, shares, H3/H4/H5/H11.
3. Adjust the contract if H4/H11 differ, re-run tests, then deploy + `setup` (§6).
