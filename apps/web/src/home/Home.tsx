// H6 — landing page (#/) and "How it works" (#/how). Product-first: what SOL2NEAR does, what a visitor can try, what is
// really proven. Every number shown comes from a committed fixture (historical quote pinned to a mainnet block, sandbox
// export) or from the proof ledger; nothing is invented and nothing here can sign.
import { EVIDENCE_LABEL, FEATURES, type Evidence } from "../../../../packages/near-client/src/index.ts";
import recorded from "../../../../packages/near-client/src/fixtures/nearly_reference_sim.json";
import { formatUnits } from "../format.ts";
import { sandboxFacts } from "../proofs/SandboxEvidence.tsx";
import { IconArrow, IconBridge, IconLayers, IconShield } from "../ui/icons.tsx";

const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export function Home() {
  const f = sandboxFacts();
  return (
    <main className="home">
      <section className="hero" aria-label="What SOL2NEAR does">
        <div className="hero-copy">
          <p className="status-line"><span className="dot" aria-hidden="true" /> Read-only demonstration · No real funds required</p>
          <h1>Fuel memecoin liquidity across chains.</h1>
          <p className="lede">Explore how Solana capital can become a verifiable liquidity position on NEAR.</p>
          <div className="cta">
            <a className="btn primary lg" href="#/explore/choose">Explore the demo <IconArrow size={18} /></a>
            <a className="btn ghost lg" href="#/how">How it works</a>
          </div>
        </div>
        <HeroCard />
      </section>

      <section className="concepts" aria-label="Three steps">
        <article>
          <span className="icon-box"><IconBridge /></span>
          <h3>Bring capital from Solana</h3>
          <p>A creator sends USDC they control from Solana; it arrives on NEAR.</p>
        </article>
        <article>
          <span className="icon-box"><IconLayers /></span>
          <h3>Provide liquidity on NEAR</h3>
          <p>A treasury contract puts 90 % of it into a memecoin pool, for the creator.</p>
        </article>
        <article>
          <span className="icon-box"><IconShield /></span>
          <h3>Verify and track the position</h3>
          <p>The position, its owner, its fees and its exit are checked on the exchange itself.</p>
        </article>
      </section>

      <section className="proven" aria-label="What is actually proven">
        <div className="section-head">
          <h2>What is actually proven</h2>
          <p className="muted">Three different levels of evidence, never presented as one transaction.</p>
        </div>
        <ul className="evidence-list">
          <li><span className="net onchain">On-chain · testnet</span><div><b>Solana → NEAR bridge</b><p>2 USDC moved from Solana devnet to NEAR testnet, with both transaction hashes.</p></div></li>
          <li><span className="net onchain">On-chain · testnet</span><div><b>Treasury, liquidity and FUEL</b><p>90/8/2 split, liquidity on a Ref test pool (USDC/wNEAR, not a memecoin), FUEL rewards claimed.</p></div></li>
          <li><span className="net sandbox">Local sandbox</span><div><b>NEARLY memecoin position</b><p>{f.steps} verification steps against the exchange's and the token's real mainnet code ({f.codesMatching}/{f.codesTotal} code hashes match).</p></div></li>
          <li><span className="net read">Mainnet · read-only</span><div><b>NEARLY pool and quotes</b><p>Real pool data and Rhea's own quotes. SOL2NEAR has never executed a mainnet contribution.</p></div></li>
        </ul>
        <a className="link-arrow" href="#/proofs">See every proof <IconArrow size={16} /></a>
      </section>

      <section className="closing" aria-label="Try it">
        <div>
          <h2>Walk through a NEARLY contribution</h2>
          <p className="muted">Choose an amount, preview the position, then check the proof. About a minute, no wallet.</p>
        </div>
        <a className="btn primary lg" href="#/explore/choose">Explore the demo <IconArrow size={18} /></a>
      </section>
    </main>
  );
}

/** A sample position built from the HISTORICAL quote (mainnet block pinned in the fixture): labelled, not executable. */
function HeroCard() {
  const r = recorded;
  return (
    <figure className="hero-card" aria-label="Sample position from a historical quote">
      <div className="hc-head">
        <span className="token-mark" aria-hidden="true">N</span>
        <div><b>NEARLY / wNEAR</b><small>Rhea DCL · NEAR mainnet pool</small></div>
      </div>
      <ol className="hc-route" aria-label="Route">
        <li><span>Solana</span><b>{formatUnits(r.input.usdc_atomic, 6, 0)} USDC</b></li>
        <li><span>To liquidity · 90 %</span><b>{formatUnits(r.split_90_8_2.lp_budget, 6, 0)} USDC</b></li>
        <li><span>Position</span><b>{formatUnits(r.prediction.need_x, 18, 0)} NEARLY<br />+ {formatUnits(r.prediction.need_y, 24, 2)} wNEAR</b></li>
      </ol>
      <figcaption>Historical quote · mainnet block {r.block_height} · {utc(r.block_time_utc)}. Not an executable offer.</figcaption>
    </figure>
  );
}

const EV_CLASS: Record<Evidence, string> = { TESTNET_TX: "ok", DEVNET_BRIDGE: "ok", LIVE_READ: "info", SANDBOX: "warn", SIMULATION: "", NOT_AVAILABLE: "bad" };

export function HowItWorks() {
  return (
    <main className="how">
      <header className="page-head">
        <p className="eyebrow">How it works</p>
        <h1>From a Solana wallet to a NEAR liquidity position</h1>
        <p className="lede">SOL2NEAR is a liquidity router: it is not a bridge, a launchpad or an exchange. It connects them and keeps the proof of where the money went.</p>
      </header>

      <ol className="flow" aria-label="Networks">
        <li>
          <span className="flow-num">1</span><h3>Solana</h3>
          <p>The creator sends USDC they control. Pump.fun / Bags creator fees are <b>not</b> captured automatically.</p>
          <small className="net onchain">Proven: Solana devnet</small>
        </li>
        <li>
          <span className="flow-num">2</span><h3>Cross-chain transfer</h3>
          <p>Tidepool moves the USDC to NEAR. Tidepool is a <b>community sandbox, not NEAR Intents</b>; test tokens have no value.</p>
          <small className="net onchain">Proven: devnet → testnet</small>
        </li>
        <li>
          <span className="flow-num">3</span><h3>NEAR Treasury</h3>
          <p>A contract splits every deposit: <b>90 %</b> liquidity, <b>8 %</b> the creator's reserve, <b>2 %</b> community.</p>
          <small className="net onchain">Proven: NEAR testnet</small>
        </li>
        <li>
          <span className="flow-num">4</span><h3>Liquidity position</h3>
          <p>The liquidity budget becomes a pool position held for the creator, verified on the exchange and locked for a fixed time.</p>
          <small className="net sandbox">Ref test pool on testnet · NEARLY in a local sandbox</small>
        </li>
      </ol>

      <section className="two-col" aria-label="Gains and risks">
        <div className="panel">
          <h3>What a creator may get</h3>
          <p>The trading fees earned by their position (variable, can be zero) and FUEL rewards where the FUEL rules allow it. <b>No yield is promised.</b></p>
        </div>
        <div className="panel">
          <h3>What a creator risks</h3>
          <p>The pooled assets move with the market, a memecoin can lose most of its value, and outside its range a position earns nothing. Test tokens have no value at all.</p>
        </div>
      </section>

      <section className="panel" aria-label="Evidence levels">
        <h3>Two levels of evidence, kept apart</h3>
        <ul className="checks roomy">
          <li><b>Testnet, real transactions:</b> Solana devnet → Tidepool → NEAR testnet → Treasury 90/8/2 → Ref pool #2951 (USDC/wNEAR, not a memecoin) → FUEL.</li>
          <li><b>NEARLY on Rhea DCL, local sandbox:</b> the SOL2NEAR liquidity contract opened, held, claimed and returned a position in a local chain running the byte-identical mainnet code of the exchange and of the token.</li>
          <li className="ko">They were never one transaction: no SOL2NEAR contract exists on mainnet and no NEARLY position has been funded.</li>
        </ul>
        <details className="advanced">
          <summary>Full feature status</summary>
          <div className="scroll-x">
            <table className="dtable" aria-label="Feature status"><tbody>
              {FEATURES.map((x) => (
                <tr key={x.id} data-feature={x.id}><td>{x.label}</td><td><span className={`tag ${EV_CLASS[x.evidence]}`} data-evidence={x.evidence}>{EVIDENCE_LABEL[x.evidence]}</span></td><td className="muted small">{x.proof}</td></tr>
              ))}
            </tbody></table>
          </div>
        </details>
      </section>

      <section className="panel" aria-label="For developers">
        <h3>For developers</h3>
        <p className="muted">The original tools stay available. In the public demo they only read; run the app locally to sign on testnet with your own wallets.</p>
        <ul className="dev-links">
          <li><a href="#/console">Testnet console</a><span>the live testnet journey: wallets, bridge, deposit, liquidity, tracking</span></li>
          <li><a href="#/dashboard">Dashboard</a><span>Treasury accounting, deposits, LP shares</span></li>
          <li><a href="#/reactor">FUEL Reactor</a><span>seasons, supply and rewards</span></li>
          <li><a href="#/pools">Pools</a><span>pool catalogue, live checks, DCL estimator</span></li>
          <li><a href="#/positions">Positions</a><span>V3 positions, V4 pilot, DCL sandbox preview</span></li>
        </ul>
      </section>
      <div className="step-nav"><span /><a className="btn primary" href="#/explore/choose">Explore the demo <IconArrow size={18} /></a></div>
    </main>
  );
}

