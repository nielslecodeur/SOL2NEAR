// LIVE cross-chain card: real Tidepool client (packages/crosschain). Nothing here is simulated:
// every status shown comes from Tidepool, and every signature from the user's Phantom wallet.
import { useEffect, useRef, useState } from "react";
import { Transaction } from "@solana/web3.js";
import {
  createTidepoolClient,
  CrosschainFailure,
  explorerLinks,
  type BridgeQuote,
  type BridgeResult,
  type SolanaWallet,
} from "../../../packages/crosschain/src/index.ts";
import { TREASURY_ACCOUNT_ID } from "./chain.ts";
import { bridgeTone, parseUnits, usdc } from "./format.ts";

const tidepool = createTidepoolClient();

type Phantom = {
  isPhantom?: boolean;
  publicKey: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
};
/** Phantom first, then any injected provider with the same API (window.solana). */
const phantom = (): Phantom | undefined => {
  const w = window as unknown as { phantom?: { solana?: Phantom }; solana?: Phantom };
  const p = w.phantom?.solana ?? w.solana;
  return typeof p?.connect === "function" && typeof p?.signAndSendTransaction === "function" ? p : undefined;
};

const walletOf = (p: Phantom): SolanaWallet => ({
  async signAndSendTransaction(bytes) {
    return (await p.signAndSendTransaction(Transaction.from(bytes))).signature;
  },
});

const explain = (e: unknown) =>
  e instanceof CrosschainFailure ? `${e.kind}: ${e.message}` : (e as Error).message ?? String(e);

export function BridgeLive({ nearAccount }: { nearAccount: string }) {
  const [health, setHealth] = useState<string>("checking Tidepool…");
  const [solAddr, setSolAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [preview, setPreview] = useState<BridgeQuote | null>(null);
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    tidepool.health().then(
      (h) => setHealth(h.ok && h.solanaRouteOk ? "up · Solana devnet route ok" : `degraded · ok=${h.ok} solanaRoute=${h.solanaRouteOk}`),
      (e) => setHealth(`unreachable · ${explain(e)}`),
    );
    return () => abort.current?.abort();
  }, []);

  const atomic = parseUnits(amount, 6);
  const recipient = nearAccount.trim();
  const ready = !!atomic && !!recipient && !!solAddr && !busy;
  const req = () => ({ amountAtomic: atomic!, solanaRefundAddress: solAddr!, nearRecipient: recipient });

  async function run(step: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try { await step(); } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  }

  const connect = () => run(async () => {
    const p = phantom();
    if (!p) throw new Error("No Solana wallet found: install Phantom and switch it to Devnet (Settings → Developer settings → Testnet mode).");
    setSolAddr((await p.connect()).publicKey.toBase58());
  });

  const quote = () => run(async () => setPreview(await tidepool.quote(req(), { dry: true })));

  const bridge = () => run(async () => {
    const live = await tidepool.quote(req(), { dry: false });
    const sig = await tidepool.deposit(live, solAddr!, walletOf(phantom()!));
    setSignature(sig);
    abort.current = new AbortController();
    await tidepool.watch(live.depositAddress!, setResult, { signal: abort.current.signal });
  });

  const links = result ? explorerLinks(result) : null;
  return (
    <>
      <p className="muted">Tidepool: <b>{health}</b></p>
      <div className="watch">
        <button onClick={connect} disabled={busy}>{solAddr ? `Wallet ${solAddr.slice(0, 4)}…${solAddr.slice(-4)}` : "Connect Solana wallet (Devnet)"}</button>
        <input aria-label="Amount USDC" value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} placeholder="USDC" />
      </div>
      <p className="muted">
        NEAR recipient: <code>{recipient || "enter your account above"}</code>. Tidepool delivers to <b>your</b> account, then you deposit into the Treasury.
      </p>
      <div className="watch">
        <button onClick={quote} disabled={!ready}>Preview (dry quote)</button>
        <button onClick={bridge} disabled={!ready || !preview}>Bridge {atomic ? usdc(atomic) : "—"} USDC</button>
      </div>
      {preview && <p>Quote: {usdc(preview.amountIn)} USDC → <b>{usdc(preview.amountOut)}</b> USDC on NEAR (min {usdc(preview.minAmountOut)}), ~{preview.timeEstimateSec}s. Cost read from the quote, not hard-coded.</p>}
      {signature && <p className="muted">Solana deposit signature: <code>{signature}</code></p>}
      {result && (
        <p>
          <span className={`badge ${bridgeTone(result.status)}`}>{result.status}</span>{" "}
          {result.amountOut && `→ ${usdc(result.amountOut)} USDC`} {result.refundReason && `(${result.refundReason})`}{" "}
          {links?.solana.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">Solana tx</a>)}{" "}
          {links?.near.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">NEAR tx</a>)}
        </p>
      )}
      {result?.status === "SUCCESS" && (
        <p className="muted">
          Next step: <code>near contract call-function as-transaction usdc.tidepool-sandbox.testnet ft_transfer_call json-args
          {` '{"receiver_id":"${TREASURY_ACCOUNT_ID}","amount":"${result.amountOut ?? "<amount>"}","msg":"{\\"action\\":\\"deposit\\"}"}'`} prepaid-gas '100 Tgas'
          attached-deposit '1 yoctoNEAR' sign-as {recipient} network-config testnet</code>
        </p>
      )}
      {error && <p className="badge failed">{error}</p>}
    </>
  );
}
