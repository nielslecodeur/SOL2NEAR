import type { BridgeResult } from "../../shared/src/crosschain.ts";
import { NEAR_EXPLORER_TX, SOLANA_EXPLORER_TX } from "../../shared/src/accounts.ts";

/** Proof links for a transfer: Solana deposit signature(s) and NEAR settlement tx(s). */
export const explorerLinks = (r: BridgeResult) => ({
  solana: r.solanaTxHashes.map(SOLANA_EXPLORER_TX),
  near: r.nearTxHashes.map(NEAR_EXPLORER_TX),
});
