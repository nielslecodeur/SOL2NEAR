#!/usr/bin/env bash
# Official wasm builds with cargo-near (run inside WSL/Linux). Linux artifacts go to a local
# target dir so they never mix with a Windows target/; wasm + ABI land in target/near/<contract>/.
# Usage (from Windows): wsl -d Ubuntu -- bash scripts/build-wasm.sh [contract ...]
# Default: the two DEPLOYED contracts (treasury fuel). V4.1 pilot (not deployed): treasury-v4 sandbox-meme.
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true
export PATH="$HOME/.local/bin:$PATH"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/sol2near-target}"
cargo near --version
if [ $# -gt 0 ]; then CONTRACTS=("$@"); else CONTRACTS=(treasury fuel); fi
for c in "${CONTRACTS[@]}"; do
  (cd "$REPO/contracts/$c" && cargo near build non-reproducible-wasm --out-dir "$REPO/target/near/$c") 2>&1 \
    | grep -E 'Size|SHA-256 checksum hex|successfully|error|warning: unused' || true
  test -f "$REPO/target/near/$c/sol2near_${c//-/_}.wasm"
done
