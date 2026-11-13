/**
 * Public contract of `packages/crosschain`, implemented unchanged by createTidepoolClient().
 * The frontend consumes ONLY this interface. Extras are documented in docs/crosschain/INTERFACE.md;
 * it must not change without a documented reason.
 *
 * Rules: amounts are integer strings in atomic units (never floats); no private keys anywhere;
 * signatures always go through the user's wallet; no Tidepool status is ever invented.
 */

/** Tidepool / 1Click execution statuses (GET /v0/status). */
export type BridgeStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export const TERMINAL_BRIDGE_STATUSES: readonly BridgeStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];

export interface BridgeQuoteRequest {
  /** USDC atomic units (6 decimals), e.g. "1000000" = 1 USDC. */
  amountAtomic: string;
  /** Base58 Solana Devnet address of the user (refund destination). */
  solanaRefundAddress: string;
  /** NEAR testnet account of the user: Tidepool delivers here, then the user deposits into Treasury. */
  nearRecipient: string;
  /** Default 100 (1 %). */
  slippageBps?: number;
  /** Default 30, bounded to [1, 1440] by Tidepool rules. */
  deadlineMinutes?: number;
}

export interface BridgeQuote {
  correlationId: string;
  dry: boolean;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  timeEstimateSec: number;
  /** Only for live quotes (dry = false). */
  depositAddress?: string;
  /** ISO timestamp, live quotes only. */
  deadline?: string;
  /** Tidepool ed25519 signature (not verified by the default 1Click SDK key). */
  signature: string;
  /** Echo of the request, kept so every later step can re-check where the funds go. */
  nearRecipient?: string;
  solanaRefundAddress?: string;
}

export interface BridgeResult {
  status: BridgeStatus;
  depositAddress: string;
  amountIn?: string;
  amountOut?: string;
  solanaTxHashes: string[];
  nearTxHashes: string[];
  refundReason?: string;
  /** Atomic amount returned to the Solana refund address (REFUNDED). */
  refundedAmount?: string;
  updatedAt?: string;
}

export interface CrosschainError {
  kind:
    | "network"
    | "http"
    | "validation"
    | "wallet_rejected"
    | "quote_expired"
    | "unsupported_route"
    /** The Solana deposit transaction landed but failed on-chain. */
    | "solana_tx_failed"
    /** A signing attempt was interrupted (reload, crash): never re-sign automatically. */
    | "interrupted"
    /** Tidepool says SUCCESS but the expected USDC is not on the NEAR recipient. */
    | "settlement_mismatch";
  message: string;
  httpStatus?: number;
}

export interface CrosschainClient {
  /** GET /v0/health — is the Solana devnet route currently up? */
  health(): Promise<{ ok: boolean; solanaRouteOk: boolean }>;
  /** POST /v0/quote. `dry: true` must be the default for previews. */
  quote(req: BridgeQuoteRequest, opts: { dry: boolean }): Promise<BridgeQuote>;
  /** Unsigned SPL transfer to the quote's deposit address, for the user's wallet to sign. */
  buildDepositTransaction(quote: BridgeQuote, payer: string): Promise<Uint8Array>;
  /** POST /v0/deposit/submit (optional speed-up). Must be idempotent. */
  submitDeposit(txHash: string, depositAddress: string): Promise<void>;
  /** Polls GET /v0/status every 2-5 s until SUCCESS / REFUNDED / FAILED. */
  watch(
    depositAddress: string,
    onUpdate: (r: BridgeResult) => void,
    opts?: { intervalMs?: number; signal?: AbortSignal },
  ): Promise<BridgeResult>;
}
