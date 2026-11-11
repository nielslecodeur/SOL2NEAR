/**
 * Test assets — TESTNET / DEVNET ONLY. Tokens have no value.
 * Every value below was verified on 2026-11-11 via Tidepool GET /v0/tokens and NEAR testnet RPC
 * (see docs/FEASIBILITY.md §2). Re-check before relying on them: devnet resets change mints.
 */

export const TIDEPOOL_BASE_URL = "https://www.usetidepool.tech";

/** Solana Devnet test USDC (Tidepool's own mint, not Circle). */
export const SOL_USDC = {
  assetId: "nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet",
  mint: "7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr",
  decimals: 6,
} as const;

/** NEAR testnet USDC delivered by Tidepool (plain ft_transfer to the recipient). */
export const NEAR_USDC = {
  assetId: "nep141:usdc.tidepool-sandbox.testnet",
  contractId: "usdc.tidepool-sandbox.testnet",
  decimals: 6,
} as const;

/** NEAR testnet wNEAR of Tidepool — second leg of the LP pool. */
export const NEAR_WNEAR = {
  assetId: "nep141:wnear.tidepool-sandbox.testnet",
  contractId: "wnear.tidepool-sandbox.testnet",
  decimals: 24,
} as const;
