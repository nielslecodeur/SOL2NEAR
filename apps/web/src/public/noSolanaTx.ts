// PUBLIC READ-ONLY BUILD: replaces packages/crosschain/src/solana.ts. No Solana transaction can be BUILT (no SPL
// transfer builder, no @solana/spl-token); Solana devnet is not read either, since no wallet address exists here.
export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
export interface DepositTxParams { [k: string]: unknown }
const refuse = (): never => { throw new Error("SOLANA_TX_DISABLED: public read-only build"); };
export function buildSplDepositTx(_p: DepositTxParams): Uint8Array { return refuse(); }
export class SolanaDevnet {
  constructor(_rpcUrl?: string) {}
  async latestBlockhash(): Promise<string> { return refuse(); }
  async confirmSignature(_s: string, _o?: unknown): Promise<void> { return refuse(); }
  async usdcBalance(_owner: string): Promise<string> { return refuse(); }
}
