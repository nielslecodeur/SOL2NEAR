#!/usr/bin/env bash
# V4.1 LOCAL SANDBOX run (Linux/WSL). Nothing here touches testnet: the Ref and Tidepool USDC wasm are
# fetched beforehand with `node scripts/probes/fetch-sandbox-wasm.mjs` (read-only view_code), and the V4 wasm
# are built with `bash scripts/build-wasm.sh treasury-v4 sandbox-meme`.
# Usage (from Windows): wsl -d Ubuntu -- bash sandbox-tests/run.sh [test-name]
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/sol2near-target-sbx}"
# Reuse a local neard sandbox binary when present (no download).
if [ -x "$HOME/.near/sandbox/near-sandbox" ]; then export NEAR_SANDBOX_BIN_PATH="$HOME/.near/sandbox/near-sandbox"; fi
cargo test --test "${1:-v4_pilot}" -- --nocapture --test-threads=1 2>&1 | grep -vE "^ +(Compiling|Downloaded|Downloading) "
