// V4.2A — Rhea DCL / Nearly memecoin pools on the Pools page. READ ONLY / NOT DEPLOYED.
// Pool cards read REAL Nearly pools on mainnet through the read-only RPC client (view calls only, never given to
// the wallet code). The estimator calls DCL's own `quote` / `predict_hotzap` views as a mainnet REFERENCE: SOL2NEAR
// funds are testnet, so nothing here can be executed. The position card is a PREVIEW of TreasuryDCL views captured
// in the local sandbox against the real DCL wasm (not testnet, not mainnet).
import { useEffect, useMemo, useState } from "react";
import {
  assessDcl, buildDclPlan, DCL_FUEL_REQUIREMENTS, DCL_FUEL_STATUS, dclPositionState, dclUsdcReconciles, estimateDcl, MAINNET_USDC, NEARLY_DCL_CANDIDATES,
  parsePredictHotzap, pointToPrice, rangeAround, rangeStatus,
  type DclAssessment, type DclCandidate, type DclEstimate, type DclLive, type DclPositionView, type HotzapPrediction, type RawDclPoolFull,
} from "../../../../packages/near-client/src/index.ts";
import sandboxViews from "../../../../packages/near-client/src/fixtures/v42_dcl_sandbox_views.json";
import { formatUnits, parseUnits } from "../format.ts";
import { nearRpc } from "../near/rpc.ts";
import { MAINNET_READ_ONLY_RPCS } from "../pools/live.ts";

const mainnet = nearRpc(MAINNET_READ_ONLY_RPCS);
const SLIPPAGE_BPS = 100;
const TONE: Record<string, string> = {
  FEASIBLE_FOR_LOCAL_DCL_TEST: "refunded", OBSERVE_ONLY: "neutral", BLOCKED_TAX: "failed", BLOCKED_LIQUIDITY: "failed", BLOCKED_ROUTE: "failed", BLOCKED_CONTRACT: "failed",
};

/** view_account on mainnet (the token's global contract hash). Read only. */
async function globalHash(account: string): Promise<string | null> {
  const why: string[] = [];
  for (const url of MAINNET_READ_ONLY_RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: account } }) });
      if (!r.ok) { why.push(`${new URL(url).host}: HTTP ${r.status}`); continue; }
      const j = await r.json();
      if (j.result) return j.result.global_contract_hash ?? null;
      why.push(`${new URL(url).host}: ${JSON.stringify(j.error ?? j).slice(0, 80)}`);
    } catch (e) { why.push(`${new URL(url).host}: ${(e as Error).message}`); }
  }
  throw new Error(`view_account ${account}: every provider failed (${why.join("; ")})`);
}

/** Public mainnet RPCs rate-limit bursts (HTTP 429 seen in e2e): one retry after a pause. */
async function retry<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); } catch (e) {
      if (i >= 2 || !/429|rate|timeout|every provider failed/i.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function readLive(c: DclCandidate): Promise<DclLive> {
  const ref = 100_000_000n;
  const route = [c.usdcPool, c.poolId];
  const q = (amount: bigint) => mainnet.view<{ amount: string }>(c.dex, "quote", { pool_ids: route, input_token: MAINNET_USDC, output_token: c.tokenX, input_amount: String(amount) }).then((r) => BigInt(r.amount)).catch(() => null);
  // sequential on purpose: a burst of parallel views is rate-limited by the public providers
  const pool = await retry(() => mainnet.view<RawDclPoolFull>(c.dex, "get_pool", { pool_id: c.poolId }));
  const meta = await retry(() => mainnet.view<{ state: string }>(c.dex, "get_metadata"));
  const hash = await retry(() => globalHash(c.tokenX));
  const tax = await retry(() => mainnet.view<{ tax: { buy_bps: number; sell_bps: number } | null }>(c.tokenX, "get_tax")).then(
    (t) => (t.tax ? { kind: "READ" as const, buy_bps: t.tax.buy_bps, sell_bps: t.tax.sell_bps } : { kind: "READ" as const, buy_bps: 0, sell_bps: 0 }),
    (e: Error) => (/MethodNotFound|MethodResolveError/.test(e.message) ? { kind: "ABSENT" as const } : { kind: "UNREADABLE" as const, error: e.message }));
  const qRef = await retry(() => q(ref));
  const qSmall = await retry(() => q(ref / 1000n));
  return { pool, tokenGlobalHash: hash, tax, quoteRef: qRef, quoteSmall: qSmall, refUsdc: ref, dexState: meta.state };
}

interface Row { c: DclCandidate; live: DclLive | Error; a: DclAssessment }
const KV = ({ k, children }: { k: string; children: React.ReactNode }) => <div><dt>{k}</dt><dd>{children}</dd></div>;
const price = (c: DclCandidate, point: number) => pointToPrice(point, c.xDecimals, c.yDecimals).toExponential(4);

export function V42Dcl() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string>("dcl:nearly");
  async function load() {
    setBusy(true);
    const r: Row[] = [];
    for (const c of NEARLY_DCL_CANDIDATES) {
      const live = await readLive(c).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
      r.push({ c, live, a: assessDcl(c, live) });
    }
    setRows(r); setReadAt(Date.now()); setBusy(false);
  }
  // on demand only: the public providers rate-limit per IP, and the rest of the dashboard needs them for testnet
  const row = rows?.find((r) => r.c.key === sel) ?? null;
  return (
    <section className="card" aria-label="V4.2A DCL Nearly pools">
      <h3>V4.2A · Rhea DCL / Nearly memecoin pools <span className="badge neutral">READ_ONLY</span> <span className="badge neutral">NOT_DEPLOYED</span></h3>
      <p>
        Real Nearly launches live on <b>Rhea DCL</b> (concentrated liquidity, one NFT per position). SOL2NEAR would open an <b>additional, separate</b> position for
        the creator who funds it. It never touches the launch position, which belongs to the Nearly locker, and it never earns the Nearly creator's launch fees.
      </p>
      <p className="muted">
        These pools are on <b>mainnet</b>: read here with public view calls only. SOL2NEAR funds are testnet (Tidepool USDC), so no card is executable. The
        TreasuryDCL contract exists only in a local sandbox (real DCL code, local state). Positions are <b>{DCL_FUEL_STATUS}</b>.
      </p>
      <div className="watch">
        <button onClick={load} disabled={busy}>{busy ? "Reading mainnet…" : rows ? "Refresh" : "Read the 3 Nearly pools (mainnet, read-only)"}</button>
        {readAt && <small>read {new Date(readAt).toLocaleTimeString()} · registry v1 · 3 pools examined of {">"}3 000 Nearly/wNEAR pools</small>}
      </div>
      <div className="poolgrid">
        {rows?.map((r) => <DclPoolCard key={r.c.key} row={r} selected={r.c.key === sel} onSelect={() => setSel(r.c.key)} />)}
      </div>
      {row && !(row.live instanceof Error) && <DclEstimator row={row} live={row.live} />}
      <DclPositionPreview />
    </section>
  );
}

function DclPoolCard({ row, selected, onSelect }: { row: Row; selected: boolean; onSelect: () => void }) {
  const { c, live, a } = row;
  return (
    <article className={`card dclpool ${selected ? "sel" : ""}`} data-dcl={c.key} aria-label={`DCL pool ${c.symbol}`}>
      <header className="poolhead">
        <b>{c.symbol} / wNEAR</b>
        <span className={`badge ${TONE[a.verdict]}`}>{a.verdict.replaceAll("_", " ")}</span>
        <span className="badge neutral">DCL</span>
        <span className="badge refunded">MAINNET · read-only</span>
      </header>
      <dl className="kv">
        <KV k="Memecoin"><code>{c.tokenX}</code> · {c.xDecimals} dec. · Nearly launch #{c.launchId}</KV>
        <KV k="DCL pool"><code>{c.poolId}</code> on <code>{c.dex}</code></KV>
        {!(live instanceof Error) && (
          <>
            <KV k="Price">{price(c, live.pool.current_point)} wNEAR per {c.symbol} <small className="muted">(point {live.pool.current_point})</small></KV>
            <KV k="Liquidity">active {BigInt(live.pool.liquidity) > 0n ? "yes" : "none"} · {live.pool.total_liquidity && BigInt(live.pool.total_liquidity) > BigInt(live.pool.liquidity) ? "other positions exist beside the launch position" : "only the launch position"}</KV>
            <KV k="Pool totals">{formatUnits(live.pool.total_x, c.xDecimals, 0)} {c.symbol} · {formatUnits(live.pool.total_y, 24, 2)} wNEAR <small className="muted">(all positions + orders, not TVL in USD)</small></KV>
            <KV k="Fee tier">{live.pool.fee / 10_000} % (DCL tier {live.pool.fee}), point spacing {live.pool.point_delta}</KV>
          </>
        )}
        <KV k="Launch position"><code>#{c.lockerLptId.split("#")[1]}</code> owned by <code>{c.locker}</code>, range [{c.lockerRange.join(", ")}] — <b>not SOL2NEAR's</b></KV>
        <KV k="Route">USDC → wNEAR (<code>…|wrap.near|100</code>) → {c.symbol}, both on the DCL</KV>
      </dl>
      <ul className="checks">
        {a.checks.map((k) => <li key={k.id} className={k.ok ? "ok" : "ko"}><b>{k.ok ? "✓" : "✗"} {k.id}</b> {k.detail}</li>)}
      </ul>
      <p className="observe"><b>Not executable.</b> {a.verdict === "FEASIBLE_FOR_LOCAL_DCL_TEST" ? "Same code and pool type reproduced in the local sandbox; a funded position needs mainnet assets SOL2NEAR does not use." : a.reasons.find((x) => !x.startsWith("network")) ?? a.reasons[0]}</p>
      <button className="ghost" onClick={onSelect} disabled={selected}>{selected ? "Estimator below" : "Estimate (read-only)"}</button>
    </article>
  );
}

function DclEstimator({ row, live }: { row: Row; live: DclLive }) {
  const { c } = row;
  const [usd, setUsd] = useState("100");
  const [half, setHalf] = useState(20_000);
  const [res, setRes] = useState<{ est: DclEstimate; pr: HotzapPrediction; plan: { left: number; right: number; shareX: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const atomic = parseUnits(usd, 6);
  const [left, right] = useMemo(() => rangeAround(live.pool.current_point, half, c.pointDelta), [live, half, c]);
  useEffect(() => { setRes(null); }, [usd, half, c.key]);
  async function run() {
    if (!atomic) return;
    setBusy(true); setErr(null);
    try {
      const usdcIn = BigInt(atomic);
      const spend = (usdcIn * 9000n) / 10_000n;
      const route = { x: [c.usdcPool, c.poolId], y: [c.usdcPool] };
      const quote = async (toX: bigint, toY: bigint): Promise<[bigint, bigint]> => {
        const [a, b] = await Promise.all([
          mainnet.view<{ amount: string }>(c.dex, "quote", { pool_ids: route.x, input_token: MAINNET_USDC, output_token: c.tokenX, input_amount: String(toX) }),
          mainnet.view<{ amount: string }>(c.dex, "quote", { pool_ids: route.y, input_token: MAINNET_USDC, output_token: c.tokenY, input_amount: String(toY) }),
        ]);
        return [BigInt(a.amount), BigInt(b.amount)];
      };
      const predict = async (toX: bigint, toY: bigint, capX: bigint, capY: bigint) => {
        const v = await mainnet.view(c.dex, "predict_hotzap", {
          token_in: MAINNET_USDC, amount_in: String(toX + toY),
          swap_infos: [
            { pool_ids: route.x, input_token: MAINNET_USDC, output_token: c.tokenX, amount_in: String(toX), min_output_amount: "0" },
            { pool_ids: route.y, input_token: MAINNET_USDC, output_token: c.tokenY, amount_in: String(toY), min_output_amount: "0" },
          ],
          add_liquidity_infos: [{ pool_id: c.poolId, left_point: left, right_point: right, amount_x: String(capX), amount_y: String(capY), min_amount_x: "0", min_amount_y: "0" }],
        });
        const p = parsePredictHotzap(v, c.tokenX, c.tokenY);
        if (!p) throw new Error("predict_hotzap: unexpected result");
        return p;
      };
      const r = await buildDclPlan({ spend, left, right, slippageBps: SLIPPAGE_BPS, deadlineNs: 0n, quote, predict });
      setRes({ est: estimateDcl(usdcIn, spend, r.prediction), pr: r.prediction, plan: { left, right, shareX: r.shareX } });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const status = rangeStatus(live.pool.current_point, left, right, c.symbol, "wNEAR");
  return (
    <section className="card" aria-label="DCL estimator">
      <h4>Estimator · {c.symbol} / wNEAR · mainnet REFERENCE simulation (view calls, no signature)</h4>
      <div className="watch">
        <label htmlFor="dclusd">USDC</label>
        <input id="dclusd" value={usd} onChange={(e) => setUsd(e.target.value)} />
        <label htmlFor="dclw">Range</label>
        <select id="dclw" value={half} onChange={(e) => setHalf(Number(e.target.value))}>
          <option value={5_000}>narrow ±5 000 points (≈ ×/÷ 1.65)</option>
          <option value={20_000}>wide ±20 000 points (≈ ×/÷ 7.4)</option>
          <option value={50_000}>very wide ±50 000 points (≈ ×/÷ 148)</option>
        </select>
        <button onClick={run} disabled={!atomic || busy}>{busy ? "Simulating…" : "Simulate (read-only)"}</button>
      </div>
      <ul className="checks">
        <li>Range [{left}, {right}] = {price(c, left)} → {price(c, right)} wNEAR per {c.symbol}; price now {price(c, live.pool.current_point)} ({status.inRange ? "inside" : "outside"})</li>
        <li className="muted">One position, one range fixed before signature, no rebalancing, no leverage. If the price leaves the range, the position stops earning and ends up entirely in one asset (measured on the real DCL code).</li>
      </ul>
      {err && <p className="badge failed">{err}</p>}
      {res && (
        <ul className="checks" aria-label="DCL estimate">
          <li>Split 90/8/2: LP budget <b>{formatUnits(res.est.lpBudget, 6, 6)} USDC</b> · creator reserve {formatUnits(res.est.reserve, 6, 6)} · community {formatUnits(res.est.community, 6, 6)}</li>
          <li>Acquisition (one DCL HotZap): {(res.plan.shareX * 100).toFixed(1)} % of the budget → {c.symbol}, the rest → wNEAR, both from USDC through the 0.01 % USDC/wNEAR pool</li>
          <li>Swap outputs (DCL predict_hotzap, swaps in sequence): {formatUnits(res.pr.outX, c.xDecimals, 2)} {c.symbol} + {formatUnits(res.pr.outY, 24, 4)} wNEAR</li>
          <li>Into the position: {formatUnits(res.est.intoPositionX, c.xDecimals, 2)} {c.symbol} + {formatUnits(res.est.intoPositionY, 24, 4)} wNEAR</li>
          <li>Left over in the DEX account (recoverable): {formatUnits(res.est.leftoverX, c.xDecimals, 2)} {c.symbol} + {formatUnits(res.est.leftoverY, 24, 4)} wNEAR (≈ {(res.est.leftoverShareBps / 100).toFixed(2)} %, mostly the ½-slippage margin)</li>
          <li>Slippage guard {SLIPPAGE_BPS / 100} % (min outs at −{SLIPPAGE_BPS / 200} %, liquidity minimums at −{(2 * SLIPPAGE_BPS) / 100} %); pool fee {c.fee / 10_000} % on each swap through the meme pool; {c.symbol} transfer tax: {row.a.checks.find((k) => k.id === "tax")!.ok ? "none (raw token)" : "TAXED — blocked"}</li>
          <li>Technical costs (testnet-measured, not mainnet): DCL storage 0.5 NEAR once + token registration 0.1 NEAR; ≈ 140 Tgas per position (sandbox F1)</li>
          <li className="ko"><b>Not executable:</b> mainnet assets; SOL2NEAR moves testnet USDC only. Fees are not estimated: they depend on future volume inside the range. FUEL: {DCL_FUEL_STATUS}.</li>
        </ul>
      )}
    </section>
  );
}

const STAGES = [
  { key: "position_confirmed", label: "Position confirmed (locked)" },
  { key: "fees_claimed", label: "Fees claimed" },
  { key: "out_of_range", label: "Narrow position, price out of range" },
  { key: "position_withdrawn", label: "Position withdrawn to the creator" },
] as const;

function DclPositionPreview() {
  const [k, setK] = useState<(typeof STAGES)[number]["key"]>("position_confirmed");
  const v = (sandboxViews as unknown as Record<string, DclPositionView>)[k]!;
  const d = v.deposit;
  // the pool's point when that view was captured (not the end of the run)
  const cur = (sandboxViews as unknown as { points: Record<string, number> }).points[k]!;
  const unlock = d.unlock_at ? BigInt(d.unlock_at) : 0n;
  const st = dclPositionState(v, k === "position_confirmed" ? unlock - 1n : unlock + 1n);
  const rs = d.left_point !== null && d.right_point !== null ? rangeStatus(cur, d.left_point, d.right_point, "RAWMEME", "wNEAR") : null;
  return (
    <section className="card" aria-label="DCL position preview">
      <div className="banner sim" role="note">PREVIEW — TreasuryDCL views from a LOCAL SANDBOX run against the real Rhea DCL v2.4.2 and Nearly token wasm. Local test tokens, no value. Not testnet, not mainnet.</div>
      <div className="watch">
        <label htmlFor="dclstage">Stage</label>
        <select id="dclstage" value={k} onChange={(e) => setK(e.target.value as typeof k)}>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <span className="badge pending">{st.state}</span>
      </div>
      <dl className="kv">
        <KV k="Position ID"><code>{d.lpt_id ?? "—"}</code> <small className="muted">(DCL NEP-171 token id)</small></KV>
        <KV k="Creator"><code>{d.creator}</code> · Treasury <code>{v.treasury_id}</code></KV>
        <KV k="Pool"><code>{d.pool_id}</code> on <code>{d.dex}</code></KV>
        <KV k="Range">[{d.left_point}, {d.right_point}] · {rs ? rs.explain : "—"}</KV>
        <KV k="Liquidity">{d.liquidity} DCL units, read back from DCL get_liquidity_view at confirmation</KV>
        <KV k="Assets at entry">{formatUnits(d.position_x, 18, 4)} RAWMEME + {formatUnits(d.position_y, 24, 4)} wNEAR · USDC used {formatUnits(d.usdc_used, 6, 6)} {dclUsdcReconciles(d) ? "✓ reconciles with the budget" : "✗"}</KV>
        <KV k="Fees observed">claimed {formatUnits(d.fees_claimed_x, 18, 6)} RAWMEME + {formatUnits(d.fees_claimed_y, 24, 6)} wNEAR <small className="muted">(DCL remove_liquidity(0) return values; never estimated)</small></KV>
        <KV k="In DEX account">{formatUnits(d.dex_x, 18, 6)} RAWMEME + {formatUnits(d.dex_y, 24, 6)} wNEAR (leftovers + claimed fees) · recovered {formatUnits(d.recovered_x, 18, 4)} / {formatUnits(d.recovered_y, 24, 4)}</KV>
        <KV k="FUEL">{v.fuel_status} — {v.fuel_reason}</KV>
        <KV k="Exit">after the lock, <code>withdraw_position</code> transfers the NFT to the creator (owner checked on the DCL), who then removes liquidity on Rhea; leftovers and claimed fees via <code>withdraw_dex_balance</code> + <code>withdraw_token</code></KV>
      </dl>
      <p className="muted small">{st.detail}. Every action (execute_dcl_lp, claim_fees, withdraw_position, withdraw_dex_balance) is <b>NOT_DEPLOYED</b>: the buttons do not exist on this page.</p>
      <details>
        <summary>What FUEL would need before a DCL position could be rewarded</summary>
        <ul>{DCL_FUEL_REQUIREMENTS.map((r) => <li key={r}>{r}</li>)}</ul>
      </details>
    </section>
  );
}
