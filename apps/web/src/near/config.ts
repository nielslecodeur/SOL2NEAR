/** NEAR side of the dashboard: TESTNET ONLY. Every signed call goes through these guards. */
import { FUEL_ACCOUNT_ID, NEAR_RPC_URL, REF_EXCHANGE_ID, TREASURY_ACCOUNT_ID } from "../../../../packages/shared/src/accounts.ts";
import { NEAR_USDC } from "../../../../packages/shared/src/assets.ts";

export const NETWORK_ID = "testnet" as const;
export { FUEL_ACCOUNT_ID, NEAR_RPC_URL, REF_EXCHANGE_ID, TREASURY_ACCOUNT_ID };
export const USDC_TOKEN_ID = NEAR_USDC.contractId; // usdc.tidepool-sandbox.testnet, 6 decimals
export const USDC_DECIMALS = NEAR_USDC.decimals;

export const TGAS = 10n ** 12n;
export const ONE_YOCTO = 1n;
/** Gas per call, as proven on testnet in G2 (docs/G2_EXECUTION.md: C1, C2, C4, C6). Unused gas is refunded. */
export const GAS = {
  ft_transfer_call: 100n * TGAS, // C1
  execute_lp: 300n * TGAS, // C2: contract requires >= 200 Tgas
  register_position: 100n * TGAS, // C4: contract asks >= 60 Tgas
  claim: 50n * TGAS, // C6
  storage_deposit: 30n * TGAS,
} as const;
/** NEAR kept free for gas before allowing a signature (100 Tgas at testnet prices costs < 0.01 NEAR). */
export const MIN_NEAR_FOR_GAS = 2n * 10n ** 22n; // 0.02 NEAR

/**
 * Accepts only accounts that exist on testnet: named `*.testnet`, 64-hex implicit, or 0x-ETH implicit.
 * A `*.near` (mainnet) account is refused, so the UI can never prepare a mainnet transaction.
 */
export function isTestnetAccount(id: string): boolean {
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)+testnet$/.test(id) || /^[0-9a-f]{64}$/.test(id) || /^0x[0-9a-f]{40}$/.test(id);
}

export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
