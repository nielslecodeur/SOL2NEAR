/** NEAR testnet accounts used by SOL2NEAR. */
export const NEAR_NETWORK = "testnet" as const;
export const NEAR_RPC_URL = "https://rpc.testnet.near.org";
export const NEAR_EXPLORER_TX = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const SOLANA_EXPLORER_TX = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** Ref/Rhea exchange on testnet (v1.9.19 verified 2026-11-11). */
export const REF_EXCHANGE_ID = "ref-finance-101.testnet";

/** Lead's accounts (created 2026-11-11). The Treasury contract is not deployed yet. */
export const DEV_ACCOUNT_ID = "sol2near-dev.testnet";
export const TREASURY_ACCOUNT_ID = "treasury.sol2near-dev.testnet";

/** Pool id is set after the pool is created on Ref (gate G2). null until then. */
export const LP_POOL_ID: number | null = null;
