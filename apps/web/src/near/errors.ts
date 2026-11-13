/** Wallet errors, kept free of any wallet library so they can be unit-tested. */
export class WalletError extends Error {
  readonly rejected: boolean;
  constructor(message: string, rejected: boolean) {
    super(message);
    this.name = "WalletError";
    this.rejected = rejected;
  }
}

const REJECT_RE = /reject|denied|declin|cancel|closed the window|user closed/i;

/** True only when the user refused in the wallet: then nothing was broadcast and a retry is safe. */
export function isRejection(e: unknown): boolean {
  const msg = (e as { message?: unknown })?.message ?? String(e);
  return (e as { code?: unknown })?.code === 4001 || REJECT_RE.test(String(msg));
}
