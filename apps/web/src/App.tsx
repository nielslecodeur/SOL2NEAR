import { useEffect, useRef, useState } from "react";
import type { BridgeResult } from "../../../packages/shared/src/crosschain.ts";
import { explorerAccount, explorerBlock, FUEL_ACCOUNT_ID, loadTestnet, TREASURY_ACCOUNT_ID, type FuelPosition, type Season, type Snapshot } from "./chain.ts";
import { demoSnapshot, mockCrosschain } from "./demo.ts";
import { BridgeLive } from "./BridgeLive.tsx";
import { NearPanel } from "./NearPanel.tsx";
import { PoolsPage } from "./PoolsPage.tsx";
import { PositionsPage } from "./v4/V4.tsx";
import { CreatorPortal } from "./portal/CreatorPortal.tsx";
import { UnifiedCard } from "./portal/UnifiedCard.tsx";
import { DclPositionPreview } from "./v4/Dcl.tsx";
import { fromV3Deposit } from "../../../packages/near-client/src/index.ts";
import { ProofsPage } from "./proofs/Proofs.tsx";
import { Home, HowItWorks } from "./home/Home.tsx";
import { EXPLORE_STEPS, NearlyJourney, type ExploreStep } from "./portal/NearlyJourney.tsx";

/** Public read-only demo build (`vite build --mode public`): no wallet or signing code is bundled (see vite.config.ts). */
const READ_ONLY = import.meta.env.VITE_PUBLIC_READ_ONLY === "1";
/** Try Testnet build (`vite build --mode testnet`): real wallet connection, every signature locked. */
const SIGNING_LOCKED = import.meta.env.VITE_SIGNING_LOCKED === "1";
import { bridgeTone, depositStatus, duration, fuel, pct, usdc, wnear, type Tone } from "./format.ts";

// H6 routes. Product: home, how, explore (3 steps), proofs. Developers: console (the former Creator Portal testnet journey,
// also at #/portal), dashboard, vault, reactor, pools, positions — every historical direct route still works.
type Route =
  | { page: "home" } | { page: "how" } | { page: "explore"; step: ExploreStep } | { page: "proofs" } | { page: "console" }
  | { page: "dashboard" } | { page: "vault"; id: string } | { page: "reactor" } | { page: "pools" } | { page: "positions" };
const DEV_PAGES = new Set<Route["page"]>(["console", "dashboard", "vault", "reactor", "pools", "positions"]);
const DEV_LINKS: [string, string, Route["page"][]][] = [
  ["#/console", "Testnet console", ["console"]], ["#/dashboard", "Dashboard", ["dashboard", "vault"]], ["#/reactor", "FUEL Reactor", ["reactor"]],
  ["#/pools", "Pools", ["pools"]], ["#/positions", "Positions", ["positions"]],
];
const REPO = "https://github.com/nielslecodeur/SOL2NEAR";

function parseRoute(): Route {
  // a browser wallet returning with ?transactionHashes= / ?errorCode= lands where the NEAR panel records it (#/console)
  if (/[?&](transactionHashes|errorCode)=/.test(location.search) && !location.hash.replace(/^#\/?/, "")) return { page: "console" };
  const [, page, id] = location.hash.split("/");
  if (page === "vault" && id) return { page: "vault", id };
  if (page === "explore") return { page: "explore", step: EXPLORE_STEPS.find((s) => s.id === id)?.id ?? "choose" };
  if (page === "how") return { page: "how" };
  if (page === "console" || page === "portal") return { page: "console" };
  if (page === "reactor") return { page: "reactor" };
  if (page === "pools") return { page: "pools" };
  if (page === "positions") return { page: "positions" };
  if (page === "dashboard") return { page: "dashboard" };
  if (page === "proofs") return { page: "proofs" };
  return { page: "home" };
}

const Badge = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;

export function App() {
  const [route, setRoute] = useState(parseRoute());
  const [source, setSource] = useState<"testnet" | "demo">(() => (localStorageGet("source") as "demo") ?? "testnet");
  const [account, setAccount] = useState(() => localStorageGet("account") ?? "");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const devMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute());
      if (devMenu.current) devMenu.current.open = false;
      scrollTo({ top: 0 });
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    const t: Partial<Record<Route["page"], string>> = { home: "SOL2NEAR — memecoin liquidity across chains", how: "How it works · SOL2NEAR", explore: "Explore NEARLY · SOL2NEAR", proofs: "Proof · SOL2NEAR" };
    document.title = t[route.page] ?? "Developers · SOL2NEAR (testnet)";
  }, [route.page]);

  const [tidepoolOk, setTidepoolOk] = useState<boolean | null>(null);
  /** The account of the CONNECTED wallet (testnet only), distinct from the watched account. */
  const [walletAccount, setWalletAccount] = useState<string | null>(null);

  // Only the latest request may update the screen: a slower earlier read (other account, or testnet
  // data arriving after a switch to demo) must never overwrite it.
  // `refresh` always reads the CURRENT account: the initial effect may run after a fast first click.
  const requestSeq = useRef(0);
  const accountRef = useRef(account);
  accountRef.current = account;
  async function refresh(forAccount = accountRef.current) {
    const seq = ++requestSeq.current;
    setError(null);
    if (source === "demo") return setSnap(demoSnapshot());
    setLoading(true);
    try {
      const s = await loadTestnet(forAccount.trim());
      if (seq === requestSeq.current) setSnap(s);
    } catch (e) {
      if (seq === requestSeq.current) setError(`Testnet read failed: ${(e as Error).message}`);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    localStorageSet("source", source);
    refresh();
  }, [source]);

  const demo = source === "demo";
  // ONE NEAR panel instance (wallet session): in the page header area, or inside the Creator Portal steps.
  const nearPanel = (
    <NearPanel
      tidepoolReachable={tidepoolOk}
      onAccount={(id) => { setWalletAccount(id); if (id) { setAccount(id); localStorageSet("account", id); refresh(id); } }}
      onChanged={() => refresh()}
    />
  );
  const watch = (a: string) => { setAccount(a); localStorageSet("account", a); refresh(a); };
  const dev = DEV_PAGES.has(route.page);
  const cur = (p: Route["page"]) => (route.page === p ? "page" as const : undefined);
  return (
    <div className="app">
      <a className="skip" href="#content" onClick={(e) => { e.preventDefault(); document.getElementById("content")?.focus(); }}>Skip to content</a>
      <header className="topbar">
        <a href="#/" className="logo" aria-label="SOL2NEAR home">SOL<span>2</span>NEAR</a>
        <nav className="mainnav" aria-label="Main">
          <a href="#/explore" aria-current={cur("explore")}>Explore</a>
          <a href="#/how" aria-current={cur("how")}>How it works</a>
          <a href="#/proofs" aria-current={cur("proofs")}>Proof</a>
          {!READ_ONLY && <a href="#/console" aria-current={cur("console")}>Try Testnet</a>}
        </nav>
        <details className="devmenu" ref={devMenu}>
          <summary className={dev ? "on" : ""}>Developers</summary>
          <div className="devmenu-list">
            {DEV_LINKS.map(([h, label, pages]) => <a key={h} href={h} aria-current={pages.includes(route.page) ? "page" : undefined}>{label}</a>)}
            <a href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
          </div>
        </details>
      </header>

      {READ_ONLY && (
        <div className="statusbar" role="note" data-testid="read-only-banner">
          <span className="dot" aria-hidden="true" /><span><b>Public read-only demo</b> — this site contains no wallet and no signing code: it cannot send any transaction.</span>
        </div>
      )}

      {SIGNING_LOCKED && (
        <div className="statusbar" role="note" data-testid="signing-locked-banner">
          <span className="dot" aria-hidden="true" /><span><b>Try Testnet build</b> — connect a real NEAR testnet wallet and read your account. Signing is locked: this build cannot send any transaction.</span>
        </div>
      )}

      {dev && (
        <div className="devbar" aria-label="Developer settings">
          <Badge tone="pending">TESTNET</Badge>
          <select value={source} onChange={(e) => setSource(e.target.value as "testnet" | "demo")} aria-label="Data source">
            <option value="testnet">Live testnet (read-only)</option>
            <option value="demo">SIMULATED / DEMO DATA</option>
          </select>
          <small>Tidepool, used for the Solana Devnet → NEAR bridge, is a <b>community sandbox, not official NEAR Intents</b>. Test tokens have no value.{READ_ONLY && " To sign on testnet with your own wallets, run the app locally (README)."}</small>
        </div>
      )}
      {dev && demo && <div className="banner sim">SIMULATED / DEMO DATA: nothing on this screen comes from a chain.</div>}

      {dev && !demo && route.page !== "console" && (
        <form className="watch" onSubmit={(e) => { e.preventDefault(); localStorageSet("account", account); refresh(); }}>
          <label htmlFor="acct">Creator account</label>
          <input id="acct" placeholder="you.testnet" value={account} onChange={(e) => setAccount(e.target.value)} />
          <button disabled={loading}>{loading ? "Reading…" : "Load"}</button>
          <small>Watch mode reads public contract state for any account. Signing happens only in your own wallets (NEAR panel, cross-chain card), after a review step.</small>
        </form>
      )}

      {dev && !demo && route.page !== "console" && nearPanel}

      {dev && error && <div className="banner err">{error}</div>}
      {dev && snap && !demo && !snap.deployed.treasury && (
        <div className="banner err">
          Treasury <code>{TREASURY_ACCOUNT_ID}</code> has no contract on testnet yet, so there is no real data to show. Switch to SIMULATED to preview the screens.
        </div>
      )}

      <div id="content" tabIndex={-1} className={dev ? "content dev" : "content"}>
      {route.page === "home" && <Home />}
      {route.page === "how" && <HowItWorks />}
      {route.page === "explore" && <NearlyJourney step={route.step} />}
      {route.page === "proofs" && <ProofsPage />}
      {route.page === "console" && (demo
        ? <main><div className="banner sim">The testnet console has no simulated data: switch to Live testnet.</div></main>
        : <CreatorPortal wallet={walletAccount} account={account} snap={snap} nearPanel={nearPanel} onWatch={watch} />)}
      {snap && route.page === "dashboard" && <Dashboard snap={snap} account={account} onTidepool={setTidepoolOk} />}
      {snap && route.page === "vault" && <Vault snap={snap} id={route.id} />}
      {snap && route.page === "reactor" && <ReactorPage snap={snap} />}
      {route.page === "pools" && (demo
        ? <main><div className="banner sim">The Pool Explorer has no simulated data: switch to Live testnet to read the real DEX pools.</div></main>
        : <PoolsPage wallet={walletAccount} />)}
      {route.page === "positions" && (demo
        ? <main><div className="banner sim">The Position Manager has no simulated data mode: switch to Live testnet (it also offers a labelled local-sandbox preview).</div></main>
        : <>
            <UnifiedPositions snap={snap} account={account} />
            <PositionsPage wallet={walletAccount} />
            <main className="pools"><section className="card"><h3>Positions (V4.2A) · TreasuryDCL — not deployed</h3><DclPositionPreview /></section></main>
          </>)}
      </div>

      <footer className="sitefoot">
        <div className="foot-brand">
          <a href="#/" className="logo">SOL<span>2</span>NEAR</a>
          <p>Solana capital → NEAR memecoin liquidity. A NEAR Hackathon 2026 project on test networks only. Contracts are unaudited.</p>
        </div>
        <nav aria-label="Product">
          <b>Product</b>
          <a href="#/explore">Explore</a><a href="#/how">How it works</a><a href="#/proofs">Proof</a>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <nav aria-label="Developers">
          <b>Developers</b>
          {DEV_LINKS.map(([h, label]) => <a key={h} href={h}>{label}</a>)}
        </nav>
        <p className="foot-contracts">
          Contracts (NEAR testnet): <a href={explorerAccount(TREASURY_ACCOUNT_ID)} target="_blank" rel="noreferrer">{TREASURY_ACCOUNT_ID}</a> ·{" "}
          <a href={explorerAccount(FUEL_ACCOUNT_ID)} target="_blank" rel="noreferrer">{FUEL_ACCOUNT_ID}</a>
        </p>
      </footer>
    </div>
  );
}

function Dashboard({ snap, account, onTidepool }: { snap: Snapshot; account: string; onTidepool: (ok: boolean) => void }) {
  // With a creator loaded: that creator's deposits. Without: the Treasury's global accounting.
  const creator = account.trim() && snap.deposits.length > 0 ? account.trim() : null;
  const sum = (k: "amount" | "lp_budget" | "reserve" | "community") => snap.deposits.reduce((s, d) => s + BigInt(d[k]), 0n);
  const a = snap.accounting;
  const total = creator ? sum("amount") : BigInt(a?.total_received ?? 0);
  const reserve = creator ? sum("reserve") : BigInt(a?.reserve_total ?? 0);
  const community = creator ? sum("community") : BigInt(a?.community_total ?? 0);
  const lpBudget = creator ? sum("lp_budget") : total - reserve - community; // exact: the split is done in atomic units
  const confirmed = snap.deposits.filter((d) => d.status === "LpConfirmed");
  const shares = creator ? confirmed.reduce((s, d) => s + BigInt(d.lp_shares), 0n) : BigInt(a?.recorded_shares ?? 0);
  const scope = creator ? `from ${creator}` : "all creators";
  return (
    <main>
      <section className="grid4">
        <Stat label={`USDC received by Treasury (${scope})`} value={usdc(total)} />
        <Stat label="LP budget (90 %)" value={usdc(lpBudget)} />
        <Stat label="Creator reserve (8 %)" value={usdc(reserve)} />
        <Stat label="Community (2 %)" value={usdc(community)} />
      </section>
      {total > 0n && (
        <div className="split" aria-label="90/8/2 split">
          <span style={{ flex: 90 }}>90 % LP</span><span style={{ flex: 8 }}>8 %</span><span style={{ flex: 2 }} />
        </div>
      )}
      <section className="grid2">
        <div className="card">
          <h3>LP shares held by Treasury ({scope})</h3>
          <p className="big">{wnear(shares)} <small>shares (MFT, 24 dec.)</small></p>
          <p className="muted">
            Ref reports {snap.refTreasuryShares ? wnear(snap.refTreasuryShares) : "—"} shares for the Treasury; recorded{" "}
            {snap.accounting ? wnear(snap.accounting.recorded_shares) : "—"}.{" "}
            {snap.refTreasuryShares && snap.accounting && (BigInt(snap.refTreasuryShares) >= BigInt(snap.accounting.recorded_shares)
              ? <Badge tone="confirmed">BACKED ON REF</Badge> : <Badge tone="failed">NOT BACKED</Badge>)}
          </p>
        </div>
        <BridgeCard demo={snap.source === "demo"} nearAccount={account} onTidepool={onTidepool} />
      </section>
      <section className="card">
        <h3>Vaults &amp; deposits</h3>
        {snap.deposits.length === 0 ? <p className="muted">No deposit for this account.</p> : (
          <div className="table">
            <div className="row head"><span>#</span><span>Amount</span><span>Status</span><span>LP shares</span><span>FUEL</span></div>
            {snap.deposits.map((d) => {
              const st = depositStatus(d.status, d.last_error);
              const p = snap.positions[d.id];
              return (
                <a className="row" key={d.id} href={`#/vault/${d.id}`}>
                  <span>{d.id}</span><span>{usdc(d.amount)} USDC</span><span><Badge tone={st.tone}>{st.label}</Badge></span>
                  <span>{d.status === "LpConfirmed" ? wnear(d.lp_shares) : "—"}</span>
                  <span>{p ? <Badge tone={rewardTone(p.reward_status)}>{p.reward_status}</Badge> : <span className="muted">not registered</span>}</span>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function BridgeCard({ demo, nearAccount, onTidepool }: { demo: boolean; nearAccount: string; onTidepool: (ok: boolean) => void }) {
  const [r, setR] = useState<BridgeResult | null>(null);
  return (
    <div className="card">
      <h3>Cross-chain transfer (Solana Devnet → NEAR)</h3>
      {demo ? (
        <>
          <p className="muted">SIMULATED adapter: switch to Testnet for the real Tidepool client (packages/crosschain).</p>
          <button onClick={() => mockCrosschain.watch("SIMULATED-deposit-address", setR)}>Run simulated transfer</button>
          {r && <p><Badge tone={bridgeTone(r.status)}>{r.status}</Badge> {r.amountOut && `→ ${usdc(r.amountOut)} USDC`}</p>}
        </>
      ) : (
        <BridgeLive nearAccount={nearAccount} onHealth={onTidepool} />
      )}
    </div>
  );
}

function Vault({ snap, id }: { snap: Snapshot; id: string }) {
  const d = snap.deposits.find((x) => x.id === id);
  if (!d) return <main><p className="muted">Deposit #{id} not found for this account.</p></main>;
  const p = snap.positions[id];
  const lp = d.status === "LpConfirmed" || d.status === "LpWithdrawn";
  const steps: { name: string; done: boolean; detail: React.ReactNode }[] = [
    { name: "Deposit", done: true, detail: `${usdc(d.amount)} USDC received (NEP-141 ft_transfer_call)` },
    { name: "Treasury 90/8/2", done: true, detail: `${usdc(d.lp_budget)} LP · ${usdc(d.reserve)} reserve · ${usdc(d.community)} community` },
    { name: "LP position", done: lp, detail: lp
      ? <>{wnear(d.lp_shares)} shares · {usdc(d.usdc_in_lp)} USDC + {wnear(d.wnear_in_lp)} wNEAR in pool {d.pool_id} · {d.lp_verified ? "verified on Ref" : "UNVERIFIED"} · block{" "}
        {d.lp_confirmed_block && <a href={explorerBlock(d.lp_confirmed_block)} target="_blank" rel="noreferrer">{d.lp_confirmed_block}</a>}</>
      : <Badge tone={depositStatus(d.status, d.last_error).tone}>{depositStatus(d.status, d.last_error).label}</Badge> },
    { name: "FUEL eligibility", done: !!p, detail: p
      ? <>season {p.position.season_id} · Ref showed {wnear(p.position.ref_treasury_shares)} Treasury shares ≥ recorded {wnear(p.position.treasury_recorded_shares)}</>
      : lp ? "LP confirmed: call register_position to submit the proof" : "Not eligible: no confirmed LP, so no reward" },
    { name: "Claim", done: p?.reward_status === "Claimed", detail: p
      ? <><Badge tone={rewardTone(p.reward_status)}>{p.reward_status}</Badge> {fuel(p.position.creator_reward)} FUEL to creator · {fuel(p.position.community_reward)} to community reserve</>
      : "—" },
  ];
  return (
    <main>
      <a href="#/dashboard" className="muted">← Dashboard</a>
      <h2>Vault {d.creator} · deposit #{d.id}</h2>
      <ol className="pipeline">
        {steps.map((s) => (
          <li key={s.name} className={s.done ? "done" : ""}><b>{s.name}</b><div>{s.detail}</div></li>
        ))}
      </ol>
      {d.unlock_at && <p className="muted">LP lock: until {new Date(Number(BigInt(d.unlock_at) / 1_000_000n)).toLocaleString()}</p>}
    </main>
  );
}

function ReactorPage({ snap }: { snap: Snapshot }) {
  const r = snap.reactor;
  if (!r) return <main><div className="banner err">FUEL contract <code>{FUEL_ACCOUNT_ID}</code> is not deployed on testnet yet.</div></main>;
  const s = r.current_season;
  const left = BigInt(s.end) - BigInt(r.now);
  const b = r.buckets;
  return (
    <main>
      <section className="reactor">
        <div className="core" aria-label={`Reactor level ${r.level}`}><span>LVL</span><b>{r.level}</b></div>
        <div className="season">
          <h2>Season {s.id} <Badge tone={s.status === "Open" ? "pending" : s.status === "Success" ? "confirmed" : "failed"}>{s.status.toUpperCase()}</Badge></h2>
          <p className="muted">{left > 0n ? `${duration(left)} left` : "Ended: anyone can call close_season"}</p>
          <div className="bar"><div style={{ width: `${pct(s.progress_usdc, s.target_usdc)}%` }} /></div>
          <p><b>{usdc(s.progress_usdc)}</b> / {usdc(s.target_usdc)} USDC of newly locked, verified LP · {s.positions} positions</p>
          <p className="muted">Success → rewards claimable, level up. Failure → rewards return to reserve, level down, burn ≤ {fuel(r.config.season_burn)} FUEL from the burn reserve.</p>
        </div>
      </section>
      <section className="grid4">
        <Stat label="Total supply" value={`${fuel(b.total_supply)} FUEL`} />
        <Stat label="PoL reserve available" value={fuel(b.pol_available)} />
        <Stat label="Committed this season" value={fuel(b.pol_committed)} />
        <Stat label="Distributed to creators" value={fuel(b.pol_distributed)} />
        <Stat label="Community reserve (not distributed)" value={fuel(b.community_reserve)} />
        <Stat label="Burn reserve" value={fuel(b.burn_reserve)} />
        <Stat label="Burned" value={fuel(b.burned_total)} />
        <Stat label="Team (vesting, locked)" value={fuel(b.team_locked)} />
      </section>
      <section className="card">
        <h3>Season history</h3>
        {snap.seasons.length === 0 ? <p className="muted">No season has received a contribution yet.</p> : (
          <div className="table">
            <div className="row head"><span>Season</span><span>Status</span><span>Progress</span><span>Burned</span><span>Level after</span></div>
            {snap.seasons.map((x: Season) => (
              <div className="row" key={x.id}>
                <span>{x.id}</span><span><Badge tone={x.status === "Success" ? "confirmed" : x.status === "Failed" ? "failed" : "pending"}>{x.status}</Badge></span>
                <span>{usdc(x.progress_usdc)} / {usdc(x.target_usdc)}</span><span>{fuel(x.burned)}</span><span>{x.level_after ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="muted">Rule: 1 FUEL per USDC actually in a verified LP (80 % creator / 20 % community reserve), max {fuel(r.config.vault_cap)} FUEL per vault per 30 days, min lock {duration(r.config.min_lock_ns)}.</p>
    </main>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => <div className="stat"><small>{label}</small><b>{value}</b></div>;

function rewardTone(s: FuelPosition["reward_status"]): Tone {
  return s === "Claimable" || s === "Claimed" ? "confirmed" : s === "Forfeited" ? "failed" : s === "NoReward" ? "neutral" : "pending";
}

function localStorageGet(k: string): string | null {
  try { return localStorage.getItem(`sol2near:${k}`); } catch { return null; }
}
function localStorageSet(k: string, v: string) {
  try { localStorage.setItem(`sol2near:${k}`, v); } catch { /* private mode: not persisted */ }
}

/** Where the creator's capital is: V3 Treasury positions read live on testnet, in the common position shape. */
function UnifiedPositions({ snap, account }: { snap: Snapshot | null; account: string }) {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const ps = (snap?.deposits ?? []).map((d) => fromV3Deposit(d as never, snap?.positions[d.id] ?? null, TREASURY_ACCOUNT_ID, nowNs));
  return (
    <main className="pools" aria-label="Unified positions">
      <section className="card">
        <h3>Your positions · V3 Treasury (deployed, live NEAR testnet)</h3>
        <p className="muted">Account <code>{account || "—"}</code>. Classic LP shares held by <code>{TREASURY_ACCOUNT_ID}</code> for you. Below: the V4.1 Classic pilot and the V4.2A DCL adapter, neither deployed (sandbox previews, clearly labelled).</p>
        {snap && ps.length === 0 && <p className="muted">No Treasury deposit for this account.</p>}
      </section>
      {ps.map((p) => <UnifiedCard key={p.key} p={p} />)}
    </main>
  );
}
