/**
 * Solana Devnet side: an UNSIGNED SPL transfer of test USDC to the quote's deposit address.
 * Mint 7paf…r4Xr is a classic SPL Token mint (owner TokenkegQ…, 6 decimals, mint authority = Tidepool
 * relayer BEijzwSQ…), read from api.devnet.solana.com on 2026-11-13.
 * The deposit address is treated as a wallet (owner): tokens go to its associated token account,
 * created idempotently and paid by the payer (~0.002 SOL rent if it does not exist yet).
 */
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { SOL_USDC } from "../../shared/src/assets.ts";
import { errMessage, fail } from "./errors.ts";

export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";

const pubkey = (label: string, v: string) => {
  try {
    return new PublicKey(v);
  } catch {
    throw fail("validation", `${label} is not a valid Solana address: "${v}"`);
  }
};

export interface DepositTxParams {
  payer: string;
  depositAddress: string;
  amountAtomic: string;
  recentBlockhash: string;
  mint?: string;
  decimals?: number;
}

/** Pure: builds and serializes the unsigned transaction (no network). */
export function buildSplDepositTx(p: DepositTxParams): Uint8Array {
  const payer = pubkey("payer", p.payer);
  const dest = pubkey("depositAddress", p.depositAddress);
  const mint = pubkey("mint", p.mint ?? SOL_USDC.mint);
  const decimals = p.decimals ?? SOL_USDC.decimals;
  if (!/^[1-9]\d*$/.test(p.amountAtomic)) throw fail("validation", `amountAtomic must be a positive integer string`);
  const amount = BigInt(p.amountAtomic);

  const source = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_PROGRAM_ID);
  const destAta = getAssociatedTokenAddressSync(mint, dest, true, TOKEN_PROGRAM_ID);
  const tx = new Transaction({ feePayer: payer, recentBlockhash: p.recentBlockhash }).add(
    createAssociatedTokenAccountIdempotentInstruction(payer, destAta, dest, mint, TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(source, mint, destAta, payer, amount, decimals, [], TOKEN_PROGRAM_ID),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}

/** Reads what the payer needs before signing: a fresh blockhash and the USDC balance. */
export class SolanaDevnet {
  private readonly conn: Connection;
  constructor(rpcUrl = SOLANA_DEVNET_RPC) {
    this.conn = new Connection(rpcUrl, "confirmed");
  }

  async latestBlockhash(): Promise<string> {
    try {
      return (await this.conn.getLatestBlockhash("confirmed")).blockhash;
    } catch (e) {
      throw fail("network", `Solana devnet getLatestBlockhash: ${errMessage(e)}`);
    }
  }

  /** USDC atomic balance of the payer's ATA ("0" if the account does not exist). */
  async usdcBalance(owner: string): Promise<string> {
    const ata = getAssociatedTokenAddressSync(new PublicKey(SOL_USDC.mint), pubkey("owner", owner), false, TOKEN_PROGRAM_ID);
    try {
      return (await this.conn.getTokenAccountBalance(ata)).value.amount;
    } catch (e) {
      if (/could not find account|Invalid param/i.test(errMessage(e))) return "0";
      throw fail("network", `Solana devnet getTokenAccountBalance: ${errMessage(e)}`);
    }
  }
}
