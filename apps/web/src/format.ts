/** Display helpers. Amounts stay bigint/strings end to end: no float ever touches a balance. */

export function formatUnits(atomic: string | bigint, decimals: number, maxFraction = 4): string {
  const v = BigInt(atomic);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toLocaleString("en-US");
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export const usdc = (a: string | bigint) => formatUnits(a, 6, 2);
export const fuel = (a: string | bigint) => formatUnits(a, 18, 2);
export const wnear = (a: string | bigint) => formatUnits(a, 24, 4);

/** Integer percentage (0-100) of part/whole, for progress bars only. */
export function pct(part: string | bigint, whole: string | bigint): number {
  const w = BigInt(whole);
  if (w === 0n) return 0;
  const p = (BigInt(part) * 100n) / w;
  return Number(p > 100n ? 100n : p);
}

export function duration(ns: string | bigint): string {
  let s = Number(BigInt(ns) / 1_000_000_000n);
  if (s <= 0) return "0s";
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, !d && !h && `${s}s`].filter(Boolean).join(" ");
}

export type Tone = "pending" | "confirmed" | "failed" | "refunded" | "neutral";

/** Treasury DepositStatus (string or {Variant:{...}}) -> label + tone. */
export function depositStatus(status: unknown, lastError: string | null): { label: string; tone: Tone } {
  const name = typeof status === "string" ? status : Object.keys(status as object)[0];
  switch (name) {
    case "LpConfirmed": return { label: "LP CONFIRMED", tone: "confirmed" };
    case "LpWithdrawn": return { label: "LP WITHDRAWN", tone: "neutral" };
    case "BudgetAllocated":
    case "InRef":
    case "Swapped":
      return lastError ? { label: `FAILED · resumable (${lastError})`, tone: "failed" } : { label: name.toUpperCase(), tone: "neutral" };
    default: return { label: `PENDING · ${name}`, tone: "pending" };
  }
}

/** Tidepool / 1Click status -> tone. */
export function bridgeTone(status: string): Tone {
  if (status === "SUCCESS") return "confirmed";
  if (status === "REFUNDED") return "refunded";
  if (status === "FAILED") return "failed";
  return "pending";
}
