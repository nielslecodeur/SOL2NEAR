// LIVE cross-chain card: real Tidepool client (packages/crosschain). Nothing here is simulated: every
// status comes from Tidepool, Solana devnet or NEAR testnet, and every signature from the user's wallet.
// The four steps are shown separately: a Tidepool SUCCESS is not a NEAR receipt, and a NEAR receipt is
// not a Treasury deposit.
import { useEffect, useRef, useState } from "react";
import { Transaction } from "@solana/web3.js";
import {
  createTidepoolClient,
  CrosschainFailure,
  explorerLinks,
  isFinished,
  memoryStore,
  webStorageStore,
  type BridgeQuote,
  type SolanaWallet,
  type TransferRecord,
  type TransferStore,
} from "../../../packages/crosschain/src/index.ts";
import { TREASURY_ACCOUNT_ID } from "./chain.ts";
import { bridgeTone, formatUnits, parseUnits, usdc } from "./format.ts";

/** Quote amounts are shown with all 6 USDC decimals (no rounding on a price the user is about to accept). */
const exact = (a: string) => formatUnits(a, 6, 6);
import { bridgeCoversTreasuryMin } from "./near/deposit.ts";
import { view } from "./chain.ts";

function browserStore(): TransferStore {
  try {
    localStorage.setItem("sol2near.probe", "1");
    return webStorageStore(localStorage);
  } catch {
    return memoryStore(); // private window / blocked storage: works, but a reload forgets the transfer
  }
}
const tidepool = createTidepoolClient({ store: browserStore() });
/** Only for DRY previews before a Solana wallet is connected: the Tidepool devnet USDC mint address. */
const DRY_PREVIEW_REFUND_PLACEHOLDER = "7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr";

type InjectedWallet = {
  publicKey: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
};
/** Phantom first, then any injected provider with the same API (window.solana). */
const injected = (): InjectedWallet | undefined => {
  const w = window as unknown as { phantom?: { solana?: InjectedWallet }; solana?: InjectedWallet };
  const p = w.phantom?.solana ?? w.solana;
  return typeof p?.connect === "function" && typeof p?.signAndSendTransaction === "function" ? p : undefined;
};
const walletOf = (p: InjectedWallet): SolanaWallet => ({
  async signAndSendTransaction(bytes) {
    return (await p.signAndSendTransaction(Transaction.from(bytes))).signature;
  },
});

const explain = (e: unknown) =>
  e instanceof CrosschainFailure ? `${e.kind}: ${e.message}` : (e as Error)?.message ?? String(e);

const STEP_LABEL: Record<TransferRecord["stage"], string> = {
  signing: "1 · waiting for / interrupted in the wallet",
  sent: "1 · Solana deposit sent, not confirmed yet",
  solana_confirmed: "2 · Solana deposit confirmed · Tidepool processing",
  solana_failed: "1 · Solana deposit FAILED on-chain (nothing bridged)",
  bridge_success: "3 · Tidepool SUCCESS · checking USDC on NEAR",
  bridge_refunded: "2 · REFUNDED to your Solana address",
  bridge_failed: "2 · Tidepool FAILED",
  near_verified: "3 · USDC verified on NEAR · step 4 is yours: deposit into the Treasury",
};

export function BridgeLive({ nearAccount, onHealth }: { nearAccount: string; onHealth?: (reachable: boolean) => void }) {
  const [health, setHealth] = useState("checking Tidepool…");
  const [solAddr, setSolAddr] = useState<string | null>(null);
  // 2, not 1: 1 USDC from Solana arrives as ~0.9974 on NEAR, below the Treasury minimum deposit of 1 USDC.
  const [amount, setAmount] = useState("2");
  const [minDeposit, setMinDeposit] = useState<string | null>(null);
  const [preview, setPreview] = useState<BridgeQuote | null>(null);
  const [transfers, setTransfers] = useState<TransferRecord[]>(() => tidepool.transfers());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef(new AbortController());
  const refresh = () => setTransfers(tidepool.transfers().sort((a, b) => b.updatedAt - a.updatedAt));

  /** Tidepool status until terminal, then the NEAR balance check. Safe to call again after a reload. */
  async function follow(depositAddress: string) {
    const r = await tidepool.track(depositAddress, refresh, { signal: abort.current.signal });
    refresh();
    if (r.status === "SUCCESS") {
      await tidepool.verifyOnNear(depositAddress);
      refresh();
    }
  }

  useEffect(() => {
    view<{ config: { min_deposit: string } }>(TREASURY_ACCOUNT_ID, "get_config").then((c) => setMinDeposit(c.config.min_deposit), () => setMinDeposit(null));
    tidepool.health().then(
      (h) => { onHealth?.(true); setHealth(h.ok && h.solanaRouteOk ? "up · Solana devnet route ok" : `degraded · ok=${h.ok} solanaRoute=${h.solanaRouteOk}`); },
      (e) => { onHealth?.(false); setHealth(`unreachable from this network (${explain(e)}). Path B is unavailable here; the direct NEAR deposit still works.`); },
    );
    // Resume every transfer a previous page load left in progress.
    for (const t of tidepool.transfers())
      if (t.stage === "solana_confirmed" || t.stage === "sent" || t.stage === "bridge_success")
        follow(t.depositAddress).catch((e) => setError(explain(e)));
    return () => abort.current.abort();
  }, []);

  const atomic = parseUnits(amount, 6);
  const recipient = nearAccount.trim();
  const ready = !!atomic && !!recipient && !!solAddr && !busy;
  const coversMin = preview && minDeposit ? bridgeCoversTreasuryMin(preview.minAmountOut, minDeposit) : null;
  const req = () => ({ amountAtomic: atomic!, solanaRefundAddress: solAddr!, nearRecipient: recipient });

  async function run(step: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try { await step(); } catch (e) { setError(explain(e)); } finally { setBusy(false); refresh(); }
  }

  const connect = () => run(async () => {
    const p = injected();
    if (!p) throw new Error("No Solana wallet found: install Phantom and switch it to Devnet (Settings → Developer settings → Testnet mode).");
    setSolAddr((await p.connect()).publicKey.toBase58());
  });
  // A dry quote creates no deposit address and moves nothing, so it may be previewed before connecting a Solana
  // wallet: the refund address is then a labelled placeholder (the Tidepool USDC mint), never used for a live quote.
  const quote = () => run(async () =>
    setPreview(await tidepool.quote({ ...req(), solanaRefundAddress: solAddr ?? DRY_PREVIEW_REFUND_PLACEHOLDER }, { dry: true })));
  const bridge = () => run(async () => {
    const live = await tidepool.quote(req(), { dry: false });
    await tidepool.deposit(live, solAddr!, walletOf(injected()!));
    refresh();
    await follow(live.depositAddress!);
  });

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
        <button onClick={quote} disabled={!atomic || !recipient || busy}>Preview (dry quote)</button>
        <button onClick={bridge} disabled={!ready || !preview || coversMin === false}>Bridge {atomic ? usdc(atomic) : "—"} USDC</button>
      </div>
      {preview && <p>Quote: {exact(preview.amountIn)} USDC → <b>{exact(preview.amountOut)}</b> USDC on NEAR (guaranteed min {exact(preview.minAmountOut)}), cost {exact((BigInt(preview.amountIn) - BigInt(preview.amountOut)).toString())} USDC, ~{preview.timeEstimateSec}s. Read from the quote, not hard-coded.</p>}
      {coversMin === true && <p className="muted">✓ The guaranteed minimum ({exact(preview!.minAmountOut)} USDC) covers the Treasury minimum deposit ({exact(minDeposit!)} USDC).</p>}
      {coversMin === false && <p className="badge failed">The guaranteed minimum ({exact(preview!.minAmountOut)} USDC) is below the Treasury minimum deposit ({exact(minDeposit!)} USDC): these funds could not be deposited. Increase the amount.</p>}
      {transfers.map((t) => {
        const links = t.result ? explorerLinks(t.result) : null;
        return (
          <div key={t.depositAddress} className="transfer">
            <p>
              <span className={`badge ${t.result ? bridgeTone(t.result.status) : isFinished(t) ? "failed" : "pending"}`}>{STEP_LABEL[t.stage]}</span>{" "}
              {usdc(t.quote.amountIn)} USDC → <code>{t.quote.nearRecipient ?? "?"}</code>
              {t.nearReceived && <> · received <b>{usdc(t.nearReceived)}</b> USDC on NEAR</>}
              {t.result?.refundedAmount && <> · refunded {usdc(t.result.refundedAmount)} USDC</>}{" "}
              {t.signature && <a href={`https://explorer.solana.com/tx/${t.signature}?cluster=devnet`} target="_blank" rel="noreferrer">Solana tx</a>}{" "}
              {links?.near.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">NEAR tx</a>)}
            </p>
            {t.stage === "near_verified" && (
              <p className="muted">
                Step 4 (your NEAR wallet): <code>near contract call-function as-transaction usdc.tidepool-sandbox.testnet ft_transfer_call json-args
                {` '{"receiver_id":"${TREASURY_ACCOUNT_ID}","amount":"${t.nearReceived}","msg":"{\\"action\\":\\"deposit\\"}"}'`} prepaid-gas '100 Tgas'
                attached-deposit '1 yoctoNEAR' sign-as {t.quote.nearRecipient} network-config testnet</code>. Then click Load: the deposit appears in the table above once the Treasury has counted it.
              </p>
            )}
          </div>
        );
      })}
      {error && <p className="badge failed">{error}</p>}
    </>
  );
}
