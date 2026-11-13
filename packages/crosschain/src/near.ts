/**
 * NEAR side of the bridge: did the USDC really arrive? Tidepool settles with a plain ft_transfer of
 * `usdc.tidepool-sandbox.testnet` to the recipient (FEASIBILITY T9), so the proof we can read without
 * any key is the recipient's balance on that exact token contract, before vs after.
 */
import { NEAR_USDC } from "../../shared/src/assets.ts";
import { NEAR_RPC_URL } from "../../shared/src/accounts.ts";
import { errMessage, fail } from "./errors.ts";
import type { FetchLike } from "./http.ts";

export interface NearReader {
  /** `ft_balance_of` on usdc.tidepool-sandbox.testnet, atomic string. */
  usdcBalance(accountId: string): Promise<string>;
}

export function nearRpcReader(rpcUrl = NEAR_RPC_URL, doFetch: FetchLike = fetch): NearReader {
  return {
    async usdcBalance(accountId) {
      const args = btoa(JSON.stringify({ account_id: accountId }));
      let j: { result?: { result?: number[] }; error?: unknown };
      try {
        const res = await doFetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: "sol2near", method: "query",
            params: { request_type: "call_function", finality: "final", account_id: NEAR_USDC.contractId, method_name: "ft_balance_of", args_base64: args },
          }),
          signal: AbortSignal.timeout(30_000),
        });
        j = await res.json();
      } catch (e) {
        throw fail("network", `NEAR RPC ft_balance_of: ${errMessage(e)}`);
      }
      if (j.error || !j.result?.result) throw fail("http", `NEAR RPC ft_balance_of(${accountId}): ${JSON.stringify(j.error ?? "no result").slice(0, 200)}`);
      const v = JSON.parse(new TextDecoder().decode(Uint8Array.from(j.result.result)));
      if (typeof v !== "string" || !/^\d+$/.test(v)) throw fail("http", `NEAR ft_balance_of returned ${JSON.stringify(v)}`);
      return v;
    },
  };
}

/**
 * Throws `settlement_mismatch` unless the recipient gained at least `minAtomic` of NEAR USDC.
 * Returns the observed increase. Another incoming transfer in between can only make it larger, never
 * make a missing settlement look present.
 */
export function verifySettlement(beforeAtomic: string, afterAtomic: string, minAtomic: string): string {
  const delta = BigInt(afterAtomic) - BigInt(beforeAtomic);
  if (delta < BigInt(minAtomic))
    throw fail("settlement_mismatch", `NEAR USDC (${NEAR_USDC.contractId}) increased by ${delta}, expected at least ${minAtomic}`);
  return delta.toString();
}
