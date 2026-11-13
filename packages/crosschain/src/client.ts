import type {
  BridgeQuote,
  BridgeQuoteRequest,
  BridgeResult,
  CrosschainClient,
} from "../../shared/src/crosschain.ts";
import { NEAR_USDC, SOL_USDC, TIDEPOOL_BASE_URL } from "../../shared/src/assets.ts";
import { fail } from "./errors.ts";
import { requestJson, type FetchLike, type HttpConfig } from "./http.ts";
import { nearRpcReader, verifySettlement, type NearReader } from "./near.ts";
import { assertFundable, buildQuoteBody, parseQuote } from "./quote.ts";
import { buildSplDepositTx, SolanaDevnet } from "./solana.ts";
import { parseStatus, watchStatus, type WatchOptions } from "./status.ts";
import { memoryStore, type TransferRecord, type TransferStage, type TransferStore } from "./store.ts";
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
  nearRpcUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Injected in tests; defaults to a devnet connection. */
  solana?: Pick<SolanaDevnet, "latestBlockhash" | "usdcBalance" | "confirmSignature">;
  /** Injected in tests; defaults to NEAR testnet RPC. */
  near?: NearReader;
  /** Where transfers are remembered. Default: memory (lost on reload). The web app passes localStorage. */
  store?: TransferStore;
  now?: () => number;
}

export interface TidepoolClient extends CrosschainClient {
  tokens(): Promise<TidepoolToken[]>;
  /** Throws `unsupported_route` unless both legs of Solana USDC -> NEAR USDC are listed. */
  assertRouteSupported(): Promise<void>;
  /** One GET /v0/status, no polling. */
  status(depositAddress: string): Promise<BridgeResult>;
  /**
   * Build -> wallet sign & send -> wait for Solana confirmation -> submit. At most ONE signature per
   * deposit address, even across page reloads when the store is persistent. Returns the signature.
   */
  deposit(quote: BridgeQuote, payer: string, wallet: SolanaWallet): Promise<string>;
  /** Polls Tidepool until a terminal status and records it. SUCCESS is NOT yet proof of NEAR receipt. */
  track(depositAddress: string, onUpdate: (r: BridgeResult) => void, opts?: WatchOptions): Promise<BridgeResult>;
  /** Reads the NEAR recipient's USDC balance and checks it rose by at least minAmountOut. */
  verifyOnNear(depositAddress: string): Promise<string>;
  /** Every remembered transfer (for resuming after a reload). */
  transfers(): TransferRecord[];
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
  const near = opts.near ?? nearRpcReader(opts.nearRpcUrl);
  const store = opts.store ?? memoryStore();
  const inflight = new Map<string, Promise<string>>();
  const submitted = new Map<string, Promise<void>>();

  const save = (r: TransferRecord, stage: TransferStage, extra: Partial<TransferRecord> = {}) => {
    const next = { ...r, ...extra, stage, updatedAt: now() };
    store.put(next);
    return next;
  };

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
      return parseQuote(raw, { amountAtomic: req.amountAtomic, dry, body });
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
      const addr = quote.depositAddress;
      const running = inflight.get(addr);
      if (running) return running;
      const known = store.get(addr);
      if (known?.signature) return Promise.resolve(known.signature);
      if (known?.stage === "signing")
        return Promise.reject(fail("interrupted",
          `a signing attempt for ${addr} was interrupted: check your wallet history and status(${addr}) before doing anything; never re-sign this quote`));

      const run = (async () => {
        // Everything before the wallet call broadcasts nothing and may be retried.
        const tx = await client.buildDepositTransaction(quote, payer);
        const nearBalanceBefore = quote.nearRecipient ? await near.usdcBalance(quote.nearRecipient) : undefined;
        let rec = save({ depositAddress: addr, quote, payer, stage: "signing", updatedAt: now() }, "signing",
          nearBalanceBefore !== undefined ? { nearBalanceBefore } : {});
        let sig: string;
        try {
          sig = await signAndSend(wallet, tx);
        } catch (e) {
          // A rejection broadcast nothing: forget the attempt. Anything else stays "signing" (interrupted).
          if ((e as { kind?: string }).kind === "wallet_rejected") store.delete(addr);
          throw e;
        }
        rec = save(rec, "sent", { signature: sig });
        try {
          await devnet().confirmSignature(sig);
        } catch (e) {
          if ((e as { kind?: string }).kind === "solana_tx_failed") save(rec, "solana_failed");
          throw e; // a timeout keeps "sent": the signature is known, it is never re-signed
        }
        save(rec, "solana_confirmed");
        // The speed-up submit is optional: Tidepool also detects the deposit on its own.
        await client.submitDeposit(sig, addr).catch(() => undefined);
        return sig;
      })();
      inflight.set(addr, run);
      run.then(() => inflight.delete(addr), () => inflight.delete(addr));
      return run;
    },

    async track(depositAddress, onUpdate, o) {
      const result = await client.watch(depositAddress, onUpdate, o);
      const rec = store.get(depositAddress);
      if (rec && rec.stage !== "near_verified") {
        const stage = result.status === "SUCCESS" ? "bridge_success" : result.status === "REFUNDED" ? "bridge_refunded" : "bridge_failed";
        save(rec, stage, { result });
      }
      return result;
    },

    async verifyOnNear(depositAddress) {
      const rec = store.get(depositAddress);
      if (!rec) throw fail("validation", `no transfer recorded for ${depositAddress}`);
      if (rec.stage === "near_verified" && rec.nearReceived) return rec.nearReceived;
      if (rec.stage !== "bridge_success") throw fail("validation", `transfer is at stage ${rec.stage}, not bridge_success`);
      if (!rec.quote.nearRecipient || rec.nearBalanceBefore === undefined)
        throw fail("validation", "no NEAR recipient or balance baseline recorded for this transfer");
      const after = await near.usdcBalance(rec.quote.nearRecipient);
      const received = verifySettlement(rec.nearBalanceBefore, after, rec.quote.minAmountOut);
      save(rec, "near_verified", { nearReceived: received });
      return received;
    },

    transfers: () => store.list(),
  };
  return client;
}
