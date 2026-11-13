/**
 * Quote logic, no network. Request shape = the one verified live on 2026-11-11 by
 * scripts/probes/verify-testnet.mjs (1Click-compatible POST /v0/quote).
 */
import type { BridgeQuote, BridgeQuoteRequest } from "../../shared/src/crosschain.ts";
import { NEAR_USDC, SOL_USDC } from "../../shared/src/assets.ts";
import { fail } from "./errors.ts";

const U64_MAX = (1n << 64n) - 1n;
const ATOMIC_RE = /^[1-9]\d*$/;
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// NEAR account id rules (nomicon): 2-64 chars, lowercase, separators . - _
const NEAR_ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const DEFAULT_SLIPPAGE_BPS = 100;
export const DEFAULT_DEADLINE_MINUTES = 30;
/** A live quote is treated as expired this long before its deadline, to leave time to confirm on Solana. */
export const EXPIRY_SAFETY_MS = 60_000;

/** Body of POST /v0/quote for the only supported route: Solana Devnet USDC -> NEAR testnet USDC. */
export function buildQuoteBody(req: BridgeQuoteRequest, dry: boolean, now = Date.now()) {
  if (!ATOMIC_RE.test(req.amountAtomic) || BigInt(req.amountAtomic) > U64_MAX)
    throw fail("validation", `amountAtomic must be a positive integer string in USDC atomic units (got "${req.amountAtomic}")`);
  if (!SOLANA_ADDR_RE.test(req.solanaRefundAddress))
    throw fail("validation", `solanaRefundAddress is not a base58 Solana address: "${req.solanaRefundAddress}"`);
  if (!NEAR_ACCOUNT_RE.test(req.nearRecipient))
    throw fail("validation", `nearRecipient is not a valid NEAR account id: "${req.nearRecipient}"`);
  const slippage = req.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  if (!Number.isInteger(slippage) || slippage < 0 || slippage > 10_000)
    throw fail("validation", `slippageBps must be an integer in [0, 10000] (got ${slippage})`);
  const minutes = req.deadlineMinutes ?? DEFAULT_DEADLINE_MINUTES;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    throw fail("validation", `deadlineMinutes must be an integer in [1, 1440] (got ${minutes})`);

  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: slippage,
    originAsset: SOL_USDC.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC.assetId,
    amount: req.amountAtomic,
    refundTo: req.solanaRefundAddress,
    refundType: "ORIGIN_CHAIN",
    recipient: req.nearRecipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + minutes * 60_000).toISOString(),
  };
}

interface RawQuoteResponse {
  correlationId?: unknown;
  signature?: unknown;
  quoteRequest?: Record<string, unknown>;
  quote?: {
    depositMemo?: unknown;
    amountIn?: unknown;
    amountOut?: unknown;
    minAmountOut?: unknown;
    timeEstimate?: unknown;
    depositAddress?: unknown;
    deadline?: unknown;
  };
}

const isAtomic = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

/** Fields of our request that Tidepool echoes back (1Click `quoteRequest`) and that decide where funds go. */
const ECHOED = ["originAsset", "destinationAsset", "amount", "recipient", "refundTo", "swapType", "depositType", "recipientType"] as const;

/**
 * Validates a Tidepool quote response. Never fills a missing field with a guess.
 * When `body` (the request we sent) is given and Tidepool echoes `quoteRequest`, every field that decides
 * where the funds go must match exactly, so a quote for another asset or recipient can never be signed.
 */
export function parseQuote(
  raw: unknown,
  requested: { amountAtomic: string; dry: boolean; body?: ReturnType<typeof buildQuoteBody> },
): BridgeQuote {
  const r = raw as RawQuoteResponse;
  const q = r?.quote;
  const echo = r?.quoteRequest;
  if (requested.body && echo && typeof echo === "object")
    for (const k of ECHOED)
      if (k in echo && echo[k] !== requested.body[k])
        throw fail("http", `Tidepool quote echoes ${k}=${JSON.stringify(echo[k])}, we asked ${JSON.stringify(requested.body[k])}`);
  if (typeof q?.depositMemo === "string" && q.depositMemo)
    throw fail("unsupported_route", "this deposit address requires a memo (depositMode MEMO), which this client does not send");
  if (!q || !isAtomic(q.amountIn) || !isAtomic(q.amountOut) || !isAtomic(q.minAmountOut))
    throw fail("http", "Tidepool quote response is missing amountIn / amountOut / minAmountOut");
  if (q.amountIn !== requested.amountAtomic)
    throw fail("http", `Tidepool quoted amountIn ${q.amountIn}, expected ${requested.amountAtomic} (EXACT_INPUT)`);
  if (BigInt(q.minAmountOut) > BigInt(q.amountOut))
    throw fail("http", "Tidepool quote is inconsistent: minAmountOut > amountOut");
  if (typeof r.correlationId !== "string" || typeof r.signature !== "string")
    throw fail("http", "Tidepool quote response is missing correlationId / signature");

  const depositAddress = typeof q.depositAddress === "string" && q.depositAddress ? q.depositAddress : undefined;
  if (requested.dry && depositAddress) throw fail("http", "dry quote unexpectedly returned a deposit address");
  if (!requested.dry && !depositAddress) throw fail("http", "live quote has no deposit address");
  const deadline = [q.deadline, r.quoteRequest?.deadline].find((d): d is string => typeof d === "string");

  return {
    correlationId: r.correlationId,
    dry: requested.dry,
    amountIn: q.amountIn,
    amountOut: q.amountOut,
    minAmountOut: q.minAmountOut,
    timeEstimateSec: typeof q.timeEstimate === "number" ? q.timeEstimate : Number.NaN,
    ...(depositAddress && { depositAddress }),
    ...(deadline && { deadline }),
    signature: r.signature,
    ...(requested.body && { nearRecipient: requested.body.recipient, solanaRefundAddress: requested.body.refundTo }),
  };
}

export type QuoteValidity = "dry" | "valid" | "expired" | "no_deadline";

/** Can this quote still be funded? Dry quotes never can. */
export function quoteValidity(q: BridgeQuote, now = Date.now(), safetyMs = EXPIRY_SAFETY_MS): QuoteValidity {
  if (q.dry || !q.depositAddress) return "dry";
  if (!q.deadline) return "no_deadline";
  const t = Date.parse(q.deadline);
  if (Number.isNaN(t)) return "no_deadline";
  return now + safetyMs < t ? "valid" : "expired";
}

/** Throws unless the quote can be funded now. */
export function assertFundable(q: BridgeQuote, now = Date.now()): asserts q is BridgeQuote & { depositAddress: string } {
  const v = quoteValidity(q, now);
  if (v === "dry") throw fail("validation", "dry quote: request a live quote (dry: false) before depositing");
  if (v === "no_deadline") throw fail("quote_expired", "quote has no readable deadline: request a new one");
  if (v === "expired") throw fail("quote_expired", `quote deadline ${q.deadline} is past or too close: request a new one`);
}
