/**
 * Wallet boundary. The package never holds a key: the user's wallet signs and sends.
 * Adapt any wallet to this shape (Wallet Standard `solana:signAndSendTransaction` takes the same
 * serialized bytes and returns the signature).
 */
import { errMessage, fail } from "./errors.ts";

export interface SolanaWallet {
  /** Signs the serialized unsigned transaction and broadcasts it. Returns the base58 signature. */
  signAndSendTransaction(tx: Uint8Array): Promise<string>;
}

const REJECT_RE = /reject|denied|declin|cancel/i;

export async function signAndSend(wallet: SolanaWallet, tx: Uint8Array): Promise<string> {
  try {
    const sig = await wallet.signAndSendTransaction(tx);
    if (typeof sig !== "string" || !sig) throw new Error("wallet returned no signature");
    return sig;
  } catch (e) {
    // EIP-1193-style code 4001 is what Phantom and most Solana wallets use for a user rejection.
    if ((e as { code?: unknown })?.code === 4001 || REJECT_RE.test(errMessage(e)))
      throw fail("wallet_rejected", `wallet rejected the transaction: ${errMessage(e)}`);
    throw fail("network", `wallet could not send the transaction: ${errMessage(e)}`);
  }
}
