// Integration example for the frontend (not executed by tests). Shows the full user path:
// dry preview -> live quote -> wallet signs the SPL deposit -> watch until settled on NEAR.
// After SUCCESS the USDC sits on the USER's NEAR account (Tidepool settles with a plain ft_transfer,
// FEASIBILITY T9); the user then calls usdc.ft_transfer_call(treasury, amount, '{"action":"deposit"}').
import { Transaction } from "@solana/web3.js";
import { createTidepoolClient, explorerLinks, CrosschainFailure, type SolanaWallet } from "../src/index.ts";

/** Phantom (window.phantom.solana) -> SolanaWallet. Wallet Standard adapters are similar. */
export function phantomAdapter(provider: {
  publicKey: { toBase58(): string } | null;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
}): SolanaWallet & { address: string } {
  if (!provider.publicKey) throw new Error("connect the wallet first");
  return {
    address: provider.publicKey.toBase58(),
    // Phantom must be set to Devnet (Settings -> Developer settings -> Testnet mode).
    async signAndSendTransaction(bytes) {
      return (await provider.signAndSendTransaction(Transaction.from(bytes))).signature;
    },
  };
}

export async function bridgeToNear(wallet: SolanaWallet & { address: string }, nearAccount: string, amountAtomic: string) {
  const tidepool = createTidepoolClient();
  const req = { amountAtomic, solanaRefundAddress: wallet.address, nearRecipient: nearAccount };

  const preview = await tidepool.quote(req, { dry: true }); // show amountOut / minAmountOut, nothing created
  console.log(`you receive ~${preview.amountOut} (min ${preview.minAmountOut}) USDC atomic on NEAR`);

  const live = await tidepool.quote(req, { dry: false }); // creates a deposit address, valid until live.deadline
  try {
    const signature = await tidepool.deposit(live, wallet.address, wallet);
    console.log("Solana deposit sent:", signature);
  } catch (e) {
    if (e instanceof CrosschainFailure && e.kind === "wallet_rejected") return null; // user said no: nothing sent
    throw e;
  }
  const result = await tidepool.watch(live.depositAddress!, (r) => console.log("status", r.status));
  console.log(result.status, explorerLinks(result));
  return result;
}
