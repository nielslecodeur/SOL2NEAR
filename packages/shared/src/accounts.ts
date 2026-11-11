/** NEAR testnet accounts used by SOL2NEAR. */
export const NEAR_NETWORK = "testnet" as const;
// rpc.testnet.near.org now answers -429 "deprecated"; drpc is a public provider listed by docs.near.org
export const NEAR_RPC_URL = "https://near-testnet.drpc.org";
export const NEAR_EXPLORER_TX = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const SOLANA_EXPLORER_TX = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** Ref/Rhea exchange on testnet (v1.9.19 verified 2026-11-11). */
export const REF_EXCHANGE_ID = "ref-finance-101.testnet";

/** Lead's accounts (created 2026-11-11). The Treasury contract is not deployed yet. */
export const DEV_ACCOUNT_ID = "sol2near-dev.testnet";
export const TREASURY_ACCOUNT_ID = "treasury.sol2near-dev.testnet";
/** Planned FUEL account (not created yet). */
export const FUEL_ACCOUNT_ID = "fuel.sol2near-dev.testnet";

/** Ref pool USDC(tp)/wNEAR(tp), 30 bps. */
export const LP_POOL_ID: number | null = 2951; // created in G2 batch A, tx BXcJeRyXUUEwniGP46KJeYRjWHxgHcPK2RCQdpYZ7f7B
