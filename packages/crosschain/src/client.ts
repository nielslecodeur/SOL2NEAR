import type {
  BridgeQuote,
  BridgeQuoteRequest,
  BridgeResult,
  CrosschainClient,
} from "../../shared/src/crosschain.ts";
import { NEAR_USDC, SOL_USDC, TIDEPOOL_BASE_URL } from "../../shared/src/assets.ts";
import { fail } from "./errors.ts";
import { requestJson, type FetchLike, type HttpConfig } from "./http.ts";
import { assertFundable, buildQuoteBody, parseQuote } from "./quote.ts";
import { buildSplDepositTx, SolanaDevnet } from "./solana.ts";
import { parseStatus, watchStatus, type WatchOptions } from "./status.ts";
import { signAndSend, type SolanaWallet } from "./wallet.ts";

export interface TidepoolToken {
  assetId: string;
  decimals: number;
  blockchain?: string;
  symbol?: string;
  contractAddress?: string;
}

export interface TidepoolClientOptions {
  baseUrl?: string;
  solanaRpcUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Injected in tests; defaults to a devnet connection. */
  solana?: Pick<SolanaDevnet, "latestBlockhash" | "usdcBalance">;
  now?: () => number;
}

export interface TidepoolClient extends CrosschainClient {
  tokens(): Promise<TidepoolToken[]>;
  /** Throws `unsupported_route` unless both legs of Solana USDC -> NEAR USDC are listed. */
  assertRouteSupported(): Promise<void>;
  /** One GET /v0/status, no polling. */
  status(depositAddress: string): Promise<BridgeResult>;
  /**
   * Build -> wallet sign & send -> submit, at most ONCE per deposit address: a second call with the
   * same quote returns the first call's signature without asking the wallet again.
   */
  deposit(quote: BridgeQuote, payer: string, wallet: SolanaWallet): Promise<string>;
}

export function createTidepoolClient(opts: TidepoolClientOptions = {}): TidepoolClient {
  const http: HttpConfig = {
    baseUrl: opts.baseUrl ?? TIDEPOOL_BASE_URL,
    ...(opts.fetch && { fetch: opts.fetch }),
    ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }),
  };
  const now = opts.now ?? Date.now;
  let solana = opts.solana;
  const devnet = () => (solana ??= new SolanaDevnet(opts.solanaRpcUrl));
  const deposits = new Map<string, Promise<string>>();
  const submitted = new Map<string, Promise<void>>();

  const client: TidepoolClient = {
    async health() {
      const h = await requestJson<{ ok?: unknown; bridges?: { chains?: { sol?: { ok?: unknown } } } }>(http, "GET", "/v0/health");
      return { ok: h.ok === true, solanaRouteOk: h.bridges?.chains?.sol?.ok === true };
    },

    async tokens() {
      const list = await requestJson<unknown>(http, "GET", "/v0/tokens");
      if (!Array.isArray(list)) throw fail("http", "GET /v0/tokens did not return an array");
      return list.filter((t): t is TidepoolToken => typeof t?.assetId === "string" && typeof t?.decimals === "number");
    },

    async assertRouteSupported() {
      const tokens = await client.tokens();
      for (const [want, decimals] of [[SOL_USDC.assetId, SOL_USDC.decimals], [NEAR_USDC.assetId, NEAR_USDC.decimals]] as const) {
        const t = tokens.find((x) => x.assetId === want);
        if (!t) throw fail("unsupported_route", `Tidepool does not list ${want}`);
        if (t.decimals !== decimals) throw fail("unsupported_route", `${want} has ${t.decimals} decimals on Tidepool, expected ${decimals}`);
      }
    },

    async quote(req: BridgeQuoteRequest, { dry }: { dry: boolean }) {
      const body = buildQuoteBody(req, dry, now());
      const raw = await requestJson<unknown>(http, "POST", "/v0/quote", body);
      return parseQuote(raw, { amountAtomic: req.amountAtomic, dry });
    },

    async buildDepositTransaction(quote: BridgeQuote, payer: string) {
      assertFundable(quote, now());
      const sol = devnet();
      const balance = BigInt(await sol.usdcBalance(payer));
      if (balance < BigInt(quote.amountIn))
        throw fail("validation", `insufficient devnet USDC: payer has ${balance}, quote needs ${quote.amountIn} (atomic)`);
      return buildSplDepositTx({
        payer,
        depositAddress: quote.depositAddress,
        amountAtomic: quote.amountIn,
        recentBlockhash: await sol.latestBlockhash(),
      });
    },

    submitDeposit(txHash: string, depositAddress: string) {
      const key = `${depositAddress}:${txHash}`;
      let p = submitted.get(key);
      if (!p) {
        p = requestJson<unknown>(http, "POST", "/v0/deposit/submit", { txHash, depositAddress }).then(() => undefined);
        p.catch(() => submitted.delete(key)); // a failed submit may be retried
        submitted.set(key, p);
      }
      return p;
    },

    async status(depositAddress: string) {
      const raw = await requestJson<unknown>(http, "GET", `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
      return parseStatus(raw, depositAddress);
    },

    watch(depositAddress: string, onUpdate: (r: BridgeResult) => void, o?: WatchOptions) {
      return watchStatus(() => client.status(depositAddress), onUpdate, o);
    },

    deposit(quote: BridgeQuote, payer: string, wallet: SolanaWallet) {
      try {
        assertFundable(quote, now());
      } catch (e) {
        return Promise.reject(e);
      }
      const existing = deposits.get(quote.depositAddress);
      if (existing) return existing;
      let retryable = true;
      const run = (async () => {
        const tx = await client.buildDepositTransaction(quote, payer);
        try {
          return await signAndSend(wallet, tx);
        } catch (e) {
          // A rejection broadcast nothing. Any other wallet error might have broadcast: never resend
          // automatically, the caller must check status(depositAddress) first.
          retryable = (e as { kind?: string }).kind === "wallet_rejected";
          throw e;
        }
      })().then(async (sig) => {
        // The speed-up submit is optional: Tidepool also detects the deposit on its own.
        await client.submitDeposit(sig, quote.depositAddress!).catch(() => undefined);
        return sig;
      });
      run.catch(() => { if (retryable) deposits.delete(quote.depositAddress!); });
      deposits.set(quote.depositAddress, run);
      return run;
    },
  };
  return client;
}
