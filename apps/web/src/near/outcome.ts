/** Reads a NEAR FinalExecutionOutcome: final status, return value, NEP-297 events per contract, failures. */

type ExecStatus = { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown } | string;

export interface TxOutcome {
  status: ExecStatus;
  transaction: { hash: string; signer_id: string; receiver_id: string };
  receipts_outcome: { id: string; outcome: { executor_id: string; logs: string[]; status: ExecStatus } }[];
}

export interface NearEvent {
  /** Contract that emitted the log: the only thing that makes an event trustworthy. */
  contract: string;
  standard: string;
  event: string;
  data: Record<string, unknown>[];
}

export interface ParsedOutcome {
  hash: string;
  signer: string;
  receiver: string;
  /** Final transaction status is a success (a callback may still have failed inside). */
  ok: boolean;
  /** Decoded JSON return value of the transaction, if any. */
  returnValue?: unknown;
  events: NearEvent[];
  failures: { contract: string; message: string }[];
}

const isFailure = (s: ExecStatus): s is { Failure: unknown } => typeof s === "object" && s !== null && "Failure" in s;

function failureMessage(f: unknown): string {
  const text = JSON.stringify(f);
  return /Smart contract panicked: ([^"\\]+)/.exec(text)?.[1] ?? text.slice(0, 200);
}

export function parseOutcome(o: TxOutcome): ParsedOutcome {
  const events: NearEvent[] = [];
  const failures: ParsedOutcome["failures"] = [];
  for (const r of o.receipts_outcome) {
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const e = JSON.parse(log.slice("EVENT_JSON:".length));
        events.push({ contract: r.outcome.executor_id, standard: e.standard, event: e.event, data: e.data ?? [] });
      } catch {
        /* malformed log: ignored, never guessed */
      }
    }
    if (isFailure(r.outcome.status)) failures.push({ contract: r.outcome.executor_id, message: failureMessage(r.outcome.status.Failure) });
  }
  let returnValue: unknown;
  const s = o.status;
  if (typeof s === "object" && s && typeof s.SuccessValue === "string" && s.SuccessValue) {
    try {
      returnValue = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.SuccessValue), (c) => c.charCodeAt(0))));
    } catch {
      returnValue = undefined;
    }
  }
  if (isFailure(s) && failures.length === 0) failures.push({ contract: o.transaction.receiver_id, message: failureMessage(s.Failure) });
  return {
    hash: o.transaction.hash,
    signer: o.transaction.signer_id,
    receiver: o.transaction.receiver_id,
    ok: !isFailure(s),
    ...(returnValue !== undefined && { returnValue }),
    events,
    failures,
  };
}

/** Events of one contract only: logs from any other contract are ignored. */
export const eventsFrom = (p: ParsedOutcome, contract: string, event: string) =>
  p.events.filter((e) => e.contract === contract && e.event === event).flatMap((e) => e.data);
