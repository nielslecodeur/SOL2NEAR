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

const hashes = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((h) => (typeof h === "string" ? h : (h as { hash?: unknown })?.hash)).filter((h): h is string => typeof h === "string")
    : [];

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
    solanaTxHashes: hashes(d.originChainTxHashes),
    nearTxHashes: hashes(d.destinationChainTxHashes),
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
