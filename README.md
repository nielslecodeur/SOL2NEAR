# SOL2NEAR

**Fuel memecoin liquidity across chains.** SOL2NEAR lets Solana memecoin creators route USDC they control into a
liquidity position on NEAR that anyone can verify: who holds it, what it earned, how it exits.

**Live demo → https://sol2near-demo.vercel.app** · read-only: the site has no wallet and no signing code, and cannot
send a transaction. Test networks only; test tokens have no value.

> The site serves commit `3cbf7d8` (H6), built from a clean clone with the public read-only build and its checks.

![SOL2NEAR home page](docs/h6/after-home-1440.jpg)

NEAR Hackathon 2026 · tracks **`memecoins`** and **`defi`** · solo project · MIT.

## What is SOL2NEAR?

Memecoin creators earn fees on Solana, but that money rarely becomes lasting, transparent liquidity elsewhere.
SOL2NEAR is a **liquidity router**, not a bridge, a launchpad or an exchange:

1. the creator sends USDC from Solana (by hand: Pump.fun / Bags creator fees are **not** captured automatically);
2. a NEAR **Treasury** contract splits it **90 % liquidity · 8 % creator reserve · 2 % community**;
3. the liquidity budget becomes a pool position held for the creator, read back from the exchange, locked, and tracked
   with its fees and its exit.

It is for creators who want to give their community verifiable liquidity, and for anyone who wants to check it.

## Try it — do X, see Y

In the browser (no wallet, nothing to install):

| # | Do | See |
|---|---|---|
| 1 | Open https://sol2near-demo.vercel.app | "Fuel memecoin liquidity across chains." and the bar "Public read-only demo — … it cannot send any transaction" |
| 2 | Click **Explore the demo** | Step 1 **Choose**: NEARLY / wNEAR · Rhea DCL v2.4.2, "Mainnet pool · read-only", data "Snapshot · block 224535331", amount 100 USDC |
| 3 | Click **Next: Preview** | **Historical quote** · Mainnet block 224535331 · 2026-11-14 15:51 UTC · "Not an executable offer": 100 USDC → 90 USDC to liquidity → 91,662 NEARLY + 13.91 wNEAR, price impact 0.11 % |
| 4 | Click **Get a live indicative quote** | **Live indicative quote** with the current mainnet block (all views at that block). If a public RPC fails, the real error is shown and the historical quote stays |
| 5 | Click **Next: Proof**, then **View technical evidence** | "Local sandbox execution verified" with 4 checked facts, 58 steps, 3 / 3 contract code hashes = mainnet; the 58-row table. **proof** on row F1 shows `dcl_nft_token_owner: treasury-dcl.test.near` |
| 6 | Open **Proof** → **Technical view** | 16 testnet / devnet transaction hashes, each linking to its explorer (nearblocks testnet, Solana explorer devnet) |
| 7 | **Developers → Dashboard**, type `sol2near-dev.testnet` in *Creator account*, click **Load** | Live testnet reads: 20 USDC received, split 18 / 1.6 / 0.4, LP **BACKED ON REF**, FUEL `Claimed` |
| 8 | **Developers → FUEL Reactor** | Reactor level, current season, supply buckets and season history read from `fuel.sol2near-dev.testnet` |

On your machine (commands and expected output in [Quick start](#quick-start) and [Reproduce the proof](#reproduce-the-proof)):

| # | Do | See |
|---|---|---|
| 9 | `node scripts/probes/verify-testnet.mjs` and `node scripts/probes/verify-g6-g7.mjs` | `all checks passed`; `all G6/G7 proofs re-verified` (read-only RPC, no keys; Tidepool checks print `FAIL … fetch failed` on a network that filters its domain) |
| 10 | `cargo test -p sol2near-fuel demo_walkthrough -- --nocapture` | 6 numbered steps on a mocked NEAR VM: a position admitted with its Ref / Treasury proof, a non-backed one refused, season close → level up, claim paid, **second claim REJECTED** |
| 11 | `bash scripts/proofs/nearly-proof.sh` | `test result: ok. 1 passed`, 3 × `PASS … code = mainnet`, `PASS export identical … (58 steps)` |

## The memecoin mechanic: FUEL Reactor

FUEL is a fixed-supply NEP-141 memecoin (1 000 000, no mint method) that can only be **earned by locking verified
liquidity**: 1 FUEL per USDC actually in a Treasury LP position that Ref itself confirms (80 % to the creator, 20 % to a
community reserve, capped per vault). The community plays **seasons**: if the season's newly locked, verified liquidity
reaches its target, the Reactor levels up and rewards become claimable; if it misses, rewards return to the reserve, the
Reactor levels down and a small prefunded slice of FUEL (≤ 10) is **burned**. The price chart plays no part: every rule
reads on-chain LP state. On testnet: season 0 → Success, level 1; season 70 → Success, level 1 → 2; claims paid once,
second claim refused (C4–C7, G6-CLOSE, G6-CLAIM). Rules: [docs/FUEL_REACTOR.md](docs/FUEL_REACTOR.md).

## How it works

```
Solana (USDC) ──► Cross-chain transfer ──► NEAR Treasury (90/8/2) ──► Liquidity position
 Phantom           Tidepool *               no admin method            Ref pool (testnet)
                                                                       Rhea DCL / NEARLY (local sandbox)
```
\* Tidepool is a community 1Click-compatible **sandbox, not the official NEAR Intents** service (NEAR Intents has no
testnet). A production version would target the official 1Click API.

**Why NEAR (what the code actually relies on):**
- **The proof is checked by contracts, not by a server:** the Treasury reads Ref with asynchronous cross-contract calls
  (`get_pool_shares`, `get_deposits`) to confirm the LP it holds, and FUEL re-reads the Treasury and Ref before admitting
  a position. No oracle, no backend.
- **A destination for cross-chain capital:** NEAR Intents' 1Click API lets a Solana user deliver tokens to a NEAR
  account. SOL2NEAR uses Tidepool, a 1Click-compatible testnet sandbox, for that leg.
- **NEAR memecoin markets live on Ref / Rhea:** Classic pools, and DCL (concentrated-liquidity) pools where Nearly launches
  its tokens. TreasuryDCL holds a Rhea DCL position (a NEP-171 NFT) for the creator; today in a local sandbox.

## What is actually proven?

| Capability | Evidence | Where |
|---|---|---|
| Solana → NEAR bridge | **On-chain**, Solana devnet → NEAR testnet (2 USDC → 1.9948 USDC) | G7-SOL `bGUicpgy…887R`, G7-NEAR `J58H2uyu…RFqf` |
| Treasury V3, 90/8/2 split | **On-chain**, NEAR testnet, from the CLI and from the dashboard with a real wallet | C1, G6-D, G7-TREAS |
| Ref liquidity (pool #2951, USDC/wNEAR — a test pool, **not a memecoin**) | **On-chain**, NEAR testnet, shares verified against Ref | C2, C3, G6-LP |
| FUEL rewards | **On-chain**, NEAR testnet: admission, season close, one claim, second claim refused | C4–C7, G6-CLAIM |
| NEARLY position on Rhea DCL | **Local sandbox** running byte-identical mainnet code of the DCL and of the NEARLY token (58 steps) | `bash scripts/proofs/nearly-proof.sh` |
| NEARLY on mainnet | **Read-only** pool data and Rhea quotes. SOL2NEAR has never sent a mainnet transaction | `node scripts/probes/nearly-reference-sim.mjs` |

Every hash is in [docs/G8_PROOF_LEDGER.md](docs/G8_PROOF_LEDGER.md) and re-verified without keys by
`node scripts/probes/verify-testnet.mjs` and `node scripts/probes/verify-g6-g7.mjs`. The testnet path and the sandbox
path are two levels of evidence; they were never one transaction.

## Architecture

| Module | Role | Status |
|---|---|---|
| `contracts/treasury` | V3 Treasury: USDC intake, 90/8/2, Ref LP pipeline, Proof of Liquidity | deployed on testnet |
| `contracts/fuel` | FUEL: fixed-supply NEP-141 and Reactor seasons gated by Ref-verified liquidity | deployed on testnet |
| `contracts/treasury-dcl` | TreasuryDCL: Rhea DCL concentrated-liquidity positions (HotZap, fees, NFT exit) | local sandbox only |
| `contracts/treasury-v4`, `contracts/sandbox-meme` | Classic memecoin pilot and its test token | local sandbox only |
| `packages/crosschain` | Solana devnet → NEAR client (Tidepool quotes, unsigned SPL deposit, status) | used on devnet/testnet |
| `packages/near-client` | Plans from live exchange views, split rules, proof fixtures | — |
| `apps/web` | The site: product pages + developer tools; a public build without wallet code | — |
| `sandbox-tests` | near-workspaces runs against the real Ref, Rhea DCL, NEARLY and Tidepool USDC code | — |

Map of the documentation: [docs/README.md](docs/README.md).

## Quick start

Requirements: Node ≥ 22.18, pnpm 10 (`corepack enable`), Google Chrome for the browser tests, Rust stable with
`wasm32-unknown-unknown` for the contracts.

```bash
git clone https://github.com/nielslecodeur/SOL2NEAR && cd SOL2NEAR
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test:ts && pnpm --filter @sol2near/web test   # near-client 64, crosschain 36, web 48
pnpm --filter @sol2near/web dev                                      # the full app, signing only in your own testnet wallets
pnpm --filter @sol2near/web build:public && pnpm check:public        # the read-only public build → "public bundle is read-only"
pnpm --filter @sol2near/web e2e:offline                              # 20 browser tests, every public endpoint blocked
pnpm check:release && pnpm check:docs                                # no key material or personal path; every doc link resolves
cargo test --workspace                                               # 34 + 31 + 47 + 3 + 41
```
On Windows, `cargo test` needs the CMake environment of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §7 and a short
`CARGO_TARGET_DIR`.

## Reproduce the proof

```bash
bash scripts/proofs/nearly-proof.sh      # Linux, macOS or WSL: wsl -d Ubuntu -- bash scripts/proofs/nearly-proof.sh
```
Needs Rust with `wasm32-unknown-unknown` and `cargo install cargo-near --version 0.22.0 --locked`; near-workspaces
downloads the local neard itself. The script fetches the contract **code** of `dclv2.ref-labs.near`, `wrap.near` and
the NEARLY token with read-only `view_code` calls, builds TreasuryDCL, runs the scenario in a fresh local chain
(≈ 65 s) and compares the export with the committed one:
```
test result: ok. 1 passed
PASS dcl code = mainnet 3G34Nhjmir5JPYPtijaA9iCNnHDPR7h3wfC9H77woEGo
PASS nearly_token code = mainnet 5qScjXG9uRG82Yrh36XZNZgVUYiqPtuC9ep5DvV42eGQ
PASS export identical to the committed packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json (58 steps)
```
The run rewrites the timestamps of `packages/near-client/src/fixtures/v42_dcl_sandbox_views.json`; restore it with
`git checkout`. Step-by-step guide for reviewers: [docs/JUDGE_QUICKSTART.md](docs/JUDGE_QUICKSTART.md).

## Security and limitations

- **Unaudited contracts.** Ref and Rhea contracts are upgradeable by their DAOs.
- **No SOL2NEAR Treasury on mainnet**, no mainnet bridge, no funded NEARLY position. The NEARLY position exists only in
  a local sandbox.
- **Full-access keys** are still on the testnet contract accounts `treasury.sol2near-dev.testnet` and
  `fuel.sol2near-dev.testnet`: the contracts have no owner, admin method or setter, but the developer could redeploy
  them. The rules are enforced by the code, not yet locked at the account level.
- **G8 is not completed:** one operation reconciled end to end (Solana → Treasury → LP → FUEL). Deposit #3 holds the
  bridged USDC; its LP plan (29.13 % price impact on the shallow test pool) was not authorised.
  [docs/G8_FINAL_EXECUTION.md](docs/G8_FINAL_EXECUTION.md).
- **No V3 exit demonstrated:** `withdraw_lp` exists in code but was never exercised on-chain, and V3 cannot return an
  unused LP budget.
- **The public demo is read-only.** Quotes are historical or indicative, never executable offers.
- **No yield is promised.** Pool fees vary and can be zero; a concentrated position earns nothing outside its range, and
  a memecoin can lose most of its value.
- **Fees:** no bridge, swap or protocol fee is hard-coded; costs come from real quotes (Tidepool `/v0/quote`, Ref
  `get_return`, Rhea `quote`). SOL2NEAR takes 0 %.

## Documentation

- [Judge quickstart](docs/JUDGE_QUICKSTART.md) — reproduce everything without a key, funds or a public transaction
- [Memecoin proof](docs/HACKATHON_MEMECOIN_PROOF.md) — what the NEARLY demo proves, and on which evidence
- [Architecture](docs/ARCHITECTURE.md) · [FUEL rules](docs/FUEL_REACTOR.md) · [Rhea DCL design](docs/V4_2A_DCL_FEASIBILITY.md)
- [Security / release audit](docs/G9_INDEPENDENT_AUDIT.md) · [Proof ledger](docs/G8_PROOF_LEDGER.md)
- [Interface release notes (H6)](docs/H6_UI_UX_RELEASE.md) · [Hackathon rules checklist](docs/HACKATHON_CHECKLIST.md)
- Earlier checkpoint reports: [docs/archive/](docs/archive/README.md)

## Prior work, libraries, AI assistance

- **Prior work:** none. The repository was created on 2026-11-11, inside the hackathon window.
- **Libraries:** `near-sdk` / `near-contract-standards` 5.30.1, React 18.3.1, Vite 5.4.11, NEAR Wallet Selector 10.1.4,
  `@near-js/transactions` 2.5.1, `@solana/web3.js` 1.98.4, `@solana/spl-token` 0.4.14; tools: cargo-near 0.22.0,
  near-cli-rs 0.31.1, TypeScript 5.6.3, Playwright, pnpm 10.
- **External services:** Tidepool (community testnet sandbox), Ref/Rhea testnet exchange, NEAR and Solana public RPCs,
  read-only mainnet view calls to Ref/Rhea, Rhea DCL and Nearly (token code from github.com/sam3dsol/Nearlytrade).
- **Templates:** none.
- **Other project by the same author (rule Q-015):** the author also submits **LAST — Last Buyer Wins**
  (https://github.com/nielslecodeur/LAST), a last-buyer-wins memecoin game on NEAR testnet, in the `memecoins` track as
  well. The two projects are independent: separate repositories, contracts and testnet accounts, and a different
  mechanic (LAST: a countdown jackpot game; SOL2NEAR: cross-chain liquidity routing and the FUEL Reactor).
- **AI assistance:** code and documentation were written with **Claude Code (Anthropic)** under the direction of the
  author, then reviewed and tested by the author.

## License

MIT, see [LICENSE](LICENSE).
