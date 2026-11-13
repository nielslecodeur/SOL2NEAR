/**
 * Local history of every NEAR transaction the dashboard asked the wallet to sign. It survives reloads,
 * including the full-page redirect of browser wallets (MyNearWallet), and blocks a second submission
 * while an earlier one is not resolved.
 */
import type { ActionKind } from "./actions.ts";

export type TxKind = "deposit" | ActionKind;
export type TxRecordStatus =
  | "awaiting_signature" // wallet opened (or redirect in progress); outcome unknown
  | "submitted" //          we have a tx hash; final outcome not verified yet
  | "confirmed" //          verified from the final outcome (+ Treasury state for deposits)
  | "refunded" //           deposit refused or refunded by the token
  | "failed" //             final outcome is a failure
  | "rejected" //           user rejected in the wallet: nothing was sent
  | "dismissed"; //         user said they checked it themselves

export interface TxRecord {
  id: string;
  kind: TxKind;
  accountId: string;
  createdAt: number;
  updatedAt: number;
  status: TxRecordStatus;
  /** Atomic USDC for deposits. */
  amount?: string;
  /** Deposit / position id the call is about. */
  target?: string;
  txHash?: string;
  detail?: string;
}

export interface Storage2 { getItem(k: string): string | null; setItem(k: string, v: string): void }

const KEY = "sol2near.near-tx";
const OPEN: readonly TxRecordStatus[] = ["awaiting_signature", "submitted"];
export const isOpen = (r: TxRecord) => OPEN.includes(r.status);

export function txHistory(storage: Storage2 | null, now: () => number = Date.now) {
  let mem: TxRecord[] = [];
  const read = (): TxRecord[] => {
    if (!storage) return mem;
    try {
      return JSON.parse(storage.getItem(KEY) ?? "[]");
    } catch {
      return [];
    }
  };
  const write = (all: TxRecord[]) => {
    mem = all.slice(-50);
    if (storage) {
      try {
        storage.setItem(KEY, JSON.stringify(mem));
      } catch {
        /* storage full or blocked: memory still works for this page */
      }
    }
  };
  return {
    list: (accountId?: string) => read().filter((r) => !accountId || r.accountId === accountId).sort((a, b) => b.createdAt - a.createdAt),
    add(r: Omit<TxRecord, "id" | "createdAt" | "updatedAt" | "status">): TxRecord {
      const rec: TxRecord = { ...r, id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), status: "awaiting_signature" };
      write([...read(), rec]);
      return rec;
    },
    update(id: string, patch: Partial<TxRecord>): TxRecord | undefined {
      const all = read();
      const i = all.findIndex((r) => r.id === id);
      if (i < 0) return undefined;
      all[i] = { ...all[i]!, ...patch, updatedAt: now() };
      write(all);
      return all[i];
    },
    /** An unresolved record of the same kind/target for this account blocks a new submission. */
    blocking(accountId: string, kind: TxKind, target?: string): TxRecord | undefined {
      return read().find((r) => r.accountId === accountId && r.kind === kind && (target === undefined || r.target === target) && isOpen(r));
    },
  };
}
export type TxHistory = ReturnType<typeof txHistory>;

/**
 * Browser wallets redirect back with `?transactionHashes=h1,h2` or `?errorCode=…&errorMessage=…`.
 * Returns what came back, or null when the URL carries nothing from a wallet.
 */
export function parseWalletReturn(search: string): { hashes: string[] } | { error: string } | null {
  const q = new URLSearchParams(search);
  const hashes = q.get("transactionHashes");
  if (hashes) return { hashes: hashes.split(",").filter(Boolean) };
  const code = q.get("errorCode");
  if (code) return { error: `${code}${q.get("errorMessage") ? `: ${decodeURIComponent(q.get("errorMessage")!)}` : ""}` };
  return null;
}

/** Applies a wallet redirect result to the single record that was awaiting it (if exactly one). */
export function applyWalletReturn(h: TxHistory, ret: ReturnType<typeof parseWalletReturn>, accountId: string): TxRecord | undefined {
  if (!ret) return undefined;
  const waiting = h.list(accountId).filter((r) => r.status === "awaiting_signature");
  if (waiting.length !== 1) return undefined; // ambiguous: leave every record as is, never guess
  const r = waiting[0]!;
  if ("hashes" in ret) return h.update(r.id, { status: "submitted", txHash: ret.hashes[ret.hashes.length - 1] });
  return h.update(r.id, { status: /reject|cancel/i.test(ret.error) ? "rejected" : "failed", detail: ret.error });
}
