#!/usr/bin/env bash
# H2 — ONE COMMAND: reproduce the NEARLY DCL proof in a LOCAL SANDBOX (Linux or WSL). No key, no funds, no public tx.
#   bash scripts/proofs/nearly-proof.sh          (from Windows: wsl -d Ubuntu -- bash scripts/proofs/nearly-proof.sh)
# 1. copies the CODE of the public contracts with read-only RPC view calls (mainnet Rhea DCL, wrap.near, Nearly token
#    global code; testnet Tidepool USDC) and checks the Nearly SHA-256 against the Nearly README;
# 2. builds TreasuryDCL with cargo-near 0.22.0;
# 3. runs sandbox-tests/tests/v42_dcl.rs in a fresh local neard sandbox (every assertion must hold);
# 4. rebuilds the deterministic export and compares it with the committed one (scripts/proofs/export-nearly-proof.mjs --check).
# Needs: node >= 22.18, Rust + wasm32-unknown-unknown, cargo-near 0.22.0. near-workspaces fetches the neard sandbox binary.
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true
export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/../.."
echo "== 1/4 fetch contract code (read-only view_code)"
node scripts/probes/fetch-sandbox-wasm.mjs
node scripts/probes/fetch-dcl-wasm.mjs
echo "== 2/4 build TreasuryDCL"
bash scripts/build-wasm.sh treasury-dcl
echo "== 3/4 LOCAL SANDBOX scenario (about 70 s)"
bash sandbox-tests/run.sh v42_dcl | tee sandbox-tests/out-run.log | grep -E "^\[(A0|C0|C2|D1|F1|F4|G3|G4|K5|H1|H3|H4|J2|J3|R)\]|test result|proof log" || true
grep -q "test result: ok. 1 passed" sandbox-tests/out-run.log || { echo "FAIL sandbox scenario (full log: sandbox-tests/out-run.log)"; exit 1; }
echo "== 4/4 deterministic export vs committed"
node scripts/proofs/export-nearly-proof.mjs --check
echo "NEARLY DCL LOCAL SANDBOX proof reproduced."
