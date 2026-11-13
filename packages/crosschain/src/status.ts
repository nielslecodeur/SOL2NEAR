/**
 * Status tracking. Status names were read from the Tidepool docs (FEASIBILITY T14). The response
 * fields below follow the 1Click GET /v0/status shape; they are parsed defensively and an unknown
 * status is an error, never mapped to a guess.
 */
import { TERMINAL_BRIDGE_STATUSES, type BridgeResult, type BridgeStatus } from "../../shared/src/crosschain.ts";
import { errMessage, fail } from "./errors.ts";

const ALL: readonly BridgeStatus[] = [
  "PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED",
];

export const isTerminal = (s: BridgeStatus) => TERMINAL_BRIDGE_STATUSES.includes(s);

type TxRef = { hash: string; explorerUrl?: string };
const refs = (v: unknown): TxRef[] =>
  Array.isArray(v)
    ? v.map((h) => (typeof h === "string" ? { hash: h } : { hash: (h as { hash?: unknown })?.hash, explorerUrl: (h as { explorerUrl?: unknown })?.explorerUrl }))
        .filter((h): h is TxRef => typeof h.hash === "string")
    : [];
/**
 * Which chain a tx ref belongs to. Observed live (2026-11-13): `destinationChainTxHashes` can also hold a
 * Solana refund tx (explorer.solana.com). The explorer URL decides; without one, Solana signatures are
 * 64-byte base58 (~87-88 chars) and NEAR tx hashes 32-byte base58 (~43-44 chars).
 */
const isSolana = (r: TxRef) => (r.explorerUrl ? /solana/i.test(r.explorerUrl) : r.hash.length > 60);

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export function parseStatus(raw: unknown, depositAddress: string): BridgeResult {
  const r = raw as {
    status?: unknown;
    updatedAt?: unknown;
    swapDetails?: Record<string, unknown>;
    quoteResponse?: { quote?: { depositAddress?: unknown } };
  };
  if (typeof r?.status !== "string" || !ALL.includes(r.status as BridgeStatus))
    throw fail("http", `Tidepool returned an unknown status: ${JSON.stringify(r?.status)}`);
  // 1Click echoes the original quote: it must be about the address we asked for.
  const echoed = r.quoteResponse?.quote?.depositAddress;
  if (typeof echoed === "string" && echoed !== depositAddress)
    throw fail("http", `Tidepool status is for deposit address ${echoed}, we asked ${depositAddress}`);
  const d = r.swapDetails ?? {};
  const amountIn = str(d.amountIn);
  const amountOut = str(d.amountOut);
  const refundReason = str(d.refundReason);
  const refundedAmount = str(d.refundedAmount);
  const updatedAt = str(r.updatedAt);
  return {
    status: r.status as BridgeStatus,
    depositAddress,
    ...(amountIn && { amountIn }),
    ...(amountOut && { amountOut }),
    // Our only route starts on Solana, so origin refs are Solana; destination refs are split by chain.
    solanaTxHashes: [...refs(d.originChainTxHashes), ...refs(d.destinationChainTxHashes).filter(isSolana)].map((r) => r.hash),
    nearTxHashes: refs(d.destinationChainTxHashes).filter((r) => !isSolana(r)).map((r) => r.hash),
    ...(refundReason && { refundReason }),
    ...(refundedAmount && { refundedAmount }),
    ...(updatedAt && { updatedAt }),
  };
}

export interface WatchOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  /** Consecutive network/HTTP errors tolerated before giving up. Default 5. */
  maxConsecutiveErrors?: number;
  /** Injected in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

/** Polls until SUCCESS / REFUNDED / FAILED. `onUpdate` fires only when the result changes. */
export async function watchStatus(
  fetchStatus: () => Promise<BridgeResult>,
  onUpdate: (r: BridgeResult) => void,
  opts: WatchOptions = {},
): Promise<BridgeResult> {
  const interval = Math.min(5_000, Math.max(2_000, opts.intervalMs ?? 3_000));
  const sleep = opts.sleep ?? defaultSleep;
  const maxErrors = opts.maxConsecutiveErrors ?? 5;
  let last = "";
  let errors = 0;
  for (;;) {
    opts.signal?.throwIfAborted();
    try {
      const r = await fetchStatus();
      errors = 0;
      const key = JSON.stringify(r);
      if (key !== last) { last = key; onUpdate(r); }
      if (isTerminal(r.status)) return r;
    } catch (e) {
      // An unknown status or a status for another address is a real answer, not a transient error: stop.
      if ((e as { kind?: string }).kind === "http" && /unknown status|status is for deposit address/.test(errMessage(e))) throw e;
      if (++errors >= maxErrors) throw e;
    }
    await sleep(interval, opts.signal);
  }
}
