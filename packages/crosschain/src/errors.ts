import type { CrosschainError } from "../../shared/src/crosschain.ts";

/** Thrown by every function of this package. `kind` is the stable field to branch on. */
export class CrosschainFailure extends Error {
  readonly kind: CrosschainError["kind"];
  readonly httpStatus?: number;

  constructor(e: CrosschainError) {
    super(e.message);
    this.name = "CrosschainFailure";
    this.kind = e.kind;
    if (e.httpStatus !== undefined) this.httpStatus = e.httpStatus;
  }

  toJSON(): CrosschainError {
    return { kind: this.kind, message: this.message, ...(this.httpStatus !== undefined && { httpStatus: this.httpStatus }) };
  }
}

export const fail = (kind: CrosschainError["kind"], message: string, httpStatus?: number) =>
  new CrosschainFailure({ kind, message, ...(httpStatus !== undefined && { httpStatus }) });

export const errMessage = (e: unknown): string => {
  if (!(e instanceof Error)) return String(e);
  const c = (e as { cause?: { code?: unknown; message?: unknown } }).cause;
  const detail = c?.code ?? c?.message;
  return detail ? `${e.message} (${String(detail)})` : e.message;
};
