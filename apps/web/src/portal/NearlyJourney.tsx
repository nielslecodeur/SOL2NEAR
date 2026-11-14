// H1 — NEARLY journey of the Creator Portal (Explore mode). READ ONLY: no button here can sign or send anything.
// Three kinds of evidence, never merged:
//  - MAINNET READ: Rhea DCL views on the real NEARLY / wNEAR pool (live on demand, or the recorded snapshot pinned to a block);
//  - MAINNET REFERENCE SIMULATION: Rhea's own quote + predict_hotzap through the dashboard planner (no transaction);
//  - LOCAL SANDBOX: TreasuryDCL executed against the real DCL v2.4.2 code and NEARLY's token code (local state, test tokens).
// The testnet V3 bridge + Treasury proofs are on the Proofs page; they are a different journey (pool #2951, not a memecoin).
import { useMemo, useState, type ReactNode } from "react";
import {
  assessDcl, DCL_FUEL_STATUS, NEARLY_DCL_CANDIDATES, pointToPrice, rangeAround, rangeStatus, splitV4,
  type DclAssessment, type DclLive,
} from "../../../../packages/near-client/src/index.ts";
import proof from "../../../../packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json";
import recorded from "../../../../packages/near-client/src/fixtures/nearly_reference_sim.json";
import mainnetFx from "../../../../packages/near-client/src/fixtures/v42_dcl_mainnet_2026-11-14.json";
import { formatUnits, parseUnits } from "../format.ts";
import { readLive, simulateDcl } from "../v4/Dcl.tsx";

const C = NEARLY_DCL_CANDIDATES.find((c) => c.key === "dcl:nearly")!;
export const NEARLY_STEPS = ["Connect", "Choose NEARLY", "Amount", "Contribution quote", "Conversion steps", "DCL position", "Sandbox proof", "Fees & exit"] as const;
const KV = ({ k, children }: { k: string; children: ReactNode }) => <div><dt>{k}</dt><dd>{children}</dd></div>;
const px = (point: number) => pointToPrice(point, C.xDecimals, C.yDecimals).toExponential(4);
const dclMeta = (mainnetFx as { contracts: Record<string, { metadata?: { version: string; protocol_fee_rate: number } }> }).contracts["mainnet:dclv2.ref-labs.near"]!.metadata!;

interface Sim {
  source: "LIVE" | "RECORDED"; label: string; usdcIn: bigint; left: number; right: number; point: number; shareX: number;
  split: { lp: bigint; reserve: bigint; community: bigint }; spend: bigint;
  outX: bigint; outY: bigint; needX: bigint; needY: bigint; liquidity: bigint; leftX: bigint; leftY: bigint; leftBps: number;
  usdcToX: bigint; usdcToY: bigint; minX: bigint; minY: bigint; impactBps: number | null;
}
type Rec = typeof recorded;
function fromRecorded(r: Rec): Sim {
  const b = BigInt;
  return {
    source: "RECORDED", label: `recorded at mainnet block ${r.block_height} (${r.block_time_utc.slice(0, 16).replace("T", " ")} UTC)`,
    usdcIn: b(r.input.usdc_atomic), left: r.range.left_point, right: r.range.right_point, point: r.pool.current_point, shareX: r.share_to_nearly,
    split: { lp: b(r.split_90_8_2.lp_budget), reserve: b(r.split_90_8_2.reserve), community: b(r.split_90_8_2.community) }, spend: b(r.plan.usdc_to_x) + b(r.plan.usdc_to_y),
    outX: b(r.prediction.out_x), outY: b(r.prediction.out_y), needX: b(r.prediction.need_x), needY: b(r.prediction.need_y), liquidity: b(r.prediction.liquidity),
    leftX: b(r.estimate.leftover_x), leftY: b(r.estimate.leftover_y), leftBps: r.estimate.leftover_share_bps,
    usdcToX: b(r.plan.usdc_to_x), usdcToY: b(r.plan.usdc_to_y), minX: b(r.plan.min_x_out), minY: b(r.plan.min_y_out), impactBps: r.nearly_leg_price_impact_bps,
  };
}

export function NearlyJourney({ step, connect }: { step: number; connect: ReactNode }) {
  const [amount, setAmount] = useState(String(Number(recorded.input.usdc_atomic) / 1e6));
  const [half, setHalf] = useState(recorded.input.half_width_points);
  const [live, setLive] = useState<{ live: DclLive; a: DclAssessment; at: number } | Error | null>(null);
  const [liveSim, setLiveSim] = useState<Sim | Error | null>(null);
  const [busy, setBusy] = useState<"" | "pool" | "quote">("");
  const atomic = parseUnits(amount, 6);
  const rec = fromRecorded(recorded);
  const recordedApplies = atomic === recorded.input.usdc_atomic && half === recorded.input.half_width_points;
  const sim: Sim | null = liveSim && !(liveSim instanceof Error) && liveSim.usdcIn === BigInt(atomic ?? "0") ? liveSim : recordedApplies ? rec : null;
  const point = live && !(live instanceof Error) ? live.live.pool.current_point : recorded.pool.current_point;

  async function readPool() {
    setBusy("pool");
    try { const l = await readLive(C); setLive({ live: l, a: assessDcl(C, l), at: Date.now() }); } catch (e) { setLive(e as Error); } finally { setBusy(""); }
  }
  async function quote() {
    if (!atomic) return;
    setBusy("quote"); setLiveSim(null);
    try {
      // the live pool point is read first: the range is centred on the price of this block, not on the recorded one
      const l = await readLive(C);
      setLive({ live: l, a: assessDcl(C, l), at: Date.now() });
      const [left, right] = rangeAround(l.pool.current_point, half, C.pointDelta);
      const usdcIn = BigInt(atomic);
      const r = await simulateDcl(C, usdcIn, left, right);
      setLiveSim({
        source: "LIVE", label: `live mainnet views, ${new Date().toLocaleTimeString()}`, usdcIn, left, right, point: l.pool.current_point, shareX: r.shareX,
        split: { lp: r.est.lpBudget, reserve: r.est.reserve, community: r.est.community }, spend: r.est.spend,
        outX: r.pr.outX, outY: r.pr.outY, needX: r.pr.needX, needY: r.pr.needY, liquidity: r.pr.liquidity, leftX: r.est.leftoverX, leftY: r.est.leftoverY, leftBps: r.est.leftoverShareBps,
        usdcToX: BigInt(r.plan.usdc_to_x), usdcToY: BigInt(r.plan.usdc_to_y), minX: BigInt(r.plan.min_x_out), minY: BigInt(r.plan.min_y_out), impactBps: r.impactBps,
      });
    } catch (e) { setLiveSim(e as Error); } finally { setBusy(""); }
  }

  return (
    <div aria-label="NEARLY journey">
      <div className="banner sim" role="note" data-testid="nearly-evidence-note">
        NEARLY is a <b>real mainnet memecoin</b>. Here it is only <b>read</b> (mainnet view calls) and <b>simulated</b>; the SOL2NEAR position was executed in a <b>LOCAL SANDBOX</b> with the real
        Rhea DCL and NEARLY code. No SOL2NEAR contract exists on mainnet and no mainnet contribution has ever been made.
      </div>
      {step === 0 && <section className="card" aria-label="NEARLY step 1">{connect}<p className="muted small">No wallet is needed to follow this journey: every value below is a public read, a simulation or a recorded sandbox proof.</p></section>}
      {step === 1 && <ChoosePool live={live} busy={busy === "pool"} onRead={readPool} />}
      {step === 2 && (
        <section className="card" aria-label="NEARLY step 3 Amount">
          <h3>3 · Amount <span className="badge neutral">INPUT</span></h3>
          <div className="watch">
            <label htmlFor="nusd">USDC you would send</label>
            <input id="nusd" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <label htmlFor="nrange">Range</label>
            <select id="nrange" value={half} onChange={(e) => setHalf(Number(e.target.value))}>
              <option value={5_000}>narrow ±5 000 points (price ×/÷ 1.65)</option>
              <option value={20_000}>wide ±20 000 points (price ×/÷ 7.4)</option>
              <option value={50_000}>very wide ±50 000 points (price ×/÷ 148)</option>
            </select>
          </div>
          {atomic ? <SplitTable usdcIn={BigInt(atomic)} /> : <p className="badge failed">Enter a positive USDC amount (max 6 decimals).</p>}
          <p className="muted small">The split is the Treasury rule (90 % liquidity / 8 % your reserve / 2 % community), the same code as the deployed testnet Treasury and the sandbox TreasuryDCL (sandbox step D1).</p>
        </section>
      )}
      {step === 3 && (
        <section className="card" aria-label="NEARLY step 4 Quote">
          <h3>4 · Contribution quote <span className="badge neutral">MAINNET REFERENCE SIMULATION</span></h3>
          <div className="watch">
            <button onClick={quote} disabled={!atomic || busy !== ""}>{busy === "quote" ? "Reading mainnet…" : "Get a live quote (read-only mainnet views)"}</button>
            <small className="muted">{amount} USDC · ±{half.toLocaleString("en")} points</small>
          </div>
          {liveSim instanceof Error && <p className="badge failed" data-testid="quote-error">Live quote failed: {liveSim.message}</p>}
          {sim ? <QuoteTable s={sim} /> : <p className="muted" data-testid="quote-none">No quote for this amount yet. The recorded quote is for {Number(recorded.input.usdc_atomic) / 1e6} USDC, ±{recorded.input.half_width_points.toLocaleString("en")} points: press the button for a live one. Nothing is estimated without a source.</p>}
        </section>
      )}
      {step === 4 && <Conversion s={sim} />}
      {step === 5 && <Position s={sim} point={point} />}
      {step === 6 && <SandboxProof />}
      {step === 7 && <FeesExit />}
    </div>
  );
}

function ChoosePool({ live, busy, onRead }: { live: { live: DclLive; a: DclAssessment; at: number } | Error | null; busy: boolean; onRead: () => void }) {
  const l = live && !(live instanceof Error) ? live : null;
  const pool = l ? l.live.pool : null;
  return (
    <section className="card" aria-label="NEARLY step 2 Choose pool">
      <h3>2 · The destination: NEARLY / wNEAR on Rhea DCL <span className="badge refunded">MAINNET · read-only</span></h3>
      <dl className="kv">
        <KV k="Memecoin"><code>{C.tokenX}</code> · {C.xDecimals} decimals · Nearly launch #{C.launchId} · code <code>{C.tokenCodeHash.slice(0, 8)}…</code> (Nearly raw v1, no transfer tax)</KV>
        <KV k="DEX"><code>{C.dex}</code> · Rhea DCL v{dclMeta.version} · code <code>{proof.provenance.dcl.expected_mainnet_code_hash.slice(0, 8)}…</code></KV>
        <KV k="Pool"><code>{C.poolId}</code> · fee 1 % · point spacing {C.pointDelta}</KV>
        <KV k="Launch position"><code>#{C.lockerLptId.split("#")[1]}</code> owned by <code>{C.locker}</code>, range [{C.lockerRange.join(", ")}] — the Nearly creator's, <b>never touched by SOL2NEAR</b></KV>
        <KV k="Route">USDC <code>{recorded.usdc.slice(0, 8)}…</code> → wNEAR (<code>…|wrap.near|100</code>, 0.01 %) → NEARLY, all inside one Rhea HotZap</KV>
        <KV k="Price">{pool ? <><b>{px(pool.current_point)}</b> wNEAR per NEARLY (point {pool.current_point}) <span className="badge confirmed">LIVE {new Date(l!.at).toLocaleTimeString()}</span></>
          : <>{px(recorded.pool.current_point)} wNEAR per NEARLY (point {recorded.pool.current_point}) <span className="badge neutral">SNAPSHOT block {recorded.block_height}</span></>}</KV>
        <KV k="Liquidity">active {formatUnits(pool?.liquidity ?? recorded.pool.liquidity_active, 0, 0)} · total {formatUnits(pool?.total_liquidity ?? recorded.pool.total_liquidity, 0, 0)} DCL units (other positions exist beside the launch position)</KV>
        <KV k="Pool holds">{formatUnits(pool?.total_x ?? recorded.pool.total_x, 18, 0)} NEARLY · {formatUnits(pool?.total_y ?? recorded.pool.total_y, 24, 2)} wNEAR <small className="muted">(all positions and orders; not a USD TVL)</small></KV>
      </dl>
      <div className="watch"><button className="ghost" onClick={onRead} disabled={busy}>{busy ? "Reading mainnet…" : "Re-read live (6 mainnet views)"}</button></div>
      {live instanceof Error && <p className="badge failed" data-testid="pool-error">Live read failed: {live.message}. The snapshot above stays labelled with its block.</p>}
      {l && <ul className="checks" aria-label="NEARLY live checks">{l.a.checks.map((k) => <li key={k.id} className={k.ok ? "ok" : "ko"}><b>{k.ok ? "✓" : "✗"} {k.id}</b> {k.detail}</li>)}</ul>}
      <p className="observe"><b>Classification: FEASIBLE FOR LOCAL DCL TEST — not executable.</b> Same code and pool type were run in the local sandbox (step 7); a real position would need mainnet USDC and a mainnet TreasuryDCL, which do not exist.</p>
      <p className="muted small">Also examined in V4.2A: NEARKAT (untaxed, thin) and DRAGON (taxed → <b>BLOCKED_TAX</b>). See the <a href="#/pools">Pools</a> page.</p>
    </section>
  );
}

function SplitTable({ usdcIn }: { usdcIn: bigint }) {
  const s = splitV4(usdcIn);
  return (
    <table className="sim ntab" aria-label="90/8/2 split"><tbody>
      <tr><td>90 %</td><td>liquidity budget (the HotZap spends it)</td><td><b>{formatUnits(s.lp, 6, 6)} USDC</b></td></tr>
      <tr><td>8 %</td><td>your reserve, withdrawable by you at any time</td><td>{formatUnits(s.reserve, 6, 6)} USDC</td></tr>
      <tr><td>2 %</td><td>community allocation (booked in <code>community_total</code>; no creator withdrawal)</td><td>{formatUnits(s.community, 6, 6)} USDC</td></tr>
    </tbody></table>
  );
}

function QuoteTable({ s }: { s: Sim }) {
  return (
    <>
      <p><span className={`badge ${s.source === "LIVE" ? "confirmed" : "neutral"}`} data-testid="quote-source">{s.source === "LIVE" ? "LIVE" : "RECORDED"}</span> <small className="muted">{s.label} · Rhea <code>quote</code> + <code>predict_hotzap</code> views, the planner of the dashboard</small></p>
      <table className="sim ntab" aria-label="NEARLY contribution quote"><tbody>
        <tr><td>Sent</td><td>{formatUnits(s.usdcIn, 6, 6)} USDC → LP budget {formatUnits(s.split.lp, 6, 6)} · reserve {formatUnits(s.split.reserve, 6, 6)} · community {formatUnits(s.split.community, 6, 6)}</td></tr>
        <tr><td>Spent by the zap</td><td>{formatUnits(s.spend, 6, 6)} USDC: {formatUnits(s.usdcToX, 6, 6)} → NEARLY ({(s.shareX * 100).toFixed(1)} %), {formatUnits(s.usdcToY, 6, 6)} → wNEAR</td></tr>
        <tr><td>Swap outputs</td><td><b>{formatUnits(s.outX, 18, 2)} NEARLY</b> + <b>{formatUnits(s.outY, 24, 4)} wNEAR</b> (min outs {formatUnits(s.minX, 18, 2)} / {formatUnits(s.minY, 24, 4)})</td></tr>
        <tr><td>Into the position</td><td>{formatUnits(s.needX, 18, 2)} NEARLY + {formatUnits(s.needY, 24, 4)} wNEAR → {s.liquidity.toString()} DCL liquidity units</td></tr>
        <tr><td>Left over (recoverable)</td><td>{formatUnits(s.leftX, 18, 2)} NEARLY + {formatUnits(s.leftY, 24, 4)} wNEAR (≈ {(s.leftBps / 100).toFixed(2)} %)</td></tr>
        <tr><td>Range</td><td>[{s.left}, {s.right}] = {px(s.left)} → {px(s.right)} wNEAR per NEARLY; price now {px(s.point)}</td></tr>
        <tr><td>Price impact</td><td>{s.impactBps === null ? "unavailable (no quote for the small leg)" : <>NEARLY leg <b>{(s.impactBps / 100).toFixed(2)} %</b> (Rhea quote of the full leg vs 1/1000 of it, scaled){s.impactBps > 1000 && <> — <span className="badge failed">above the 10 % impact guard of the sandbox configuration: TreasuryDCL would refuse it</span></>}</>}</td></tr>
      </tbody></table>
      <p className="muted small">Fees inside these numbers: Rhea's pool fees (0.01 % on USDC/wNEAR, 1 % on NEARLY/wNEAR) are already deducted by <code>quote</code>. A 1 % slippage guard sets the minimums. Not included: bridge cost (no mainnet bridge is chosen), gas, DCL storage (0.5 NEAR once + 0.1 NEAR registration).</p>
    </>
  );
}

function Conversion({ s }: { s: Sim | null }) {
  const f = (v: bigint | undefined, d: number, n: number) => (s && v !== undefined ? formatUnits(v, d, n) : "—");
  return (
    <section className="card" aria-label="NEARLY step 5 Conversion">
      <h3>5 · How the USDC becomes a NEARLY position</h3>
      <ol className="signs">
        <li><b>Solana → NEAR.</b> Today SOL2NEAR bridges <b>devnet</b> USDC to <b>testnet</b> through Tidepool (community sandbox, not NEAR Intents) — proven with transaction hashes (Proofs page, G7). <span className="badge failed">No mainnet bridge</span> is wired: NEARLY's pool needs mainnet USDC.</li>
        <li><b>Treasury intake</b> (<code>ft_transfer_call</code> to TreasuryDCL, <code>{"{\"action\":\"deposit\"}"}</code>): 90/8/2 → LP budget {f(s?.split.lp, 6, 6)} USDC.</li>
        <li><b>One Rhea HotZap</b> (<code>execute_dcl_lp</code>, creator only): {f(s?.usdcToX, 6, 6)} USDC → wNEAR → NEARLY, {f(s?.usdcToY, 6, 6)} USDC → wNEAR, then <code>add_liquidity</code> in [{s?.left ?? "—"}, {s?.right ?? "—"}]. Swaps and add run in <b>one DCL receipt</b>: all apply or none (sandbox E4b, F1).</li>
        <li><b>Guards before sending</b>: creator only, range on the 200 grid and around the price, slippage ≤ 1 % of Rhea's own quote, price impact ≤ 10 %, plan deadline (sandbox E1–E4b, F4 refused them).</li>
        <li><b>Confirmation</b>: the Treasury reads the new position back from the DCL (<code>list_liquidities</code>, <code>get_liquidity_view</code>) and records lpt_id, liquidity and amounts; leftovers ({f(s?.leftX, 18, 2)} NEARLY + {f(s?.leftY, 24, 4)} wNEAR) stay booked to the deposit.</li>
      </ol>
      {!s && <p className="muted">Get a quote in step 4 to fill the amounts.</p>}
      <button disabled title="No SOL2NEAR contract on mainnet; the public demo has no signing code">Execute on mainnet — not available</button>
    </section>
  );
}

function Position({ s, point }: { s: Sim | null; point: number }) {
  const [l, r] = s ? [s.left, s.right] : rangeAround(point, recorded.input.half_width_points, C.pointDelta);
  const st = rangeStatus(point, l, r, "NEARLY", "wNEAR");
  return (
    <section className="card" aria-label="NEARLY step 6 Position">
      <h3>6 · The DCL position SOL2NEAR would hold for you</h3>
      <dl className="kv">
        <KV k="Position">a <b>new, separate</b> Rhea DCL position (NEP-171 NFT) in <code>{C.poolId}</code>, owned by the TreasuryDCL contract on your behalf</KV>
        <KV k="Range">[{l}, {r}] = {px(l)} → {px(r)} wNEAR per NEARLY · price now {px(point)} → {st.explain}</KV>
        <KV k="Out of range">above the range it is <b>100 % wNEAR</b>, below it is <b>100 % NEARLY</b>, and it <b>earns no fee</b> until the price comes back (measured: sandbox K3–K5, 0 / 0 fees)</KV>
        <KV k="Your rights">only you (the creator) can claim its fees, and after the lock withdraw it: the NFT is transferred to you and the DCL owner is checked (sandbox H3). Your 8 % reserve is withdrawable at any time</KV>
        <KV k="Not yours">the Nearly launch position and its fees (locker <code>{C.locker}</code>); pool-wide counters; any APY — none is computed</KV>
        <KV k="Risks">NEARLY can lose most of its value; concentrated impermanent loss; Rhea's DAO can upgrade the DCL; TreasuryDCL is unaudited; ≤ 40 positions per Treasury (DCL slots)</KV>
        <KV k="FUEL">{DCL_FUEL_STATUS}: the deployed FUEL only reads the V3 Treasury and Ref pool #2951</KV>
      </dl>
    </section>
  );
}

type Step = (typeof proof.steps)[number];
const STEP_LABEL: Record<string, string> = { A: "Code", B: "Local market", C: "Setup checks", D: "Intake 90/8/2", E: "Guards", F: "Position + impact guard", G: "Fees", K: "Out of range", H: "Lock & exit", J: "Leftovers", R: "Final books", S: "Gift attack" };

function SandboxProof() {
  const [open, setOpen] = useState<string | null>(null);
  const [group, setGroup] = useState("all");
  const s = proof.summary;
  const pv = proof.provenance;
  const rows = useMemo(() => proof.steps.map((x, i) => ({ ...x, i })).filter((x) => group === "all" || x.step.startsWith(group)), [group]);
  return (
    <section className="card" aria-label="NEARLY step 7 Sandbox proof">
      <h3>7 · Proof of execution <span className="badge pending">LOCAL SANDBOX</span></h3>
      <div className="banner sim" role="note">LOCAL SANDBOX — a fresh local neard chain, not testnet, not mainnet. Real code (byte-identical to mainnet), local state, test tokens with no value. Recorded replay of <code>{proof.scenario}</code>; reproduce it with <code>bash scripts/proofs/nearly-proof.sh</code>.</div>
      <table className="sim ntab" aria-label="Code provenance"><tbody>
        {([["Rhea DCL", pv.dcl], ["NEARLY token code", pv.nearly_token], ["wNEAR", pv.wrap]] as const).map(([n, w]) => (
          <tr key={n}><td>{n}</td><td><code>{w.code_hash_base58.slice(0, 10)}…</code> sha256 <code>{w.sha256.slice(0, 10)}…</code></td><td>{w.identical_to_mainnet ? <span className="badge confirmed">= mainnet code</span> : <span className="badge failed">differs</span>}</td></tr>
        ))}
        <tr><td>TreasuryDCL</td><td>sha256 <code>{pv.treasury_dcl.sha256.slice(0, 10)}…</code> (cargo-near 0.22.0)</td><td><span className="badge neutral">not deployed anywhere</span></td></tr>
      </tbody></table>
      <ul className="checks" aria-label="Sandbox proof summary">
        <li className="ok"><b>✓ Token</b> {s.token_identity}</li>
        <li className="ok"><b>✓ Position</b> <code>{s.position!.lpt_id}</code>, liquidity {s.position!.liquidity}, range [{s.position!.range.join(", ")}] — DCL owner <code>{s.position!.owner_on_dcl}</code>, NFT owner <code>{s.position!.nft_owner}</code></li>
        <li className="ok"><b>✓ 90/8/2</b> 20 USDC → {formatUnits(s.split_90_8_2!.lp_budget, 6, 2)} / {formatUnits(s.split_90_8_2!.reserve, 6, 2)} / {formatUnits(s.split_90_8_2!.community, 6, 2)}; {formatUnits(s.position!.usdc_used, 6, 2)} USDC used, the rest back to the reserve</li>
        <li className="ok"><b>✓ Books</b> = real balances at {s.books_equal_real_balances_checks.join(", ")}</li>
        <li className="ok"><b>✓ Exit</b> NFT owner after the lock: <code>{s.final_owner_after_exit}</code></li>
        <li className="ok"><b>✓ Refused</b> {s.refusals.length} attempts: {s.refusals.map((r) => r.step).join(", ")}</li>
      </ul>
      <div className="watch">
        <label htmlFor="pgroup">Steps</label>
        <select id="pgroup" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="all">all ({proof.steps.length})</option>
          {Object.entries(STEP_LABEL).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
        </select>
      </div>
      <table className="sim proofsteps" aria-label="Sandbox steps"><tbody>
        {rows.map((x) => <ProofRow key={x.i} x={x} open={open === String(x.i)} onToggle={() => setOpen(open === String(x.i) ? null : String(x.i))} />)}
      </tbody></table>
    </section>
  );
}

function ProofRow({ x, open, onToggle }: { x: Step & { i: number }; open: boolean; onToggle: () => void }) {
  const refused = x.outcome === "failure" || "refused_on_chain" in x;
  const why = "job_failed_reason" in x ? (x as { job_failed_reason: string }).job_failed_reason : "error" in x ? (x as { error: string }).error : null;
  const call = x.calls[0] as { contract: string; method: string } | undefined;
  return (
    <>
      <tr data-step={x.step}>
        <td><b>{x.step}</b></td>
        <td>{x.what}{call && <><br /><code className="small">{call.contract} · {call.method}</code></>}{why && <><br /><small className="muted">{why}</small></>}</td>
        <td><span className={`badge ${refused ? "failed" : "confirmed"}`}>{refused ? "REFUSED" : x.outcome === "view" ? "VIEW" : "OK"}</span></td>
        <td>{x.calls.length > 0 && <button className="ghost" onClick={onToggle} aria-expanded={open}>{open ? "hide" : "proof"}</button>}</td>
      </tr>
      {open && <tr><td colSpan={4}><pre className="json">{JSON.stringify(x.calls, null, 1)}</pre></td></tr>}
    </>
  );
}

function FeesExit() {
  const s = proof.summary;
  const g4 = proof.steps.find((x) => x.step === "G4")?.calls[0]?.result as { fee_x: string; fee_y: string } | undefined;
  const k5 = proof.steps.find((x) => x.step === "K5")?.calls[0]?.result as { narrow_unclaimed: string[] } | undefined;
  return (
    <section className="card" aria-label="NEARLY step 8 Fees and exit">
      <h3>8 · Fees and withdrawal</h3>
      <h4>Trading fees — possible, never guaranteed</h4>
      <ul className="checks">
        <li>A position earns its share of the 1 % swap fee only while the price is inside its range. Rhea keeps {dclMeta.protocol_fee_rate / 100} % of swap fees as protocol fee (<code>protocol_fee_rate</code> {dclMeta.protocol_fee_rate}).</li>
        <li><span className="badge pending">LOCAL SANDBOX</span> test trades produced <b>{formatUnits(s.test_fees_claimed!.fee_x, 18, 4)}</b> (NEARLY-code token) + <b>{formatUnits(s.test_fees_claimed!.fee_y, 24, 6)}</b> wNEAR, booked exactly as the DCL reported them (G3). A second claim booked {g4 ? `${g4.fee_x} / ${g4.fee_y}` : "0 / 0"} (G4). Out of range: {k5 ? k5.narrow_unclaimed.join(" / ") : "0 / 0"} (K5). <b>These are test numbers, not a forecast.</b></li>
        <li>No APY is shown anywhere: real fees depend on future NEARLY volume inside your range.</li>
      </ul>
      <h4>Withdrawal conditions (contract rules, all tested in the sandbox)</h4>
      <ul className="checks">
        <li><b>During the lock</b>: <code>withdraw_position</code> is refused (H1); fees can still be claimed by you (<code>claim_fees</code>), nobody else (G2).</li>
        <li><b>After the lock</b>: <code>withdraw_position</code> (1 yocto) transfers the NFT to you; the DCL owner is checked (H3: <code>{s.final_owner_after_exit}</code>). A second exit and a claim after exit are refused (H4, H5).</li>
        <li><b>Then on Rhea, yourself</b>: <code>remove_liquidity</code> partly or fully (H6, H7).</li>
        <li><b>Leftovers and claimed fees</b>: <code>withdraw_dex_balance</code> then <code>withdraw_token</code> — recovered {formatUnits(s.recovered!.x, 18, 4)} + {formatUnits(s.recovered!.y, 24, 6)} wNEAR to the atomic unit (J2); a second recovery is refused (J3).</li>
        <li><b>Before any zap</b>: <code>abort</code> returns the whole budget to your reserve (F5).</li>
      </ul>
      <h4>Before a real NEARLY contribution could exist</h4>
      <ul className="checks">
        <li className="ko">a mainnet bridge for USDC (Tidepool is a testnet sandbox), a TreasuryDCL deployed on mainnet, an audit, and SOL2NEAR leaving its testnet-only rule — none of which is done.</li>
      </ul>
      <button disabled title="No SOL2NEAR contract on mainnet; the public demo has no signing code">Fund NEARLY on mainnet — not available</button>
    </section>
  );
}
