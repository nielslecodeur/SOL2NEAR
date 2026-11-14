// V4.1B — TreasuryV4 pilot in the dashboard: pool, estimator, review, execution tracker (Pools page) and the
// Position Manager (#/positions). Every state comes from contract / Ref views. Signing is LOCKED in V4.1B:
// every action button is disabled and lists why (signingGate + the contract preconditions).
import { useEffect, useMemo, useState } from "react";
import {
  estimateDeposit, iso, journeyState, positionState, recoveryActions, signingGate, statusName, usdcReconciles, V41_JOURNEY, V41_PILOT,
  v4CallsFor, valueChange, withdrawGate,
  type DerivedState, type Estimate, type FuelEligibility, type RecoveryAction, type V4Call, type V4InFlight, type V4PositionView,
} from "../../../../packages/near-client/src/index.ts";
import { formatUnits, parseUnits } from "../format.ts";
import { SANDBOX_CREATOR, SANDBOX_STAGES, sandboxChain, testnetChain, type V4AccountState, type V4Chain, type V4Ids, type V4PoolState, type V4Source } from "./chain.ts";

const live = testnetChain();
const TONE: Record<string, string> = {
  NOT_DEPLOYED: "neutral", READY: "refunded", DEPOSIT_PENDING: "pending", DEPOSIT_CONFIRMED: "confirmed", SWAP_PENDING: "pending", LP_PENDING: "pending",
  LP_CONFIRMED: "confirmed", LOCKED: "pending", WITHDRAWABLE: "confirmed", WITHDRAW_PENDING: "pending", WITHDRAWN: "neutral", ABORTED: "neutral",
  RECOVERY_REQUIRED: "failed", FAILED: "failed",
};
const fmtNear = (y: bigint) => (y === 0n ? "0" : y === 1n ? "1 yocto" : `${formatUnits(y, 24, 5)} NEAR`);
/** 6 decimals, but never "0" for a non-zero amount (dust of 1 atomic must stay visible). */
const amt = (a: bigint | string, dec: number) => { const v = formatUnits(a, dec, 6); return /^-?0$/.test(v) && BigInt(a) !== 0n ? `${BigInt(a)} atomic` : v; };
const tgas = (g: bigint) => `${g / 10n ** 12n} Tgas`;
/** Testnet min gas price 1e8 yocto/gas: 300 Tgas prepaid costs at most 0.03 NEAR, unused gas is refunded. */
const maxGasCost = (g: bigint) => fmtNear(g * 100_000_000n);

function readStore(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function writeStore(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* per-viewer convenience only */ } }

/** Live testnet by default; the sandbox snapshot is an explicit, bannered preview. */
function useSource(): [V4Chain, V4Source, string, (s: V4Source) => void, (k: string) => void] {
  const [source, setSource] = useState<V4Source>(() => (readStore("sol2near:v4-source") as V4Source) ?? "testnet");
  const [stage, setStage] = useState(() => readStore("sol2near:v4-stage") ?? "lp_confirmed_locked");
  const chain = useMemo(() => (source === "sandbox-snapshot" ? sandboxChain(stage) : live), [source, stage]);
  return [chain, source, stage, (s) => { writeStore("sol2near:v4-source", s); setSource(s); }, (k) => { writeStore("sol2near:v4-stage", k); setStage(k); }];
}

function SourceBar({ source, stage, onSource, onStage }: { source: V4Source; stage: string; onSource: (s: V4Source) => void; onStage: (k: string) => void }) {
  return (
    <>
      <div className="watch">
        <label htmlFor="v4src">Data source</label>
        <select id="v4src" value={source} onChange={(e) => onSource(e.target.value as V4Source)}>
          <option value="testnet">Live NEAR testnet (read only)</option>
          <option value="sandbox-snapshot">PREVIEW: local sandbox snapshot (not testnet)</option>
        </select>
        {source === "sandbox-snapshot" && (
          <select aria-label="Sandbox stage" value={stage} onChange={(e) => onStage(e.target.value)}>
            {SANDBOX_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
      </div>
      {source === "sandbox-snapshot" && (
        <div className="banner sim" role="note">
          LOCAL SANDBOX SNAPSHOT: real TreasuryV4 / Ref views captured in a local near-workspaces run (accounts *.test.near, test token S2NMEME, no value).
          Not testnet, not an investment, never signable.
        </div>
      )}
    </>
  );
}

interface Loaded {
  ids: V4Ids; deploymentLabel: string; deploymentReady: boolean; fuel: FuelEligibility; nowNs: bigint; pool: V4PoolState | null; adminFee: number | null;
  positions: V4PositionView[]; inFlight: V4InFlight | null; refShares: bigint; account: V4AccountState | null; mft: boolean; predict: Record<string, [string, string] | null>;
}

async function load(chain: V4Chain, owner: string | null): Promise<Loaded> {
  const [dep, ids, fuel, nowNs] = await Promise.all([chain.deployment(), chain.ids(), chain.fuel(), chain.nowNs()]);
  const deploymentLabel = dep.state === "SANDBOX_SNAPSHOT" ? "LOCAL SANDBOX SNAPSHOT" : dep.state === "NOT_DEPLOYED" ? "NOT DEPLOYED" : dep.state === "DEPLOYED_NOT_READY" ? `DEPLOYED · NOT READY (${dep.detail})` : "DEPLOYED · awaiting validation";
  const [pool, adminFee, positions, inFlight, refShares] = await Promise.all([chain.pool(), chain.adminFeeBps(), owner ? chain.positions(owner) : Promise.resolve([]), chain.inFlight(), chain.refTreasuryShares()]);
  const [account, mft] = owner ? await Promise.all([chain.account(owner), chain.mftRegistered(owner)]) : [null, false];
  const predict: Record<string, [string, string] | null> = {};
  for (const p of positions) if (statusName(p.deposit.status) === "LpConfirmed") predict[p.deposit.id] = await chain.predictRemove(p.deposit.lp_shares);
  return { ids, deploymentLabel, deploymentReady: dep.state === "READY", fuel, nowNs, pool, adminFee, positions, inFlight, refShares, account, mft, predict };
}

function useLoaded(chain: V4Chain, owner: string | null) {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = () => { setErr(null); load(chain, owner).then(setData, (e) => { setData(null); setErr((e as Error).message); }); };
  useEffect(reload, [chain, owner]);
  return { data, err, reload };
}

const Badge = ({ s }: { s: DerivedState | { state: string } }) => <span className={`badge ${TONE[s.state] ?? "neutral"}`} data-state={s.state}>{s.state}</span>;
const Locked = ({ reasons, label }: { reasons: string[]; label: string }) => (
  <div className="locked-action">
    <button className="ghost locked" disabled>{label}</button>
    <ul className="problems">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
  </div>
);
const CallLine = ({ c }: { c: V4Call }) => (
  <li><code>{c.receiverId}.{c.methodName}</code>({JSON.stringify(c.args)}) · attached {fmtNear(c.deposit)} · {tgas(c.gas)} (max {maxGasCost(c.gas)})</li>
);

// =====================================================================================================
// Pools page: the pilot journey
// =====================================================================================================

export function V4Pilot({ wallet }: { wallet: string | null }) {
  const [chain, source, stage, setSource, setStage] = useSource();
  const owner = source === "sandbox-snapshot" ? SANDBOX_CREATOR : wallet;
  const { data, err, reload } = useLoaded(chain, owner);
  const [amount, setAmount] = useState("20");
  const [quoted, setQuoted] = useState<bigint | null>(null);
  const atomic = parseUnits(amount, 6);
  const ids = data?.ids;
  const est: Estimate | null = useMemo(() => {
    if (!data || !ids) return null;
    return estimateDeposit({
      amountAtomic: atomic ? BigInt(atomic) : null, minDeposit: ids.minDeposit, usdcBalance: data.account?.usdcBalance ?? null,
      creatorUsdcRegistered: data.account?.usdcRegistered ?? null, pool: data.pool, usdcToken: ids.usdc, quotedOut: quoted,
      adminFeeBps: data.adminFee, guards: V41_PILOT.guards, nowNs: data.nowNs, slippageBps: 50,
    });
  }, [data, atomic, quoted]);
  // A real Ref quote for the planned swap, only when a live pool exists.
  useEffect(() => { setQuoted(null); if (est?.plan && data?.pool && source === "testnet") chain.quote(est.plan.swapUsdcIn).then(setQuoted, () => setQuoted(null)); }, [est?.plan?.swapUsdcIn, source]);
  const latest = data?.positions.at(-1) ?? null;
  const journey = data ? journeyState({ deploymentReady: data.deploymentReady, latest, inFlight: data.inFlight, nowNs: data.nowNs }) : null;
  const gate = signingGate({ deploymentReady: !!data?.deploymentReady, network: chain.network, wallet: source === "sandbox-snapshot" ? SANDBOX_CREATOR : wallet });
  const usdc = (a: bigint | string) => amt(a, ids?.usdcDecimals ?? 6);
  const base = (a: bigint | string) => amt(a, ids?.baseDecimals ?? 18);

  return (
    <section className="card pilot" aria-label="V4.1 Classic pilot">
      <h3>V4.1 Classic memecoin pilot · TreasuryV4</h3>
      <p>
        <b>{V41_PILOT.baseSymbol} / USDC</b> on Ref Classic, held by a separate TreasuryV4.{" "}
        <span className="badge neutral" data-testid="deployment">{data?.deploymentLabel ?? (err ? "READ FAILED" : "reading…")}</span>{" "}
        <span className="badge refunded">SANDBOX TEST TOKEN · NO VALUE</span>
      </p>
      <p className="muted">
        It proves the Treasury adapter (deposit → swap → LP → custody → exit) on a test token, <b>not</b> support for a live memecoin.
        Every state below is read from the contracts. Signing is locked in this version.
      </p>
      <SourceBar source={source} stage={stage} onSource={setSource} onStage={setStage} />
      {err && <p className="badge failed">Live read failed: {err}. Nothing is unlocked on a failed read.</p>}

      {/* A. pool */}
      <h4>A · Pool</h4>
      <dl className="kv">
        <div><dt>Pool</dt><dd><code>{ids?.dex ?? V41_PILOT.dex}</code> · Classic simple pool · id {ids?.poolId ?? "not created"} · network {chain.network}</dd></div>
        <div><dt>Tokens</dt><dd><code>{ids?.usdc ?? V41_PILOT.usdcTokenId}</code> ({ids?.usdcDecimals ?? 6} dec.) / <code>{ids?.base ?? V41_PILOT.baseTokenId}</code> ({ids?.baseDecimals ?? 18} dec.)</dd></div>
        <div><dt>Fee</dt><dd>{data?.pool ? <>{data.pool.total_fee} bps (get_pool){est?.lpFeeShareBps !== null && est?.lpFeeShareBps !== undefined && <> · ≈ {est.lpFeeShareBps} bps to LPs after Ref's admin_fee_bps {data.adminFee}</>}</> : "no live pool"}</dd></div>
        <div><dt>Liquidity</dt><dd>{data?.pool ? `${usdc(data.pool.amounts[data.pool.token_account_ids.indexOf(ids!.usdc)] ?? "0")} USDC / ${base(data.pool.amounts[1 - data.pool.token_account_ids.indexOf(ids!.usdc)] ?? "0")} ${V41_PILOT.baseSymbol}` : "none on testnet (pool not created)"}</dd></div>
        <div><dt>Token tax</dt><dd>none: plain NEP-141, fixed supply, no mint / burn / admin</dd></div>
        <div><dt>Route</dt><dd>one hop inside the pool: USDC → {V41_PILOT.baseSymbol}, then add_liquidity (same zap as the proven V3 LPs)</dd></div>
        <div><dt>TreasuryV4</dt><dd><code>{ids?.treasury ?? V41_PILOT.treasuryId}</code> · its pool, tokens and decimals are fixed and checked on-chain in setup</dd></div>
        <div><dt>FUEL</dt><dd>{data ? <><b>{data.fuel.status}</b>{data.fuel.status === "FUEL_NOT_ELIGIBLE" && <>: {data.fuel.reason}</>}</> : "…"}</dd></div>
      </dl>

      {/* B. estimator */}
      <h4>B · Deposit estimator {data?.pool ? (source === "testnet" ? "(live testnet pool)" : "(sandbox snapshot pool, not a quote)") : ""}</h4>
      <div className="watch">
        <label htmlFor="v4amt">USDC amount</label>
        <input id="v4amt" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {est && (
        <div aria-label="Estimate">
          {est.split && <p>Split on-chain (ledger 90/8/2): LP budget <b>{usdc(est.split.lp)}</b> · creator reserve {usdc(est.split.reserve)} · community {usdc(est.split.community)} USDC</p>}
          {est.plan && (
            <ul className="checks">
              <li>Swap {usdc(est.plan.swapUsdcIn)} USDC → ≈ {base(est.plan.expectedBaseOut)} {V41_PILOT.baseSymbol} (estimate){est.quoteMatches !== null && <> · Ref get_return {est.quoteMatches ? "✓ equals the plan" : "✗ differs: requote"}</>}</li>
              <li>Then add liquidity ≈ {usdc(est.plan.usdcLeft)} USDC + {base(est.plan.expectedBaseOut)} {V41_PILOT.baseSymbol}</li>
              {est.estimatedShares !== null && <li>≈ {formatUnits(est.estimatedShares, 24, 6)} LP shares (estimate from the reserves; the contract records what Ref mints)</li>}
              {est.estimatedLeftovers && <li>Potential leftovers ≈ {usdc(est.estimatedLeftovers[0])} / {base(est.estimatedLeftovers[1])} (rounding; recoverable with withdraw_leftover)</li>}
              <li>Price impact {(est.plan.priceImpactBps / 100).toFixed(2)} % (contract limit {V41_PILOT.guards.maxPriceImpactBps / 100} %) · swap fee ≈ {usdc(est.plan.poolFeeUsdc)} USDC</li>
              <li>Max slippage: 0.5 % in the plan, the contract accepts ≤ {V41_PILOT.guards.maxSlippageBps / 100} % vs Ref's own quote at execution</li>
              <li>Lock after the LP: {Number((ids?.lockNs ?? 0n) / 1_000_000_000n)} s · technical costs: see the review</li>
            </ul>
          )}
          {est.problems.length > 0 && <ul className="problems" aria-label="Estimate problems">{est.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <p className="muted small">No yield is computed: pool fees depend on future trading and stay inside the LP shares. Not a guaranteed return.</p>
        </div>
      )}

      {/* C. review */}
      <h4>C · Review (preview, nothing is sent)</h4>
      {est?.plan && est.split ? (
        <div aria-label="Review">
          <dl className="kv">
            <div><dt>From wallet</dt><dd>{owner ?? "no NEAR wallet connected"}</dd></div>
            <div><dt>To</dt><dd><code>{ids?.treasury}</code> (TreasuryV4) · pool {ids?.poolId ?? "not created"}</dd></div>
            <div><dt>Amount</dt><dd>{usdc(BigInt(atomic ?? "0"))} USDC ({atomic} atomic) of <code>{ids?.usdc}</code></dd></div>
            <div><dt>Price limits</dt><dd>min_swap_out {est.plan.plan.min_swap_out} · min_amounts [{est.plan.plan.min_amounts.join(", ")}] (pool order)</dd></div>
            <div><dt>Deadline</dt><dd>{iso(BigInt(est.plan.plan.deadline_ns))} (plan refused or parked after it)</dd></div>
            <div><dt>Lock</dt><dd>{Number((ids?.lockNs ?? 0n) / 1_000_000_000n)} s after the LP is confirmed; exit with withdraw_lp afterwards</dd></div>
            <div><dt>Storage</dt><dd>creator: registered on USDC {fmtBool(data?.account?.usdcRegistered)} · on Ref {fmtBool(data?.account?.refRegistered)} (needed to receive the shares at exit) · TreasuryV4 pays its own add_liquidity storage (0.005 NEAR)</dd></div>
            <div><dt>Risks</dt><dd>test token, shallow pool, impermanent loss; the LP value can fall; fees are not guaranteed; FUEL not eligible</dd></div>
          </dl>
          <p>Operations, each signed separately:</p>
          <ol className="checks">
            <CallLine c={v4CallsFor(ids!).deposit(BigInt(atomic ?? "0"))} />
            <CallLine c={v4CallsFor(ids!).executeLp("<deposit id from the event>", est.plan.plan)} />
          </ol>
          <Locked label="Sign deposit — locked" reasons={gate.reasons} />
        </div>
      ) : <p className="muted">The review needs a pool to plan against{data?.pool ? " and a valid amount" : ": none exists on testnet yet"}.</p>}

      {/* D. tracker */}
      <h4>D · Execution tracker {journey && <Badge s={journey} />}</h4>
      {journey && <p className="muted" data-testid="journey-detail">{journey.detail}</p>}
      <ol className="steps" aria-label="Pilot journey">
        {V41_JOURNEY.map((j) => <li key={j.step}><b>{j.step}</b><div>{j.detail}{j.signs && <> · signed by {j.signs}</>}</div></li>)}
      </ol>
      <p className="muted small">Positions and withdrawals: <a href="#/positions">Positions (V4)</a>. <button className="ghost" onClick={reload}>Refresh</button></p>
    </section>
  );
}

const fmtBool = (b: boolean | null | undefined) => (b === null || b === undefined ? "unknown" : b ? "✓" : "✗");

// =====================================================================================================
// Position Manager
// =====================================================================================================

export function PositionsPage({ wallet }: { wallet: string | null }) {
  const [chain, source, stage, setSource, setStage] = useSource();
  const owner = source === "sandbox-snapshot" ? SANDBOX_CREATOR : wallet;
  const { data, err, reload } = useLoaded(chain, owner);
  return (
    <main className="pools">
      <section className="card">
        <h3>Positions (V4) · TreasuryV4 LP positions</h3>
        <p className="muted">Read from TreasuryV4 (get_creator_deposits, get_position, get_in_flight) and Ref (get_pool_shares, mft_has_registered, predict_remove_liquidity). Signing is locked in this version.</p>
        <SourceBar source={source} stage={stage} onSource={setSource} onStage={setStage} />
        <p>Owner: <code>{owner ?? "connect a NEAR wallet"}</code> · TreasuryV4 <span className="badge neutral" data-testid="deployment">{data?.deploymentLabel ?? (err ? "READ FAILED" : "reading…")}</span> <button className="ghost" onClick={reload}>Refresh</button></p>
        {err && <p className="badge failed">Live read failed: {err}. Nothing is unlocked on a failed read.</p>}
        {data && source === "testnet" && !data.deploymentReady && <p className="muted" data-testid="no-positions">TreasuryV4 is not deployed on testnet: no V4 position can exist yet.</p>}
        {data && data.deploymentReady && owner && data.positions.length === 0 && <p className="muted">No TreasuryV4 position for {owner}.</p>}
      </section>
      {data && owner && data.positions.map((p) => <PositionCard key={p.deposit.id} p={p} d={data} chain={chain} wallet={source === "sandbox-snapshot" ? SANDBOX_CREATOR : wallet} />)}
    </main>
  );
}

function PositionCard({ p, d, chain, wallet }: { p: V4PositionView; d: Loaded; chain: V4Chain; wallet: string | null }) {
  const dep = p.deposit;
  const s = positionState(p, d.inFlight, d.nowNs);
  const usdcIdx = d.pool ? d.pool.token_account_ids.indexOf(d.ids.usdc) : 0;
  const usdc = (a: bigint | string) => amt(a, d.ids.usdcDecimals);
  const base = (a: bigint | string) => amt(a, d.ids.baseDecimals);
  const v = valueChange(dep, d.predict[dep.id] ?? null, usdcIdx);
  const calls = v4CallsFor(d.ids);
  const wg = withdrawGate({ network: chain.network, wallet, view: p, inFlight: d.inFlight, nowNs: d.nowNs, creatorMftRegistered: d.mft, refTreasuryShares: d.refShares, calls });
  const sg = signingGate({ deploymentReady: d.deploymentReady, network: chain.network, wallet });
  const rec = recoveryActions({ view: p, inFlight: d.inFlight, nowNs: d.nowNs, wallet, reserve: d.account?.reserve ?? 0n, baseBalance: d.account?.baseBalance ?? 0n, usdcToken: d.ids.usdc, baseToken: d.ids.base, calls });
  return (
    <article className="card pool" aria-label={`Position ${dep.id}`} data-state={s.state}>
      <header className="poolhead">
        <b>Position #{dep.id}</b> <Badge s={s} /> <span className="badge neutral">contract: {s.contractStatus}</span>
        {chain.network !== "testnet" && <span className="badge refunded">LOCAL SANDBOX · NOT AN INVESTMENT</span>}
      </header>
      <p className="muted" data-testid="state-detail">{s.detail}</p>
      <dl className="kv">
        <div><dt>Economic owner</dt><dd><code>{dep.creator}</code></dd></div>
        <div><dt>Treasury / pool</dt><dd><code>{d.ids.treasury}</code> · <code>{dep.dex}</code> pool {dep.pool_id ?? d.ids.poolId ?? "—"}</dd></div>
        <div><dt>Deposited</dt><dd>{usdc(dep.amount)} USDC → LP budget {usdc(dep.lp_budget)} · reserve {usdc(dep.reserve)} · community {usdc(dep.community)}</dd></div>
        <div><dt>Used (on-chain)</dt><dd>swapped {usdc(dep.usdc_swapped)} USDC · in LP {usdc(dep.usdc_in_lp)} USDC + {base(dep.base_in_lp)} {V41_PILOT.baseSymbol} · {usdcReconciles(dep) ? "✓ USDC reconciles" : "✗ USDC does not reconcile"}</dd></div>
        <div><dt>LP shares</dt><dd>{formatUnits(dep.lp_shares, 24, 6)} · {dep.lp_verified ? "verified on Ref" : "NOT verified"} · Ref shows TreasuryV4 holding {formatUnits(d.refShares, 24, 6)}</dd></div>
        <div><dt>Leftovers</dt><dd>{usdc(dep.dust_usdc)} USDC / {base(dep.dust_base)} {V41_PILOT.baseSymbol} in Ref · recovered {usdc(dep.usdc_recovered)} / {base(dep.base_recovered)} · returned to reserve {usdc(dep.usdc_returned_to_reserve)}</dd></div>
        <div><dt>Created</dt><dd>{iso(BigInt(dep.created_at))}</dd></div>
        <div><dt>Lock ends</dt><dd>{dep.unlock_at ? iso(BigInt(dep.unlock_at)) : "no LP yet"} (chain time now {iso(d.nowNs)})</dd></div>
        <div><dt>Value now</dt><dd>{v ? <>shares redeem {usdc(v.now[usdcIdx]!)} USDC + {base(v.now[1 - usdcIdx]!)} {V41_PILOT.baseSymbol} (Ref predict_remove_liquidity) · change since entry {usdc(v.delta[usdcIdx]!)} USDC / {base(v.delta[1 - usdcIdx]!)} {V41_PILOT.baseSymbol}. Classic fees stay inside the shares and cannot be separated from price moves: <b>not a profit figure</b></> : "no LP shares held by the Treasury for this position"}</dd></div>
        <div><dt>FUEL</dt><dd><b>{p.fuel_status}</b>: {p.fuel_reason}</dd></div>
      </dl>
      <details>
        <summary>History ({dep.marks.length} on-chain stage marks)</summary>
        <ul className="checks">{dep.marks.map((m, i) => <li key={i}>block {m.block} · {iso(BigInt(m.at))} · {m.stage}</li>)}</ul>
        {dep.last_error && <p className="badge failed">last_error: {dep.last_error}</p>}
      </details>

      <h4>Withdraw LP (withdraw_lp)</h4>
      <div aria-label="Withdraw">
        {wg.ok ? <p className="muted">The contract preconditions are met{wg.prerequisites.length ? ", after the prerequisite below" : ""}.</p> : <ul className="problems" aria-label="Withdraw blocked">{wg.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        {wg.prerequisites.map((r) => <p key={r} className="muted">Prerequisite: {r}</p>)}
        {wg.call && <ul className="checks"><CallLine c={wg.call} /></ul>}
        <Locked label="Withdraw LP — locked" reasons={sg.reasons} />
      </div>

      <h4>Recovery</h4>
      {rec.length === 0 ? <p className="muted">Nothing to recover for this position.</p> : rec.map((a) => <RecoveryCard key={a.id} a={a} signing={sg.reasons} />)}
    </article>
  );
}

function RecoveryCard({ a, signing }: { a: RecoveryAction; signing: string[] }) {
  return (
    <div className="transfer" aria-label={`Recovery ${a.id}`}>
      <p><b>{a.title}</b></p>
      <dl className="kv">
        <div><dt>Objective</dt><dd>{a.objective}</dd></div>
        <div><dt>Funds</dt><dd>{a.funds}</dd></div>
        <div><dt>Preconditions</dt><dd>{a.preconditions.join(" · ")}</dd></div>
        <div><dt>Recipient</dt><dd>{a.recipient}</dd></div>
        <div><dt>Risks</dt><dd>{a.risks}</dd></div>
      </dl>
      {a.call && <ul className="checks"><CallLine c={a.call} /></ul>}
      <Locked label={`${a.id} — locked`} reasons={[...a.blockedBy, ...signing]} />
    </div>
  );
}
