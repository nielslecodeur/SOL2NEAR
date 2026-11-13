/**
 * @sol2near/crosschain — Solana Devnet USDC -> NEAR testnet USDC through Tidepool.
 * Tidepool is a community 1Click-compatible sandbox, NOT the official NEAR Intents service.
 * TESTNET / DEVNET ONLY: test tokens have no value.
 */
export { createTidepoolClient, type TidepoolClient, type TidepoolClientOptions, type TidepoolToken } from "./client.ts";
export { CrosschainFailure } from "./errors.ts";
export { assertFundable, buildQuoteBody, parseQuote, quoteValidity, type QuoteValidity } from "./quote.ts";
export { isTerminal, parseStatus, watchStatus, type WatchOptions } from "./status.ts";
export { buildSplDepositTx, SolanaDevnet, SOLANA_DEVNET_RPC } from "./solana.ts";
export { signAndSend, type SolanaWallet } from "./wallet.ts";
export { explorerLinks } from "./links.ts";
export { nearRpcReader, verifySettlement, type NearReader } from "./near.ts";
export { memoryStore, webStorageStore, isFinished, type TransferRecord, type TransferStage, type TransferStore } from "./store.ts";
export type * from "../../shared/src/crosschain.ts";
