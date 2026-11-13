// V4.0 Pool Explorer: verified NEAR memecoin pool catalogue, READ ONLY. Nothing on this page signs, and the
// selection does not change what the deployed Treasury does (its pool is fixed at deployment).
import { useEffect, useMemo, useState } from "react";
import { POOL_REGISTRY_VERSION, selectPool, type Assessment, type LivePool, type PoolDescriptor } from "../../../packages/near-client/src/index.ts";
import { formatUnits, parseUnits, usdc } from "./format.ts";
import { DEFAULT_SLIPPAGE_BPS } from "./near/actions.ts";
import { PilotV41 } from "./PilotV41.tsx";
import { loadSelection, poolReaders, saveSelection, type Catalog, type Preflight, type PoolRow } from "./pools/live.ts";

const readers = poolReaders();
const STATUS_TONE = { ELIGIBLE: "confirmed", OBSERVE_ONLY: "neutral", SUSPENDED: "failed" } as const;

const explorer = (d: PoolDescriptor, account: string) =>
  d.network === "near-testnet" ? `https://testnet.nearblocks.io/address/${account}` : `https://nearblocks.io/address/${account}`;

export function PoolsPage() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => loadSelection());
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try { setCat(await readers.readCatalog()); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const assessments = useMemo(() => new Map((cat?.rows ?? []).map((r) => [r.d.key, r.a] as [string, Assessment])), [cat]);
  // A stored selection is re-validated against every fresh read: it is dropped if the pool is no longer ELIGIBLE.
  useEffect(() => {
    if (!cat || !selected) return;
    const s = selectPool(selected, assessments);
    if (!s.ok) { setNotice(`Previous selection cleared: ${s.reason}`); setSelected(null); saveSelection(null); }
  }, [cat]);

  const choose = (key: string) => {
    const s = selectPool(key, assessments);
    if (!s.ok) return setNotice(s.reason);
    setNotice(null);
    setSelected(key);
    saveSelection(key);
  };
  const sel = selected && cat ? cat.rows.find((r) => r.d.key === selected) ?? null : null;
  const counts = cat ? { eligible: cat.rows.filter((r) => r.a.status === "ELIGIBLE").length, total: cat.rows.length } : null;

  return (
    <main className="pools">
      <section className="card">
        <h3>Pool Explorer · V4.0 (read-only)</h3>
        <p>
          Verified NEAR pools for creator liquidity. Each pool is identified by its <b>exact contract ids</b> and read live from the DEX contract. A pool can be
          selected only if it is on the SOL2NEAR allowlist <b>and</b> passes every live check. Everything else is <b>observe only</b>, with the reasons.
        </p>
        <p className="muted">
          Nothing here signs or moves funds. The selection does not change the deployed Treasury, which can only fund the pool fixed at deployment.
          Mainnet pools are read-only references: SOL2NEAR runs on testnet only.
          Reserves and volumes describe the pool. They are not TVL in USD, not a yield, and they prove no deposit or FUEL right.
        </p>
        <div className="watch">
          <button onClick={load} disabled={loading}>{loading ? "Reading…" : "Refresh"}</button>
          {cat && <small>Registry v{POOL_REGISTRY_VERSION} · {counts!.eligible} selectable of {counts!.total} · read {new Date(cat.readAt).toLocaleTimeString()} · Treasury target {cat.treasury ? <code>{cat.treasury.dexContractId} #{cat.treasury.poolId}</code> : <b>unreadable</b>}</small>}
        </div>
        {cat?.treasuryError && <p className="badge failed">Treasury get_config failed: nothing is selectable ({cat.treasuryError})</p>}
        {error && <p className="badge failed">{error}</p>}
        {notice && <p className="badge pending" role="status">{notice}</p>}
      </section>

      {sel && cat?.treasury && <SelectedPool row={sel} onClear={() => { setSelected(null); saveSelection(null); }} treasury={cat.treasury} />}

      <PilotV41 read={readers.readPilot} />

      <section className="poolgrid">
        {cat?.rows.map((r) => <PoolCard key={r.d.key} row={r} selected={r.d.key === selected} onSelect={() => choose(r.d.key)} />)}
      </section>
    </main>
  );
}

const KV = ({ k, children }: { k: string; children: React.ReactNode }) => <div><dt>{k}</dt><dd>{children}</dd></div>;

function sym(live: LivePool | Error, token: string) {
  return live instanceof Error ? token : live.meta[token]?.symbol ?? token;
}

function PoolCard({ row, selected, onSelect }: { row: PoolRow; selected: boolean; onSelect: () => void }) {
  const { d, live, a } = row;
  const pair = `${sym(live, d.tokenAContractId)} / ${sym(live, d.tokenBContractId)}`;
  const decs = [d.tokenADecimals, d.tokenBDecimals];
  return (
    <article className={`card pool ${selected ? "sel" : ""}`} data-pool={d.key} aria-label={`Pool ${pair}`}>
      <header className="poolhead">
        <b>{pair}</b>
        <span className={`badge ${STATUS_TONE[a.status]}`}>{a.status === "OBSERVE_ONLY" ? "OBSERVE ONLY" : a.status}</span>
        <span className="badge neutral">{d.kind}</span>
        <span className={`badge ${d.network === "near-testnet" ? "pending" : "refunded"}`}>{d.network === "near-testnet" ? "TESTNET" : "MAINNET · read-only"}</span>
        <span className="badge neutral">{d.category === "MEMECOIN" ? "memecoin" : "pilot · not a memecoin"}</span>
      </header>
      <dl className="kv">
        <KV k="DEX"><a href={explorer(d, d.dexContractId)} target="_blank" rel="noreferrer"><code>{d.dexContractId}</code></a> · pool <code>{d.poolId}</code></KV>
        {[d.tokenAContractId, d.tokenBContractId].map((t, i) => (
          <KV key={t} k={`Token ${i === 0 ? "A" : "B"}`}><code>{t}</code> · {sym(live, t)} · {decs[i]} dec.</KV>
        ))}
        {!(live instanceof Error) && (
          <>
            <KV k="Swap fee">{live.feeBps} bps <small className="muted">({live.kind === "CLASSIC" ? "get_pool.total_fee" : "DCL fee tier"}, live)</small></KV>
            <KV k={live.kind === "CLASSIC" ? "Reserves" : "Pool totals"}>{(live.kind === "CLASSIC" ? live.amounts : live.totals).map((x, i) => `${formatUnits(x, decs[i]!, 4)} ${sym(live, live.tokens[i]!)}`).join(" · ")}</KV>
            {live.volumeIn && <KV k="Swap input since creation">{live.volumeIn.map((x, i) => `${formatUnits(x, decs[i]!, 2)} ${sym(live, live.tokens[i]!)}`).join(" · ")} <small className="muted">(cumulative Ref counter, not a period volume)</small></KV>}
          </>
        )}
        <KV k="Token tax">{d.tokenTaxPolicy}</KV>
      </dl>
      <ul className="checks">
        {a.checks.map((c) => <li key={c.id} className={c.ok ? "ok" : "ko"}><b>{c.ok ? "✓" : "✗"} {c.id.replace("_", " ")}</b> {c.detail}</li>)}
      </ul>
      <p className="muted small">{d.categoryEvidence} Identifiers verified on-chain {d.verifiedAt}.</p>
      {a.status === "ELIGIBLE"
        ? <button onClick={onSelect} disabled={selected}>{selected ? "Selected" : "Select this pool"}</button>
        : <p className="observe" aria-label="Why observe only"><b>Not selectable.</b> {a.reasons[0]}</p>}
    </article>
  );
}

function SelectedPool({ row, treasury, onClear }: { row: PoolRow; treasury: NonNullable<Catalog["treasury"]>; onClear: () => void }) {
  const [budget, setBudget] = useState("1.8");
  const [pf, setPf] = useState<Preflight | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const atomic = parseUnits(budget, 6);
  const d = row.d;
  const otherDec = d.tokenAContractId === treasury.usdcToken ? d.tokenBDecimals : d.tokenADecimals;
  const otherSym = sym(row.live, d.tokenAContractId === treasury.usdcToken ? d.tokenBContractId : d.tokenAContractId);

  async function run() {
    if (!atomic) return;
    setBusy(true); setErr(null);
    try { setPf(await readers.preflight(d, treasury, BigInt(atomic))); } catch (e) { setErr((e as Error).message); setPf(null); } finally { setBusy(false); }
  }
  return (
    <section className="card" aria-label="Selected pool preflight">
      <h3>Selected pool · read-only preflight (no signature)</h3>
      <p>
        <b>{sym(row.live, d.tokenAContractId)} / {sym(row.live, d.tokenBContractId)}</b> · <code>{d.dexContractId}</code> #{d.poolId}{" "}
        {d.poolId === treasury.poolId && d.dexContractId === treasury.dexContractId && <span className="badge confirmed">= Treasury pool</span>}{" "}
        <button className="ghost" onClick={onClear}>Clear</button>
      </p>
      {d.category !== "MEMECOIN" && <p className="muted">This is the pilot USDC/wNEAR pool, not a memecoin pool: on testnet no memecoin pool is reachable from the Treasury's USDC (see the cards below).</p>}
      <div className="watch">
        <label htmlFor="lpb">LP budget (USDC)</label>
        <input id="lpb" value={budget} onChange={(e) => { setBudget(e.target.value); setPf(null); }} />
        <button onClick={run} disabled={!atomic || busy}>{busy ? "Quoting…" : "Quote (read-only)"}</button>
        <small>The same plan code as <i>Deploy liquidity</i> (execute_lp), from a fresh get_pool. The swap leg is cross-checked with Ref's own get_return.</small>
      </div>
      {err && <p className="badge failed">{err}</p>}
      {pf && (
        <ul className="checks" aria-label="Preflight result">
          <li>Swap <b>{usdc(pf.swapIn)} USDC</b> → <b>{formatUnits(pf.expectedOut, otherDec, 6)} {otherSym}</b> (min {formatUnits(pf.minOut, otherDec, 6)} with the {DEFAULT_SLIPPAGE_BPS / 100} % slippage guard)</li>
          <li className={pf.refReturn === pf.expectedOut ? "ok" : "ko"}>Ref get_return: {formatUnits(pf.refReturn, otherDec, 6)} {otherSym} {pf.refReturn === pf.expectedOut ? "✓ equals the plan" : "✗ differs from the plan"}</li>
          <li>Then add liquidity: {usdc(pf.usdcLeft)} USDC + {formatUnits(pf.expectedOut, otherDec, 6)} {otherSym}</li>
          <li>Pool fee {pf.feeBps} bps ≈ {usdc(pf.poolFeeIn)} USDC</li>
          <li className={pf.level === "ok" ? "ok" : "ko"}>Price impact {(pf.impactBps / 100).toFixed(2)} % · {pf.level === "ok" ? "below the 3 % warning" : pf.level === "warn" ? "warning (≥ 3 %)" : pf.level === "ack" ? "needs explicit acknowledgement (≥ 10 %)" : "LP would not be offered (≥ 20 %)"}</li>
          <li className="muted">Quoted {new Date(pf.readAt).toLocaleTimeString()}. A quote is not an execution: the real LP still goes through the deposit review and your wallet.</li>
        </ul>
      )}
    </section>
  );
}
