/** Read-only NEAR testnet JSON-RPC. Injectable fetch so every caller can be tested without a network. */
import { NEAR_RPC_URL } from "./config.ts";
import type { TxOutcome } from "./outcome.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class RpcError extends Error {
  readonly unknownTx: boolean;
  constructor(message: string, unknownTx = false) {
    super(message);
    this.name = "RpcError";
    this.unknownTx = unknownTx;
  }
}

export interface NearRpc {
  view<T>(contract: string, method: string, args?: object): Promise<T>;
  /** Liquid NEAR (yocto) of an account, or null if it does not exist. */
  nearBalance(accountId: string): Promise<bigint | null>;
  /** Final outcome of a tx, or null while it is unknown / not final yet (never treated as a failure). */
  txStatus(hash: string, signerId: string): Promise<TxOutcome | null>;
}

export function nearRpc(url = NEAR_RPC_URL, doFetch: FetchLike = (u, i) => fetch(u, i)): NearRpc {
  async function call(method: string, params: unknown) {
    let json: { result?: any; error?: any };
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "sol2near", method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      json = await res.json();
    } catch (e) {
      throw new RpcError(`NEAR RPC ${method}: ${(e as Error).message}`);
    }
    const err = json.error ?? json.result?.error;
    if (err) {
      const text = typeof err === "string" ? err : JSON.stringify(err.cause ?? err);
      throw new RpcError(`NEAR RPC ${method}: ${text.slice(0, 240)}`, /UNKNOWN_TRANSACTION|doesn't exist|TIMEOUT_ERROR/.test(text));
    }
    return json.result;
  }
  return {
    async view<T>(contract: string, method: string, args: object = {}) {
      const r = await call("query", {
        request_type: "call_function", finality: "final", account_id: contract, method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      });
      return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
    },
    async nearBalance(accountId) {
      try {
        const r = await call("query", { request_type: "view_account", finality: "final", account_id: accountId });
        return BigInt(r.amount);
      } catch (e) {
        if (/UNKNOWN_ACCOUNT|does not exist/.test((e as Error).message)) return null;
        throw e;
      }
    },
    async txStatus(hash, signerId) {
      try {
        const r = await call("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: signerId, wait_until: "FINAL" });
        return r?.status && r?.receipts_outcome ? (r as TxOutcome) : null;
      } catch (e) {
        if (e instanceof RpcError && e.unknownTx) return null;
        throw e;
      }
    },
  };
}
