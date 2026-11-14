# Judge quickstart — SOL2NEAR

No private key, no funds, no public transaction. Everything below only reads public chains or runs a local chain.
What it proves, and what it does not: [`HACKATHON_MEMECOIN_PROOF.md`](HACKATHON_MEMECOIN_PROOF.md).

## 0. Look first (2 minutes, nothing to install)

- Public read-only demo: https://sol2near-demo.vercel.app. Its bundle contains no wallet and no signing code. It was
  deployed from `4c88875` and includes the NEARLY journey in its 8-step form (Creator Portal → *Explore · NEARLY
  memecoin*). The three-step interface described in step 2 is in the repository and not deployed yet.
- Proofs page (`#/proofs`): every testnet/devnet transaction hash with its explorer link.

## 1. Requirements

- Node ≥ 22.18 and pnpm 10 (`corepack enable`).
- For the sandbox proof only: Linux, macOS or WSL with Rust, the `wasm32-unknown-unknown` target and
  `cargo install cargo-near --version 0.22.0 --locked`. near-workspaces downloads the local neard sandbox itself.

```bash
git clone https://github.com/nielslecodeur/SOL2NEAR && cd SOL2NEAR
pnpm install --frozen-lockfile
```

## 2. The NEARLY journey in your browser (read-only)

```bash
pnpm --filter @sol2near/web build:public        # the public build: signing modules are not bundled
pnpm check:public                               # → "public bundle is read-only"
pnpm --filter @sol2near/web exec vite preview --outDir dist-public
```

Open the printed URL and click **Explore the demo**. Three steps:
1. **Choose**: the real pool, labelled with the block of its snapshot (*Advanced details* for every identifier).
2. **Preview**: the **historical quote** (mainnet block 224 535 331). **Get a live indicative quote** runs Rhea's own
   `quote` / `predict_hotzap` views on mainnet, all at one block. Neither quote is an executable offer.
3. **Proof**: the sandbox summary, then **View technical evidence** for the 58 steps. Open any **proof** button to see
   the arguments, the result and the on-chain reads.

The **Proof** page (`#/proofs`) lists the testnet transactions (simple and technical view). The developer tools
(testnet console, Dashboard, Pools, Positions, FUEL Reactor) are under **Developers**.

## 3. Reproduce the NEARLY DCL execution (LOCAL SANDBOX, ≈ 3 min)

```bash
bash scripts/proofs/nearly-proof.sh             # Windows: wsl -d Ubuntu -- bash scripts/proofs/nearly-proof.sh
```

The script:
1. Fetches the **code** of `dclv2.ref-labs.near`, `wrap.near`, the NEARLY token global code and the Tidepool USDC
   token, with read-only `view_code` calls.
2. Builds TreasuryDCL.
3. Runs the scenario in a fresh local chain.
4. Compares the export with the committed one.

Expected:
```
test result: ok. 1 passed
PASS dcl code = mainnet 3G34Nhjmir5JPYPtijaA9iCNnHDPR7h3wfC9H77woEGo
PASS nearly_token code = mainnet 5qScjXG9uRG82Yrh36XZNZgVUYiqPtuC9ep5DvV42eGQ
PASS export identical to the committed packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json (58 steps)
```
If your toolchain builds TreasuryDCL with different bytes, the check says `DIFFERENT BUILD` and still compares every
step. The run rewrites `packages/near-client/src/fixtures/v42_dcl_sandbox_views.json` with new timestamps; nothing else
changes.

## 4. Tests

```bash
pnpm typecheck && pnpm test:ts && pnpm --filter @sol2near/web test   # near-client 64, crosschain 36, web 48
pnpm --filter @sol2near/web e2e:offline                              # 20 tests, every public endpoint blocked (needs Google Chrome)
pnpm check:release && pnpm check:docs                                # no keys, no personal paths, no eval; doc links resolve
cargo test --workspace                                               # 34 + 31 + 47 + 3 + 41
```

## 5. Re-verify the real testnet / devnet transactions (read-only RPC)

```bash
node scripts/probes/verify-testnet.mjs          # → all checks passed
node scripts/probes/verify-g6-g7.mjs            # → all G6/G7 proofs re-verified
node scripts/probes/nearly-reference-sim.mjs    # optional: a fresh NEARLY quote pinned to the current mainnet block (rewrites the fixture)
```

## What you will *not* find

- A mainnet transaction.
- A funded NEARLY position.
- A single transaction that goes from Solana to NEARLY.

The testnet proofs (bridge → Treasury V3 → Ref pool #2951) and the NEARLY DCL proof (local sandbox) are two separate
levels of evidence, and every screen labels them as such.
