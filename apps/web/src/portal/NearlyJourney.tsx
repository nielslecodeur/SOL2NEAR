// H6 — Explore: the NEARLY journey in three steps (Choose → Preview → Proof). READ ONLY: no button here can sign or send.
// The eight technical stages of H1 are all still here, grouped: Choose = connect note + pool + amount; Preview = 90/8/2 +
// quote + conversion + DCL position (Advanced details); Proof = sandbox proof + fees & exit (technical view).
// Evidence kinds are never merged:
//  - MAINNET READ: Rhea DCL views on the real NEARLY / wNEAR pool (the snapshot pinned to a block, or live on demand);
//  - QUOTE: Rhea's own quote + predict_hotzap through the planner — HISTORICAL (recorded at a block) or LIVE INDICATIVE
//    (every view pinned to one final block). Neither is an executable offer: SOL2NEAR has no mainnet contract;
//  - LOCAL SANDBOX: TreasuryDCL executed against the real DCL v2.4.2 code and NEARLY's token code (local state, test tokens).
import { useState, type ReactNode } from "react";
import {
  assessDcl, DCL_FUEL_STATUS, NEARLY_DCL_CANDIDATES, pointToPrice, rangeAround, rangeStatus, splitV4,
  type DclAssessment, type DclLive,
} from "../../../../packages/near-client/src/index.ts";
import proof from "../../../../packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json";
import recorded from "../../../../packages/near-client/src/fixtures/nearly_reference_sim.json";
import mainnetFx from "../../../../packages/near-client/src/fixtures/v42_dcl_mainnet_2026-11-14.json";
import { formatUnits, parseUnits } from "../format.ts";
import { finalMainnetBlock, readLive, simulateDcl } from "../v4/Dcl.tsx";
import { SandboxSummary, SandboxTechnical } from "../proofs/SandboxEvidence.tsx";
import { IconArrow, IconLock } from "../ui/icons.tsx";

const C = NEARLY_DCL_CANDIDATES.find((c) => c.key === "dcl:nearly")!;
export const EXPLORE_STEPS = [
  { id: "choose", label: "Choose", hint: "Pick the pool and an amount" },
  { id: "preview", label: "Preview", hint: "See what the contribution becomes" },
  { id: "proof", label: "Proof", hint: "Check what was really executed" },
] as const;
export type ExploreStep = (typeof EXPLORE_STEPS)[number]["id"];

const KV = ({ k, children }: { k: string; children: ReactNode }) => <div><dt>{k}</dt><dd>{children}</dd></div>;
const px = (point: number) => pointToPrice(point, C.xDecimals, C.yDecimals).toExponential(4);
const dclMeta = (mainnetFx as { contracts: Record<string, { metadata?: { version: string; protocol_fee_rate: number } }> }).contracts["mainnet:dclv2.ref-labs.near"]!.metadata!;
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const RANGES = [
  { v: 5_000, label: "Narrow", detail: "±5 000 points · price ×/÷ 1.65" },
  { v: 20_000, label: "Wide", detail: "±20 000 points · price ×/÷ 7.4" },
  { v: 50_000, label: "Very wide", detail: "±50 000 points · price ×/÷ 148" },
];

interface Sim {
  source: "LIVE" | "HISTORICAL"; block: number; time: string; half: number; usdcIn: bigint; left: number; right: number; point: number; shareX: number;
  split: { lp: bigint; reserve: bigint; community: bigint }; spend: bigint;
  outX: bigint; outY: bigint; needX: bigint; needY: bigint; liquidity: bigint; leftX: bigint; leftY: bigint; leftBps: number;
  usdcToX: bigint; usdcToY: bigint; minX: bigint; minY: bigint; impactBps: number | null;
}
type Rec = typeof recorded;
function fromRecorded(r: Rec): Sim {
  const b = BigInt;
  return {
    source: "HISTORICAL", block: r.block_height, time: utc(r.block_time_utc), half: r.input.half_width_points,
    usdcIn: b(r.input.usdc_atomic), left: r.range.left_point, right: r.range.right_point, point: r.pool.current_point, shareX: r.share_to_nearly,
    split: { lp: b(r.split_90_8_2.lp_budget), reserve: b(r.split_90_8_2.reserve), community: b(r.split_90_8_2.community) }, spend: b(r.plan.usdc_to_x) + b(r.plan.usdc_to_y),
    outX: b(r.prediction.out_x), outY: b(r.prediction.out_y), needX: b(r.prediction.need_x), needY: b(r.prediction.need_y), liquidity: b(r.prediction.liquidity),
    leftX: b(r.estimate.leftover_x), leftY: b(r.estimate.leftover_y), leftBps: r.estimate.leftover_share_bps,
    usdcToX: b(r.plan.usdc_to_x), usdcToY: b(r.plan.usdc_to_y), minX: b(r.plan.min_x_out), minY: b(r.plan.min_y_out), impactBps: r.nearly_leg_price_impact_bps,
  };
}
type LiveRead = { live: DclLive; a: DclAssessment; at: number; block: number };

export function NearlyJourney({ step }: { step: ExploreStep }) {
  const [amount, setAmount] = useState(String(Number(recorded.input.usdc_atomic) / 1e6));
  const [half, setHalf] = useState(recorded.input.half_width_points);
  const [live, setLive] = useState<LiveRead | Error | null>(null);
  const [liveSim, setLiveSim] = useState<Sim | Error | null>(null);
  const [busy, setBusy] = useState<"" | "pool" | "quote">("");
  const [technical, setTechnical] = useState(false);
  const atomic = parseUnits(amount, 6);
  const rec = fromRecorded(recorded);
  const recordedApplies = atomic === recorded.input.usdc_atomic && half === recorded.input.half_width_points;
  const liveApplies = liveSim && !(liveSim instanceof Error) && liveSim.usdcIn === BigInt(atomic ?? "0") && liveSim.half === half ? liveSim : null;
  const sim: Sim | null = liveApplies ?? (recordedApplies ? rec : null);
  const point = live && !(live instanceof Error) ? live.live.pool.current_point : recorded.pool.current_point;

  async function readPool() {
    setBusy("pool");
    try {
      const b = await finalMainnetBlock();
      const l = await readLive(C, b.height);
      setLive({ live: l, a: assessDcl(C, l), at: Date.now(), block: b.height });
    } catch (e) { setLive(e as Error); } finally { setBusy(""); }
  }
  async function quote() {
    if (!atomic) return;
    setBusy("quote"); setLiveSim(null);
    try {
      // ONE final block for every view: the range is centred on that block's price and every quote reads that same state
      const b = await finalMainnetBlock();
      const l = await readLive(C, b.height);
      setLive({ live: l, a: assessDcl(C, l), at: Date.now(), block: b.height });
      const [left, right] = rangeAround(l.pool.current_point, half, C.pointDelta);
      const usdcIn = BigInt(atomic);
      const r = await simulateDcl(C, usdcIn, left, right, b.height);
      setLiveSim({
        source: "LIVE", block: b.height, time: utc(new Date(Number(b.timestampNs / 1_000_000n)).toISOString()), half, usdcIn, left, right, point: l.pool.current_point, shareX: r.shareX,
        split: { lp: r.est.lpBudget, reserve: r.est.reserve, community: r.est.community }, spend: r.est.spend,
        outX: r.pr.outX, outY: r.pr.outY, needX: r.pr.needX, needY: r.pr.needY, liquidity: r.pr.liquidity, leftX: r.est.leftoverX, leftY: r.est.leftoverY, leftBps: r.est.leftoverShareBps,
        usdcToX: BigInt(r.plan.usdc_to_x), usdcToY: BigInt(r.plan.usdc_to_y), minX: BigInt(r.plan.min_x_out), minY: BigInt(r.plan.min_y_out), impactBps: r.impactBps,
      });
    } catch (e) { setLiveSim(e as Error); } finally { setBusy(""); }
  }

  const idx = EXPLORE_STEPS.findIndex((s) => s.id === step);
  return (
    <main className="explore" aria-label="NEARLY journey">
      <header className="page-head">
        <p className="eyebrow">Explore · read-only demo</p>
        <h1>Route USDC into a NEAR memecoin pool</h1>
        <p className="lede" data-testid="nearly-evidence-note">
          NEARLY is a real memecoin on NEAR mainnet. Here its pool is only <b>read</b> and <b>quoted</b>; the SOL2NEAR position itself was executed in a{" "}
          <b>local sandbox</b> with the real exchange code. No SOL2NEAR contract exists on mainnet and no mainnet contribution has ever been made.
        </p>
      </header>
      <nav className="stepper3" aria-label="Journey">
        <ol>
          {EXPLORE_STEPS.map((s, i) => (
            <li key={s.id}>
              <a href={`#/explore/${s.id}`} className={i === idx ? "on" : i < idx ? "done" : ""} aria-current={i === idx ? "step" : undefined}>
                <span className="num">{i + 1}</span><span><b>{s.label}</b><small>{s.hint}</small></span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="stage" key={step}>
        {step === "choose" && (
          <Choose live={live} busy={busy === "pool"} onRead={readPool} amount={amount} setAmount={setAmount} half={half} setHalf={setHalf} atomic={atomic} />
        )}
        {step === "preview" && (
          <Preview sim={sim} amount={amount} atomic={atomic} half={half} busy={busy === "quote"} error={liveSim instanceof Error ? liveSim : null} onQuote={quote} point={point} />
        )}
        {step === "proof" && (
          <>
            <SandboxSummary technical={technical} onTechnical={() => setTechnical(!technical)} />
            {technical && <SandboxTechnical />}
            <p className="muted small center">The testnet transactions (bridge, Treasury, liquidity, FUEL) are a separate level of evidence: see <a href="#/proofs">Proof</a>.</p>
          </>
        )}
      </div>

      <div className="step-nav">
        {idx > 0 ? <a className="btn ghost" href={`#/explore/${EXPLORE_STEPS[idx - 1]!.id}`}>← {EXPLORE_STEPS[idx - 1]!.label}</a> : <span />}
        {idx < EXPLORE_STEPS.length - 1
          ? <a className="btn primary" href={`#/explore/${EXPLORE_STEPS[idx + 1]!.id}`}>Next: {EXPLORE_STEPS[idx + 1]!.label} <IconArrow size={18} /></a>
          : <a className="btn ghost" href="#/proofs">All proofs <IconArrow size={18} /></a>}
      </div>
    </main>
  );
}

function TokenMark() {
  return <span className="token-mark" aria-hidden="true">N</span>;
}

function Choose({ live, busy, onRead, amount, setAmount, half, setHalf, atomic }: {
  live: LiveRead | Error | null; busy: boolean; onRead: () => void; amount: string; setAmount: (v: string) => void; half: number; setHalf: (v: number) => void; atomic: string | null;
}) {
  const l = live && !(live instanceof Error) ? live : null;
  const pool = l ? l.live.pool : null;
  return (
    <section className="panel" aria-label="Step 1 Choose">
      <div className="asset-head">
        <TokenMark />
        <div>
          <h2>NEARLY</h2>
          <p className="muted">NEARLY / wNEAR · Rhea DCL v{dclMeta.version}</p>
        </div>
        <span className="pill">Mainnet pool · read-only</span>
      </div>
      <dl className="tiles">
        <div><dt>Price</dt><dd>{px(pool?.current_point ?? recorded.pool.current_point)} <small>wNEAR per NEARLY</small></dd></div>
        <div><dt>Pool fee</dt><dd>1 %</dd></div>
        <div><dt>Pool holds</dt><dd>{formatUnits(pool?.total_y ?? recorded.pool.total_y, 24, 0)} <small>wNEAR</small></dd></div>
        <div><dt>Data</dt><dd className="small-dd">{l ? <>Live · block {l.block}</> : <>Snapshot · block {recorded.block_height}</>}</dd></div>
      </dl>

      <div className="amount">
        <label htmlFor="nusd">Contribution</label>
        <div className="amount-input">
          <input id="nusd" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-describedby="nusd-help" aria-invalid={!atomic} />
          <span>USDC</span>
        </div>
        <div className="chips" role="group" aria-label="Quick amounts">
          {["50", "100", "250", "500"].map((v) => <button key={v} className={`chip ${amount === v ? "on" : ""}`} onClick={() => setAmount(v)} aria-pressed={amount === v}>{v}</button>)}
        </div>
        <p id="nusd-help" className="muted small">{atomic ? <>90 % of it ({formatUnits(splitV4(BigInt(atomic)).lp, 6, 2)} USDC) would go to liquidity. Nothing is sent: this is a demonstration.</> : <span className="text-bad">Enter a positive USDC amount (max 6 decimals).</span>}</p>
      </div>
      <fieldset className="ranges">
        <legend>Price range of the position</legend>
        {RANGES.map((r) => (
          <label key={r.v} className={half === r.v ? "range on" : "range"}>
            <input type="radio" name="nrange" value={r.v} checked={half === r.v} onChange={() => setHalf(r.v)} />
            <b>{r.label}</b><small>{r.detail}</small>
          </label>
        ))}
      </fieldset>
      <p className="muted small">No wallet is needed: every value is a public read, a quote or a recorded sandbox proof.</p>

      <details className="advanced">
        <summary>Advanced details</summary>
        <div aria-label="NEARLY pool details">
          <dl className="kv">
            <KV k="Memecoin"><code>{C.tokenX}</code> · {C.xDecimals} decimals · Nearly launch #{C.launchId} · code <code>{C.tokenCodeHash.slice(0, 8)}…</code> (Nearly raw v1, no transfer tax)</KV>
            <KV k="DEX"><code>{C.dex}</code> · Rhea DCL v{dclMeta.version} · code <code>{proof.provenance.dcl.expected_mainnet_code_hash.slice(0, 8)}…</code></KV>
            <KV k="Pool"><code>{C.poolId}</code> · fee 1 % · point spacing {C.pointDelta}</KV>
            <KV k="Launch position"><code>#{C.lockerLptId.split("#")[1]}</code> owned by <code>{C.locker}</code>, range [{C.lockerRange.join(", ")}] — the Nearly creator's, <b>never touched by SOL2NEAR</b></KV>
            <KV k="Route">USDC <code>{recorded.usdc.slice(0, 8)}…</code> → wNEAR (<code>…|wrap.near|100</code>, 0.01 %) → NEARLY, all inside one Rhea HotZap</KV>
            <KV k="Price">{pool ? <>{px(pool.current_point)} wNEAR per NEARLY (point {pool.current_point}) <span className="tag ok">LIVE block {l!.block}</span></>
              : <>{px(recorded.pool.current_point)} wNEAR per NEARLY (point {recorded.pool.current_point}) <span className="tag">SNAPSHOT block {recorded.block_height}</span></>}</KV>
            <KV k="Liquidity">active {formatUnits(pool?.liquidity ?? recorded.pool.liquidity_active, 0, 0)} · total {formatUnits(pool?.total_liquidity ?? recorded.pool.total_liquidity, 0, 0)} DCL units (other positions exist beside the launch position)</KV>
            <KV k="Pool holds">{formatUnits(pool?.total_x ?? recorded.pool.total_x, 18, 0)} NEARLY · {formatUnits(pool?.total_y ?? recorded.pool.total_y, 24, 2)} wNEAR <small className="muted">(all positions and orders; not a USD TVL)</small></KV>
          </dl>
          <div className="field-row"><button className="btn ghost sm" onClick={onRead} disabled={busy}>{busy ? "Reading mainnet…" : "Re-read live (mainnet views at one block)"}</button></div>
          {live instanceof Error && <p className="alert bad" data-testid="pool-error">Live read failed: {live.message}. The snapshot above stays labelled with its block.</p>}
          {l && <ul className="checks" aria-label="NEARLY live checks">{l.a.checks.map((k) => <li key={k.id} className={k.ok ? "ok" : "ko"}><b>{k.ok ? "✓" : "✗"} {k.id}</b> {k.detail}</li>)}</ul>}
          <p className="small muted"><b>Classification: feasible for a local DCL test — not executable.</b> The same code and pool type ran in the local sandbox; a real position would need mainnet USDC and a mainnet TreasuryDCL, which do not exist. Also examined: NEARKAT (untaxed, thin) and DRAGON (taxed → blocked). See <a href="#/pools">Pools</a>.</p>
        </div>
      </details>
    </section>
  );
}

function Preview({ sim, amount, atomic, half, busy, error, onQuote, point }: {
  sim: Sim | null; amount: string; atomic: string | null; half: number; busy: boolean; error: Error | null; onQuote: () => void; point: number;
}) {
  const split = atomic ? splitV4(BigInt(atomic)) : null;
  const impact = sim?.impactBps ?? null;
  return (
    <section className="panel" aria-label="Step 2 Preview">
      <div className="quote-head" aria-label="Quote status">
        {sim ? (
          <div>
            <span className={`pill ${sim.source === "LIVE" ? "live" : ""}`} data-testid="quote-source">{sim.source === "LIVE" ? "Live indicative quote" : "Historical quote"}</span>
            <p className="muted small" data-testid="quote-label">Mainnet block {sim.block} · {sim.time} · Rhea <code>quote</code> + <code>predict_hotzap</code> views, every one at that block. <b>Not an executable offer.</b></p>
          </div>
        ) : (
          <div data-testid="quote-none">
            <span className="pill">No quote yet</span>
            <p className="muted small">The historical quote is for {Number(recorded.input.usdc_atomic) / 1e6} USDC, wide range. For {amount || "this amount"} USDC, ask Rhea for a live indicative quote. Nothing is estimated without a source.</p>
          </div>
        )}
        <button className="btn secondary" onClick={onQuote} disabled={!atomic || busy}>{busy ? "Reading mainnet…" : "Get a live indicative quote"}</button>
      </div>
      {error && <p className="alert bad" role="alert" data-testid="quote-error">Live quote failed: {error.message}. {sim ? "The historical quote below is unchanged." : "No amount is shown without a quote."}</p>}

      <dl className="summary" aria-label="Contribution preview">
        <div><dt>You contribute</dt><dd>{atomic ? formatUnits(atomic, 6, 2) : "—"} <small>USDC</small></dd></div>
        <div><dt>To liquidity (90 %)</dt><dd>{split ? formatUnits(split.lp, 6, 2) : "—"} <small>USDC</small></dd></div>
        <div className="wide"><dt>Estimated position</dt><dd>{sim ? <>{formatUnits(sim.needX, 18, 0)} <small>NEARLY</small> + {formatUnits(sim.needY, 24, 2)} <small>wNEAR</small></> : <span className="muted">needs a quote</span>}</dd></div>
        <div><dt>Price impact</dt><dd>{sim ? (impact === null ? <span className="muted">unavailable</span> : <>{(impact / 100).toFixed(2)} %</>) : <span className="muted">needs a quote</span>}</dd></div>
      </dl>
      {split && (
        <div className="splitbar" aria-label="90/8/2 split">
          <span style={{ flex: 90 }}>Liquidity 90 % · {formatUnits(split.lp, 6, 2)} USDC</span>
          <span style={{ flex: 8 }} title={`Your reserve 8 % · ${formatUnits(split.reserve, 6, 2)} USDC`} />
          <span style={{ flex: 2 }} title={`Community 2 % · ${formatUnits(split.community, 6, 2)} USDC`} />
        </div>
      )}
      {split && <p className="muted small">8 % ({formatUnits(split.reserve, 6, 2)} USDC) stays in your reserve, withdrawable at any time; 2 % ({formatUnits(split.community, 6, 2)} USDC) is the community allocation.</p>}
      <div className="risk" role="note">
        <b>Main risk</b> NEARLY can lose most of its value, and outside its price range the position earns no fees and ends up entirely in one token. No yield is promised.
        {impact !== null && impact > 1000 && <> This plan's impact is above the 10 % guard: the contract would refuse it.</>}
      </div>

      <details className="advanced">
        <summary>Advanced details</summary>
        {split && <SplitTable usdcIn={BigInt(atomic!)} />}
        {sim && <QuoteTable s={sim} />}
        <Conversion s={sim} />
        <Position s={sim} point={point} half={half} />
      </details>
      <button className="btn locked" disabled title="No SOL2NEAR contract on mainnet; the public demo has no signing code"><IconLock size={16} /> Execute on mainnet — not available</button>
    </section>
  );
}

function SplitTable({ usdcIn }: { usdcIn: bigint }) {
  const s = splitV4(usdcIn);
  return (
    <>
      <h4>90/8/2 split (Treasury rule)</h4>
      <table className="dtable" aria-label="90/8/2 split table"><tbody>
        <tr><td>90 %</td><td>liquidity budget (the HotZap spends it)</td><td><b>{formatUnits(s.lp, 6, 6)} USDC</b></td></tr>
        <tr><td>8 %</td><td>your reserve, withdrawable by you at any time</td><td>{formatUnits(s.reserve, 6, 6)} USDC</td></tr>
        <tr><td>2 %</td><td>community allocation (booked in <code>community_total</code>; no creator withdrawal)</td><td>{formatUnits(s.community, 6, 6)} USDC</td></tr>
      </tbody></table>
      <p className="muted small">The same code as the deployed testnet Treasury and the sandbox TreasuryDCL (sandbox step D1).</p>
    </>
  );
}

function QuoteTable({ s }: { s: Sim }) {
  return (
    <>
      <h4>Quote detail · {s.source === "LIVE" ? "live indicative" : "historical"}, mainnet block {s.block}</h4>
      <table className="dtable" aria-label="NEARLY contribution quote"><tbody>
        <tr><td>Sent</td><td>{formatUnits(s.usdcIn, 6, 6)} USDC → LP budget {formatUnits(s.split.lp, 6, 6)} · reserve {formatUnits(s.split.reserve, 6, 6)} · community {formatUnits(s.split.community, 6, 6)}</td></tr>
        <tr><td>Spent by the zap</td><td>{formatUnits(s.spend, 6, 6)} USDC: {formatUnits(s.usdcToX, 6, 6)} → NEARLY ({(s.shareX * 100).toFixed(1)} %), {formatUnits(s.usdcToY, 6, 6)} → wNEAR</td></tr>
        <tr><td>Swap outputs</td><td><b>{formatUnits(s.outX, 18, 2)} NEARLY</b> + <b>{formatUnits(s.outY, 24, 4)} wNEAR</b> (min outs {formatUnits(s.minX, 18, 2)} / {formatUnits(s.minY, 24, 4)})</td></tr>
        <tr><td>Into the position</td><td>{formatUnits(s.needX, 18, 2)} NEARLY + {formatUnits(s.needY, 24, 4)} wNEAR → {s.liquidity.toString()} DCL liquidity units</td></tr>
        <tr><td>Left over (recoverable)</td><td>{formatUnits(s.leftX, 18, 2)} NEARLY + {formatUnits(s.leftY, 24, 4)} wNEAR (≈ {(s.leftBps / 100).toFixed(2)} %)</td></tr>
        <tr><td>Range</td><td>[{s.left}, {s.right}] = {px(s.left)} → {px(s.right)} wNEAR per NEARLY; price then {px(s.point)}</td></tr>
        <tr><td>Price impact</td><td>{s.impactBps === null ? "unavailable (no quote for the small leg)" : <>NEARLY leg <b>{(s.impactBps / 100).toFixed(2)} %</b> (Rhea quote of the full leg vs 1/1000 of it, scaled){s.impactBps > 1000 && <> — <span className="tag bad">above the 10 % impact guard: TreasuryDCL would refuse it</span></>}</>}</td></tr>
      </tbody></table>
      <p className="muted small">Rhea's pool fees (0.01 % on USDC/wNEAR, 1 % on NEARLY/wNEAR) are already deducted by <code>quote</code>. A 1 % slippage guard sets the minimums. Not included: bridge cost (no mainnet bridge is chosen), gas, DCL storage (0.5 NEAR once + 0.1 NEAR registration).</p>
    </>
  );
}

function Conversion({ s }: { s: Sim | null }) {
  const f = (v: bigint | undefined, d: number, n: number) => (s && v !== undefined ? formatUnits(v, d, n) : "—");
  return (
    <div aria-label="Conversion steps">
      <h4>How the USDC becomes a NEARLY position</h4>
      <ol className="signs">
        <li><b>Solana → NEAR.</b> Today SOL2NEAR bridges <b>devnet</b> USDC to <b>testnet</b> through Tidepool (a community sandbox, not official NEAR Intents) — proven with transaction hashes (G7). No mainnet bridge is wired: NEARLY's pool needs mainnet USDC.</li>
        <li><b>Treasury intake</b> (<code>ft_transfer_call</code> to TreasuryDCL, <code>{"{\"action\":\"deposit\"}"}</code>): 90/8/2 → LP budget {f(s?.split.lp, 6, 6)} USDC.</li>
        <li><b>One Rhea HotZap</b> (<code>execute_dcl_lp</code>, creator only): {f(s?.usdcToX, 6, 6)} USDC → wNEAR → NEARLY, {f(s?.usdcToY, 6, 6)} USDC → wNEAR, then <code>add_liquidity</code> in [{s?.left ?? "—"}, {s?.right ?? "—"}]. Swaps and add run in <b>one DCL receipt</b>: all apply or none (sandbox E4b, F1).</li>
        <li><b>Guards before sending</b>: creator only, range on the 200 grid and around the price, slippage ≤ 1 % of Rhea's own quote, price impact ≤ 10 %, plan deadline (sandbox E1–E4b, F4 refused them).</li>
        <li><b>Confirmation</b>: the Treasury reads the new position back from the DCL (<code>list_liquidities</code>, <code>get_liquidity_view</code>) and records lpt_id, liquidity and amounts; leftovers ({f(s?.leftX, 18, 2)} NEARLY + {f(s?.leftY, 24, 4)} wNEAR) stay booked to the deposit.</li>
      </ol>
    </div>
  );
}

function Position({ s, point, half }: { s: Sim | null; point: number; half: number }) {
  const [l, r] = s ? [s.left, s.right] : rangeAround(point, half, C.pointDelta);
  const st = rangeStatus(point, l, r, "NEARLY", "wNEAR");
  return (
    <div aria-label="DCL position">
      <h4>The position SOL2NEAR would hold for you</h4>
      <dl className="kv">
        <KV k="Position">a <b>new, separate</b> Rhea DCL position (NEP-171 NFT) in <code>{C.poolId}</code>, owned by the TreasuryDCL contract on your behalf</KV>
        <KV k="Range">[{l}, {r}] = {px(l)} → {px(r)} wNEAR per NEARLY · price {px(point)} → {st.explain}</KV>
        <KV k="Out of range">above the range it is <b>100 % wNEAR</b>, below it is <b>100 % NEARLY</b>, and it <b>earns no fee</b> until the price comes back (measured: sandbox K3–K5, 0 / 0 fees)</KV>
        <KV k="Your rights">only you (the creator) can claim its fees, and after the lock withdraw it: the NFT is transferred to you and the DCL owner is checked (sandbox H3). Your 8 % reserve is withdrawable at any time</KV>
        <KV k="Not yours">the Nearly launch position and its fees (locker <code>{C.locker}</code>); pool-wide counters; any APY — none is computed</KV>
        <KV k="Risks">NEARLY can lose most of its value; concentrated impermanent loss; Rhea's DAO can upgrade the DCL; TreasuryDCL is unaudited; ≤ 40 positions per Treasury (DCL slots)</KV>
        <KV k="FUEL">{DCL_FUEL_STATUS}: the deployed FUEL only reads the V3 Treasury and Ref pool #2951</KV>
      </dl>
    </div>
  );
}
