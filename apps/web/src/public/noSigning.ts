// PUBLIC READ-ONLY BUILD: replaces packages/crosschain/src/wallet.ts and src/near/wallet.ts. Any attempt to sign throws.
export interface SolanaWallet { signAndSendTransaction(tx: Uint8Array): Promise<string> }
const refuse = (): never => { throw new Error("SIGNING_DISABLED: public read-only build"); };
export async function signAndSend(_wallet: SolanaWallet, _tx: Uint8Array): Promise<string> { return refuse(); }
export const getNearWallet = (): never => refuse();
export class WalletError extends Error {}
