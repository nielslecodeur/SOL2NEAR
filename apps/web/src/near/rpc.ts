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
  /** View call at the latest final block, or at `blockId` when given (interdependent views then read one consistent state). */
  view<T>(contract: string, method: string, args?: object, blockId?: number): Promise<T>;
  /** Height and timestamp (ns) of the latest final block. */
  finalBlock?(): Promise<{ height: number; timestampNs: bigint }>;
  /** Liquid NEAR (yocto) of an account, or null if it does not exist. */
  nearBalance(accountId: string): Promise<bigint | null>;
  /** Code hash of a deployed contract, or null if the account has no contract / does not exist. */
  codeHash(accountId: string): Promise<string | null>;
  /** Final outcome of a tx, or null while it is unknown / not final yet (never treated as a failure). */
  txStatus(hash: string, signerId: string): Promise<TxOutcome | null>;
  /** Timestamp (ns) of the latest final block: the chain's clock, used for locks and deadlines. */
  blockTimestampNs(): Promise<bigint>;
}

/** Public testnet providers, tried in order (both listed by docs.near.org; rpc.testnet.near.org was deprecated). */
export const NEAR_RPC_URLS = [NEAR_RPC_URL, "https://test.rpc.fastnear.com"];

/** Provider-side trouble (not an answer about the chain): worth trying the next provider. */
const PROVIDER_TROUBLE = /free plan|rate limit|too many requests|timeout|\b429\b|\b50[234]\b/i;

export function nearRpc(urls: string | string[] = NEAR_RPC_URLS, doFetch: FetchLike = (u, i) => fetch(u, i)): NearRpc {
  const list = Array.isArray(urls) ? urls : [urls];
  async function callOne(url: string, method: string, params: unknown): Promise<{ result?: any; error?: any }> {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "sol2near", method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function call(method: string, params: unknown) {
    let json: { result?: any; error?: any } | undefined;
    let lastProblem = "";
    for (const url of list) {
      try {
        json = await callOne(url, method, params);
      } catch (e) {
        lastProblem = `${new URL(url).host}: ${(e as Error).message}`;
        continue; // network error, timeout, 429, 5xx: next provider
      }
      const err = json.error ?? json.result?.error;
      if (err && PROVIDER_TROUBLE.test(JSON.stringify(err)) && !/UNKNOWN_TRANSACTION/.test(JSON.stringify(err))) {
        lastProblem = `${new URL(url).host}: ${JSON.stringify(err).slice(0, 120)}`;
        json = undefined;
        continue;
      }
      break;
    }
    if (!json) throw new RpcError(`NEAR RPC ${method}: every provider failed (${lastProblem})`);
    const err = json.error ?? json.result?.error;
    if (err) {
      const text = typeof err === "string" ? err : JSON.stringify(err.cause ?? err);
      throw new RpcError(`NEAR RPC ${method}: ${text.slice(0, 240)}`, /UNKNOWN_TRANSACTION|doesn't exist|TIMEOUT_ERROR/.test(text));
    }
    return json.result;
  }
  return {
    async view<T>(contract: string, method: string, args: object = {}, blockId?: number) {
      const r = await call("query", {
        request_type: "call_function", ...(blockId === undefined ? { finality: "final" } : { block_id: blockId }), account_id: contract, method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      });
      return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
    },
    async codeHash(accountId) {
      try {
        const r = await call("query", { request_type: "view_account", finality: "final", account_id: accountId });
        return r.code_hash && r.code_hash !== "11111111111111111111111111111111" ? r.code_hash : null;
      } catch (e) {
        if (/UNKNOWN_ACCOUNT|does not exist/.test((e as Error).message)) return null;
        throw e;
      }
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
    async blockTimestampNs() {
      const r = await call("block", { finality: "final" });
      return BigInt(r.header.timestamp_nanosec);
    },
    async finalBlock() {
      const r = await call("block", { finality: "final" });
      return { height: Number(r.header.height), timestampNs: BigInt(r.header.timestamp_nanosec) };
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
