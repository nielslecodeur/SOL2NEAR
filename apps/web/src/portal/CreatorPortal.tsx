// V4.3A Creator Portal: the guided journey Connect → Choose pool → Amount → Review → Track.
// It REUSES the real modules: the NEAR panel (wallet, deposit, execute_lp, FUEL — every signature is a reviewed wallet
// approval), the Phantom bridge card (Tidepool), the V4.0 pool readers, the V4.2A DCL explorer. It adds no signing code.
// Two strictly separate modes: Live NEAR testnet (deployed contracts only) and Explore NEAR memecoins (read-only).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createTidepoolClient, memoryStore, SolanaDevnet,
} from "../../../../packages/crosschain/src/index.ts";
import {
  EVIDENCE_LABEL, FEATURES, fromV3Deposit, poolOffers, simulateLiveContribution,
  type BridgeQuoteLike, type ClassicLeg, type Evidence, type PortalMode, type SimRow,
} from "../../../../packages/near-client/src/index.ts";
import { BridgeLive, injected } from "../BridgeLive.tsx";
import { TREASURY_ACCOUNT_ID, view, type Snapshot } from "../chain.ts";
import { formatUnits, parseUnits } from "../format.ts";
import { poolReaders, type Catalog } from "../pools/live.ts";
import { DclPositionPreview, V42Dcl } from "../v4/Dcl.tsx";
import { UnifiedCard } from "./UnifiedCard.tsx";

const USDC_TP = "usdc.tidepool-sandbox.testnet";
const tidepool = createTidepoolClient({ store: memoryStore() }); // dry quotes only: no deposit address, nothing stored
const solana = new SolanaDevnet();
/** Public read-only build: no wallet code is bundled (vite.config.ts), wallets are never offered. */
const READ_ONLY = import.meta.env.VITE_PUBLIC_READ_ONLY === "1";
const readers = poolReaders();
/** Placeholder refund address for DRY quotes only (the Tidepool devnet USDC mint, as in the bridge card). */
const DRY_REFUND = "7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr";

function readStore(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function writeStore(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* per-viewer convenience only */ } }

const EV_TONE: Record<Evidence, string> = { TESTNET_TX: "confirmed", DEVNET_BRIDGE: "confirmed", LIVE_READ: "refunded", SANDBOX: "pending", SIMULATION: "neutral", NOT_AVAILABLE: "failed" };
export const EvidenceBadge = ({ e }: { e: Evidence }) => <span className={`badge ${EV_TONE[e]}`} data-evidence={e}>{EVIDENCE_LABEL[e]}</span>;

const STEPS = ["Connect", "Choose pool", "Amount & simulation", "Review & sign", "Track position"] as const;

export function CreatorPortal({ wallet, account, snap, nearPanel, onWatch }: {
  wallet: string | null; account: string; snap: Snapshot | null; nearPanel: ReactNode; onWatch: (a: string) => void;
}) {
  const [mode, setModeState] = useState<PortalMode>(() => (readStore("sol2near:portal-mode") as PortalMode) ?? "LIVE_TESTNET");
  const [step, setStepState] = useState(() => Math.min(4, Math.max(0, Number(readStore("sol2near:portal-step") ?? 0) || 0)));
  const setMode = (m: PortalMode) => { writeStore("sol2near:portal-mode", m); setModeState(m); };
  const setStep = (s: number) => { writeStore("sol2near:portal-step", String(s)); setStepState(s); };
  const live = mode === "LIVE_TESTNET";
  return (
    <main className="portal">
      <Hero />
      <section className="card" aria-label="Mode">
        <div className="modes" role="tablist" aria-label="Portal mode">
          <button role="tab" aria-selected={live} className={live ? "on" : ""} onClick={() => setMode("LIVE_TESTNET")}>Live · NEAR testnet</button>
          <button role="tab" aria-selected={!live} className={!live ? "on" : ""} onClick={() => setMode("EXPLORE_MEMECOINS")}>Explore · NEAR memecoins (read-only)</button>
        </div>
        {live
          ? <p className="muted" data-testid="mode-note">Deployed contracts on <b>NEAR testnet</b> only. {READ_ONLY ? "State is read live; signing is not available in this public demo (the full app, run locally, asks your own wallet to approve each transaction after a review)." : "Real transactions, each approved in your own wallet after a review."} The only fundable pool today is Ref Classic <b>#2951 USDC/wNEAR — not a memecoin</b>.</p>
          : <div className="banner sim" data-testid="mode-note">EXPLORE MODE — real NEAR memecoin pools read on <b>mainnet</b> (view calls), reference simulations and LOCAL SANDBOX evidence. Nothing in this mode can be signed or executed.</div>}
        <ol className="stepper" aria-label="Journey">
          {STEPS.map((s, i) => (
            <li key={s}><button className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}>{i + 1} · {s}</button></li>
          ))}
        </ol>
      </section>

      {/* The real NEAR panel stays mounted (wallet session); it is shown where the journey needs it. */}
      <div hidden={!(live && (step === 0 || step === 3))}>{nearPanel}</div>

      {step === 0 && <StepConnect live={live} wallet={wallet} />}
      {step === 1 && (live ? <StepPoolLive /> : <V42Dcl withPreview={false} />)}
      {step === 2 && (live ? <StepSimulate wallet={wallet} /> : <ExploreSimulateNote />)}
      {step === 3 && (live ? <StepReview wallet={wallet} account={account} /> : <ExploreReview />)}
      {step === 4 && (live ? <StepTrack account={account} snap={snap} onWatch={onWatch} /> : <section className="card"><DclPositionPreview /></section>)}

      <div className="watch navsteps">
        <button className="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>← Back</button>
        <button disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>Next: {STEPS[Math.min(step + 1, STEPS.length - 1)]} →</button>
      </div>
    </main>
  );
}

function Hero() {
  return (
    <section className="card hero" aria-label="What SOL2NEAR does">
      <h2>Bring your Solana USDC to NEAR memecoin liquidity — with proof of where it went</h2>
      <p>
        You send USDC you control from Solana. It is bridged to NEAR, split <b>90 % liquidity / 8 % your reserve / 2 % community</b> by a contract with no
        admin method (on testnet its account still has a developer key, so it is not locked yet), and put into a NEAR pool. The liquidity position is held for you, verified on-chain, locked for a fixed time, and shown here with
        every transaction. SOL2NEAR is a router for liquidity, not a bridge, a launchpad or a DEX.
      </p>
      <div className="route" aria-label="Networks">
        <span>Solana <b>devnet</b> · Phantom</span><span>→</span><span>Tidepool <small>(community sandbox, not NEAR Intents)</small></span><span>→</span>
        <span>NEAR <b>testnet</b> · your NEAR wallet</span><span>→</span><span>Treasury 90/8/2</span><span>→</span><span>Ref pool</span>
      </div>
      <p className="muted">
        What you may get: the pool's trading fees attributable to your position (variable, can be zero) and FUEL where the FUEL rules allow it. What you
        risk: the value of the pooled assets moves with the market, a memecoin can lose most of its value, and test tokens have no value at all. No yield
        is promised. Creator fees from Pump.fun / Bags are <b>not</b> captured automatically: you choose and send the amount yourself.
      </p>
      <details open>
        <summary><b>What is real today</b> (each line says what kind of evidence backs it)</summary>
        <table className="status" aria-label="Feature status">
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f.id} data-feature={f.id}><td>{f.label}</td><td><EvidenceBadge e={f.evidence} /></td><td className="muted small">{f.proof}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function useSolanaWallet() {
  const [addr, setAddr] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const detected = typeof window !== "undefined" && !!injected();
  useEffect(() => {
    injected()?.connect({ onlyIfTrusted: true }).then((r) => setAddr(r.publicKey.toBase58()), () => { /* not approved yet */ });
  }, []);
  useEffect(() => {
    if (!addr) return;
    setBalance(null);
    solana.usdcBalance(addr).then(setBalance, (e: Error) => setErr(e.message));
  }, [addr]);
  const connect = async () => {
    setErr(null);
    const p = injected();
    if (!p) return setErr("No Solana wallet in this browser: install Phantom, then enable Testnet mode (Settings → Developer settings).");
    try { setAddr((await p.connect()).publicKey.toBase58()); } catch (e) { setErr((e as Error).message); }
  };
  return { detected, addr, balance, err, connect };
}

function StepConnect({ live, wallet }: { live: boolean; wallet: string | null }) {
  const sol = useSolanaWallet();
  const [storage, setStorage] = useState<boolean | null>(null);
  useEffect(() => {
    if (!wallet) return setStorage(null);
    view<unknown>(USDC_TP, "storage_balance_of", { account_id: wallet }).then((r) => setStorage(r !== null), () => setStorage(null));
  }, [wallet]);
  return (
    <section className="card" aria-label="Step 1 Connect">
      <h3>1 · Connect your wallets</h3>
      <p className="muted">Two wallets, because two chains: Phantom signs the Solana transfer, a NEAR wallet signs the NEAR transactions (deposit, liquidity). Nothing signs silently; connecting is not signing.</p>
      <div className="wallets">
        <div className="card" aria-label="Solana wallet">
          <h4>Solana · Phantom</h4>
          {READ_ONLY ? <p data-testid="wallets-disabled"><span className="badge neutral">READ-ONLY DEMO</span> Not available here: this site contains no wallet code. Run the app locally to connect Phantom (devnet).</p>
            : !sol.detected && <p className="badge pending">Phantom not detected in this browser</p>}
          {!READ_ONLY && (sol.addr
            ? <p>Connected <code>{sol.addr}</code><br />USDC on Solana <b>devnet</b>: {sol.balance === null ? "reading…" : <b data-testid="sol-usdc">{formatUnits(sol.balance, 6, 6)}</b>} <small className="muted">(Tidepool devnet USDC mint 7paf…r4Xr, read from Solana devnet RPC)</small></p>
            : <button onClick={sol.connect} disabled={!sol.detected}>Connect Phantom</button>)}
          <p className="muted small">Phantom does not tell a website which network it is on: switch it to <b>Testnet mode / Devnet</b>. A transfer prepared for devnet cannot land on mainnet (its blockhash is devnet-only), but check before approving.</p>
          {sol.balance === "0" && <p className="badge pending">No devnet USDC on this address: the bridge step would have nothing to send.</p>}
          {sol.err && <p className="badge failed">{sol.err}</p>}
        </div>
        <div className="card" aria-label="NEAR wallet">
          <h4>NEAR · testnet account</h4>
          {wallet ? <p>Connected <code>{wallet}</code>{storage === false && <><br /><span className="badge pending">not registered on the USDC token yet (0.00125 NEAR storage, one approval)</span></>}{storage === true && <><br /><small className="muted">registered on {USDC_TP} ✓</small></>}</p>
            : <p className="muted">{live ? "Connect in the panel above (MyNearWallet or Meteor, testnet)." : "Not needed in Explore mode."}</p>}
          <p className="muted small">Needed because the Treasury, the pool and the position live on NEAR, and only a NEAR account can approve NEAR transactions. You also need a little testnet NEAR for gas (faucet).</p>
        </div>
      </div>
    </section>
  );
}

function StepPoolLive() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { readers.readCatalog().then(setCat, (e: Error) => setErr(e.message)); }, []);
  const offers = useMemo(() => (cat ? poolOffers("LIVE_TESTNET", cat.rows.map((r) => ({
    key: r.d.key, label: `${r.d.category === "MEMECOIN" ? "memecoin" : "pilot"} · ${r.d.dexContractId} #${r.d.poolId}`, status: r.a.status, reason: r.a.reasons[0], network: r.d.network,
  }))) : []), [cat]);
  return (
    <section className="card" aria-label="Step 2 Choose pool">
      <h3>2 · Choose a pool</h3>
      <p className="muted">A pool is offered only if it is on the SOL2NEAR allowlist, passes every live check, and the deployed Treasury can fund it. Everything else stays visible, with the reason, and cannot be selected.</p>
      {err && <p className="badge failed">Live read failed: {err}. Nothing is selectable on a failed read.</p>}
      {!cat && !err && <p className="muted">Reading pools…</p>}
      <ul className="offers">
        {offers.map((o) => (
          <li key={o.key} className={o.selectable ? "ok" : "ko"} data-offer={o.key}>
            {o.selectable ? <span className="badge confirmed">AVAILABLE ON TESTNET</span> : <span className="badge neutral">NOT AVAILABLE</span>} <code>{o.label}</code>
            {o.selectable ? <> — <b>USDC/wNEAR, not a memecoin</b>: the only pool the deployed Treasury can fund (fixed at deployment). Classic pool, fungible LP shares.</> : <> — {o.why}</>}
          </li>
        ))}
      </ul>
      <p className="muted small">NEAR memecoin pools (Nearly, meme.cooking) are in <b>Explore mode</b>: they are on mainnet or have no route from the testnet USDC.</p>
    </section>
  );
}

function StepSimulate({ wallet }: { wallet: string | null }) {
  const [amount, setAmount] = useState(() => readStore("sol2near:portal-amount") ?? "2");
  const [quote, setQuote] = useState<BridgeQuoteLike | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | undefined>();
  const [leg, setLeg] = useState<ClassicLeg | null>(null);
  const [minDep, setMinDep] = useState<bigint | null>(null);
  const [storage, setStorage] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(t); }, []);
  const atomic = parseUnits(amount, 6);
  async function run() {
    if (!atomic) return;
    writeStore("sol2near:portal-amount", amount);
    setBusy(true); setRan(true); setQuote(null); setLeg(null); setQuoteErr(undefined);
    try {
      const cfg = await view<{ config: { min_deposit: string } }>(TREASURY_ACCOUNT_ID, "get_config").catch(() => null);
      setMinDep(cfg ? BigInt(cfg.config.min_deposit) : null);
      if (wallet) setStorage(await view<unknown>(USDC_TP, "storage_balance_of", { account_id: wallet }).then((r) => r !== null, () => null));
      let q: BridgeQuoteLike | null = null;
      try {
        const r = await tidepool.quote({ amountAtomic: atomic, solanaRefundAddress: DRY_REFUND, nearRecipient: wallet ?? TREASURY_ACCOUNT_ID }, { dry: true });
        q = { amountIn: r.amountIn, amountOut: r.amountOut, minAmountOut: r.minAmountOut, timeEstimateSec: r.timeEstimateSec, quotedAt: Date.now() };
        setQuote(q);
      } catch (e) { setQuoteErr((e as Error).message); }
      if (q) {
        const cat = await readers.readCatalog();
        const row = cat.rows.find((r) => r.a.status === "ELIGIBLE");
        if (row && cat.treasury) {
          const lp = (BigInt(q.minAmountOut) * 9000n) / 10_000n;
          const pf = await readers.preflight(row.d, cat.treasury, lp);
          setLeg({ swapIn: pf.swapIn, expectedOut: pf.expectedOut, minOut: pf.minOut, usdcLeft: pf.usdcLeft, feeBps: pf.feeBps, poolFeeIn: pf.poolFeeIn, impactBps: pf.impactBps, level: pf.level, refReturn: pf.refReturn, otherSymbol: "wNEAR", otherDecimals: 24 });
        }
      }
    } finally { setBusy(false); }
  }
  const sim = ran && !busy ? simulateLiveContribution({ sourceUsdc: BigInt(atomic ?? "0"), quote, quoteError: quoteErr, now, classic: leg, treasuryMinDeposit: minDep, creatorUsdcStorage: storage }) : null;
  return (
    <section className="card" aria-label="Step 3 Simulate">
      <h3>3 · Amount and contribution simulation <span className="badge neutral">SIMULATION</span></h3>
      <div className="watch">
        <label htmlFor="pamt">USDC to send from Solana</label>
        <input id="pamt" value={amount} onChange={(e) => { setAmount(e.target.value); setRan(false); }} inputMode="decimal" />
        <button onClick={run} disabled={!atomic || busy}>{busy ? "Quoting…" : "Simulate (read-only)"}</button>
      </div>
      <p className="muted small">A dry Tidepool quote (no deposit address, nothing moves) and a fresh read of pool 2951 with Ref's own get_return. Nothing is invented: a value without a source is shown as unavailable.</p>
      {sim && <SimTable rows={sim.rows} />}
      {sim && sim.blocking.length > 0 && <ul className="problems" aria-label="Blocking">{sim.blocking.map((b) => <li key={b}>{b}</li>)}</ul>}
      {sim && sim.blocking.length === 0 && <p className="badge confirmed" data-testid="sim-ok">Preconditions met for a real testnet contribution of this size. Next: review the signatures.</p>}
    </section>
  );
}

export function SimTable({ rows }: { rows: SimRow[] }) {
  return (
    <table className="sim" aria-label="Contribution simulation">
      <tbody>
        {rows.map((r) => (
          <tr key={r.n} className={r.warn ? "warn" : ""}><td>{r.n}</td><td>{r.label}</td><td>{r.value}</td><td><span className={`badge ${r.basis === "unavailable" ? "failed" : "neutral"}`}>{r.basis}</span></td></tr>
        ))}
      </tbody>
    </table>
  );
}

function StepReview({ wallet, account }: { wallet: string | null; account: string }) {
  return (
    <section className="card" aria-label="Step 4 Review">
      <h3>4 · Review and sign — one approval per transaction, in your own wallets</h3>
      <ol className="signs" aria-label="Signatures">
        <li><b>Phantom</b> — SPL transfer of your USDC to the Tidepool deposit address of a <i>live</i> quote (with a deadline). <i>Bridge card below.</i> Moves: USDC on Solana devnet.</li>
        <li><b>NEAR wallet</b> — only if missing: USDC storage registration (0.00125 NEAR). <i>NEAR panel above.</i></li>
        <li><b>NEAR wallet</b> — <code>ft_transfer_call</code> of the received USDC to <code>{TREASURY_ACCOUNT_ID}</code> (90/8/2 on-chain). <i>NEAR panel → Deposit to Treasury.</i></li>
        <li><b>NEAR wallet</b> — <code>execute_lp</code>: swap + add liquidity in pool 2951, shares held by the Treasury, locked 600 s. <i>NEAR panel → Deploy liquidity.</i></li>
        <li><b>NEAR wallet, optional</b> — FUEL <code>register_position</code> while a season is open, later <code>claim</code>. <i>NEAR panel / FUEL Reactor.</i></li>
      </ol>
      <p className="muted small">Why not one signature: the Solana transfer and the NEAR transactions are on two chains with two keys. Merging them would need a new custody or delegation design, which is not built (see the Creator Portal doc). This page never signs anything itself.</p>
      <div className="card" aria-label="Bridge card"><h4>Bridge · Solana devnet → NEAR testnet {READ_ONLY ? "(read-only here)" : "(real)"}</h4><BridgeLive nearAccount={wallet ?? account} /></div>
    </section>
  );
}

function StepTrack({ account, snap, onWatch }: { account: string; snap: Snapshot | null; onWatch: (a: string) => void }) {
  const [a, setA] = useState(account);
  useEffect(() => setA(account), [account]);
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const ps = (snap?.deposits ?? []).map((d) => fromV3Deposit(d as never, snap?.positions[d.id] ?? null, TREASURY_ACCOUNT_ID, nowNs));
  return (
    <section className="card" aria-label="Step 5 Track">
      <h3>5 · Track your positions</h3>
      <form className="watch" onSubmit={(e) => { e.preventDefault(); onWatch(a.trim()); }}>
        <label htmlFor="pacct">NEAR account</label>
        <input id="pacct" value={a} onChange={(e) => setA(e.target.value)} placeholder="you.testnet" />
        <button>Load</button>
      </form>
      {snap && ps.length === 0 && <p className="muted">No Treasury deposit for <code>{account || "—"}</code> on testnet.</p>}
      {ps.map((p) => <UnifiedCard key={p.key} p={p} />)}
      <p className="muted small">V4.1 (Classic memecoin pilot) and V4.2A (DCL) positions are not deployed: see <a href="#/positions">Positions</a> for their sandbox previews.</p>
    </section>
  );
}

function ExploreSimulateNote() {
  return (
    <section className="card" aria-label="Explore simulation">
      <h3>3 · Simulation (Explore) <span className="badge neutral">SIMULATION</span></h3>
      <p>Open a pool in step 2 and press <b>Estimate (read-only)</b>: the DCL estimator uses Rhea's own <code>quote</code> and <code>predict_hotzap</code> views on mainnet.</p>
      <ul className="checks">
        <li className="ko"><b>Bridge:</b> not available for these pools — SOL2NEAR bridges with Tidepool (testnet), and these pools are on mainnet.</li>
        <li><b>Concentrated liquidity:</b> your position only earns while the price is inside its range; outside, it holds a single asset (all memecoin below the range, all wNEAR above) and earns nothing until the price returns.</li>
        <li><b>Exposure:</b> part of your capital becomes the memecoin; it can lose most of its value. No yield is promised.</li>
        <li><b>Exit (planned design):</b> after the lock the position is transferred to you; withdrawing the liquidity, collecting fees and recovering leftovers are separate steps.</li>
      </ul>
    </section>
  );
}

function ExploreReview() {
  return (
    <section className="card" aria-label="Explore review">
      <h3>4 · What execution would require (not available yet)</h3>
      <ol className="signs">
        <li>A TreasuryDCL deployed on the same network as the pool — today it exists only in a local sandbox.</li>
        <li>A USDC route on that network: Nearly pools are on mainnet; SOL2NEAR's bridge (Tidepool) is testnet-only.</li>
        <li>Then: one creator approval for the deposit, one for <code>execute_dcl_lp</code> (HotZap), later <code>claim_fees</code>, <code>withdraw_position</code>, <code>withdraw_dex_balance</code>.</li>
      </ol>
      <button disabled>Execute on DCL — not available yet</button>
    </section>
  );
}
