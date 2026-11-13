/**
 * Durable record of each transfer, keyed by Tidepool deposit address, so a page reload or a crash can
 * never lead to a second signature for the same deposit, and tracking can resume where it stopped.
 */
import type { BridgeQuote, BridgeResult } from "../../shared/src/crosschain.ts";

export type TransferStage =
  | "signing" //          wallet opened; outcome unknown if we never got past this stage
  | "sent" //             wallet returned a signature
  | "solana_confirmed" // the deposit is confirmed on Solana devnet
  | "solana_failed" //    the deposit landed with an error on Solana: nothing was bridged
  | "bridge_success" //   Tidepool says SUCCESS (not yet checked on NEAR)
  | "bridge_refunded" //  Tidepool says REFUNDED
  | "bridge_failed" //    Tidepool says FAILED
  | "near_verified"; //   USDC increase observed on the NEAR recipient

export interface TransferRecord {
  depositAddress: string;
  quote: BridgeQuote;
  payer: string;
  stage: TransferStage;
  signature?: string;
  /** Recipient's NEAR USDC balance read just before signing (atomic). */
  nearBalanceBefore?: string;
  /** Observed NEAR USDC increase once verified (atomic). */
  nearReceived?: string;
  result?: BridgeResult;
  updatedAt: number;
}

export interface TransferStore {
  get(depositAddress: string): TransferRecord | undefined;
  put(r: TransferRecord): void;
  delete(depositAddress: string): void;
  list(): TransferRecord[];
}

export function memoryStore(): TransferStore {
  const m = new Map<string, TransferRecord>();
  return {
    get: (a) => m.get(a),
    put: (r) => void m.set(r.depositAddress, structuredClone(r)),
    delete: (a) => void m.delete(a),
    list: () => [...m.values()],
  };
}

/** Browser storage (localStorage). Failures to read are treated as "no record"; failures to write throw. */
export function webStorageStore(storage: Pick<Storage, "getItem" | "setItem">, key = "sol2near.transfers"): TransferStore {
  const read = (): Record<string, TransferRecord> => {
    try {
      return JSON.parse(storage.getItem(key) ?? "{}");
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, TransferRecord>) => storage.setItem(key, JSON.stringify(all));
  return {
    get: (a) => read()[a],
    put: (r) => write({ ...read(), [r.depositAddress]: r }),
    delete: (a) => {
      const all = read();
      delete all[a];
      write(all);
    },
    list: () => Object.values(read()),
  };
}

const TERMINAL: readonly TransferStage[] = ["solana_failed", "bridge_refunded", "bridge_failed", "near_verified"];
export const isFinished = (r: TransferRecord) => TERMINAL.includes(r.stage);
