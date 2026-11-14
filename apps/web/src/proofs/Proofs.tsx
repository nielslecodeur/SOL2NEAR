// Proof (#/proofs): the public proof ledger, read-only, in two levels (simple / technical). Every hash below is re-verified
// by `node scripts/probes/verify-g6-g7.mjs` / `verify-testnet.mjs` (RPC, no keys). Testnet transactions and the local
// sandbox proof are separate sections and are never merged. Nothing here signs or sends anything.
import { useState } from "react";
import { EVIDENCE_LABEL, FEATURES } from "../../../../packages/near-client/src/index.ts";
import { SandboxSummary, SandboxTechnical } from "./SandboxEvidence.tsx";
import { IconExternal } from "../ui/icons.tsx";

const REPO = "https://github.com/nielslecodeur/SOL2NEAR";
const near = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
const sol = (h: string) => `https://explorer.solana.com/tx/${h}?cluster=devnet`;

/** Executed transactions (NEAR testnet / Solana devnet), from docs/G8_PROOF_LEDGER.md. */
const TXS: { id: string; what: string; hash: string; url: string }[] = [
  { id: "B1", what: "deploy Treasury (SHA-256 73b99075…520e)", hash: "HJTW4c6uNaSVmuzNRG84NcCQaRMeunAoiP3omquNyUpY", url: "" },
  { id: "B4", what: "deploy FUEL (SHA-256 a33678f6…bbac)", hash: "JBdFrx2j7ToEWWY77aKpbpw8B6PivPhowM9ZZWQtrbBP", url: "" },
  { id: "C1", what: "deposit 20 USDC → 18 / 1.6 / 0.4", hash: "AsD2o2aVxkSmhm4c3TVsLs9aZgKjMTog2KW42pieZWzw", url: "" },
  { id: "C2", what: "execute_lp: LP shares held by the Treasury (pool 2951)", hash: "4F2wXqzmyBVaPqKa6mE3KMFjFv2S3U3GxXJYJfNsSSHA", url: "" },
  { id: "C3", what: "verify_liquidity: Ref shares = recorded", hash: "8DCCtF7yafVwXnGhziTAAHvxhS94nZiTPXZk5ry3MrkA", url: "" },
  { id: "C4", what: "FUEL register_position(0)", hash: "CoAgrgQEhmktNEK1hvgZpwUHjsaTR6XvS9z1NSNpLk6o", url: "" },
  { id: "C5", what: "FUEL close_season(0) → Success", hash: "DUuoq2XZsmVbwp8zjzhW3gHRqjiDwokwbTMSNufdhaH9", url: "" },
  { id: "C6", what: "FUEL claim(0) → 7.7414496 FUEL", hash: "6g13fiwvEbSoHhYLXGkDcN9tEsPLG2LXic88bmP3hXxu", url: "" },
  { id: "C7", what: "second claim rejected (expected)", hash: "J8UEKyZyyYpHrzW8HTJiJ1tqtq23GdkX2VA8HdYAoWHi", url: "" },
  { id: "G6-D", what: "dashboard + Meteor: deposit #1", hash: "FaBKjLRUuYMgH4SgVgurTyUinDPvPvdH5Rxc69X1haHV", url: "" },
  { id: "G6-LP", what: "dashboard + Meteor: execute_lp(1)", hash: "CniqxoxZ5qzJBLZ9RCwJ9nH4evbNwaGV6Y1nE4aDbRdN", url: "" },
  { id: "G6-LP2", what: "execute_lp(2)", hash: "CundGCKWCSnC14tTRkaJ8EiRzDRttQvhQ3SjFgfTpHyD", url: "" },
  { id: "G6-CLAIM", what: "FUEL claim(2) → 4.4688424 FUEL", hash: "8CRvXVJgk7sEiapJZSYiiFhhMRANPxZL9rGmAsFsA7F8", url: "" },
  { id: "G7-SOL", what: "Solana devnet: 2 USDC to the Tidepool deposit address", hash: "bGUicpgyYtePFP3BcEXYHQ9me67uqFjFQWmS8FsKWhYSzwpcVDv5SZyyLxYneLX93Bic4JZRFrWvphQUkEs887R", url: "sol" },
  { id: "G7-NEAR", what: "Tidepool settlement: 1.9948 USDC on NEAR testnet", hash: "J58H2uyuGo4wJsjbNuX1AEEwszD4Z8CMAppCqCirRFqf", url: "" },
  { id: "G7-TREAS", what: "Treasury deposit #3 (contains the bridged USDC)", hash: "J7uMjikj935TeunPoHj2i7xrCSSDrYEAmvdHv7DYBdhz", url: "" },
];
const tx = (id: string) => TXS.find((t) => t.id === id)!;
const href = (t: (typeof TXS)[number]) => (t.url === "sol" ? sol(t.hash) : near(t.hash));

/** Simple view: the four capabilities proven on-chain, each with its key transactions. */
const MILESTONES: { title: string; net: string; text: string; ids: string[] }[] = [
  { title: "Solana → NEAR bridge", net: "Solana devnet → NEAR testnet", text: "2 USDC sent from Phantom, 1.9948 USDC settled on NEAR by Tidepool (a community sandbox, not NEAR Intents), then deposited in the Treasury.", ids: ["G7-SOL", "G7-NEAR", "G7-TREAS"] },
  { title: "Treasury V3 · 90/8/2", net: "NEAR testnet", text: "A 20 USDC deposit split on-chain into 18 liquidity / 1.6 creator reserve / 0.4 community.", ids: ["C1", "G6-D"] },
  { title: "Ref liquidity", net: "NEAR testnet", text: "LP shares held by the Treasury in Ref pool #2951 (USDC/wNEAR, not a memecoin) and verified against Ref.", ids: ["C2", "C3", "G6-LP"] },
  { title: "FUEL rewards", net: "NEAR testnet", text: "Position registered, season closed, reward claimed once; the second claim was rejected.", ids: ["C4", "C6", "C7"] },
];

const DOCS: [string, string][] = [
  ["Judge quickstart: reproduce without key, funds or public transaction", "docs/JUDGE_QUICKSTART.md"],
  ["NEARLY memecoin proof: what is demonstrated, on which evidence", "docs/HACKATHON_MEMECOIN_PROOF.md"],
  ["Proof ledger (G6–G8)", "docs/G8_PROOF_LEDGER.md"],
  ["G8 status: deposit #3, prepared LP, not executed", "docs/G8_FINAL_EXECUTION.md"],
  ["Architecture", "docs/ARCHITECTURE.md"],
  ["Independent audit simulation (G9)", "docs/G9_INDEPENDENT_AUDIT.md"],
  ["Review without signing (checklist)", "docs/G9_PUBLIC_REVIEW_CHECKLIST.md"],
  ["Rhea DCL / Nearly feasibility (sandbox)", "docs/V4_2A_DCL_FEASIBILITY.md"],
];

export function ProofsPage() {
  const [view, setView] = useState<"simple" | "technical">("simple");
  const technical = view === "technical";
  return (
    <main className="proofs" aria-label="Proofs and documentation">
      <header className="page-head">
        <p className="eyebrow">Proof</p>
        <h1>What SOL2NEAR has really done</h1>
        <p className="lede">Real transactions on public test networks, and a reproducible local execution on a memecoin's real code. Two levels of evidence, kept apart.</p>
        <div className="segmented" role="group" aria-label="Level of detail">
          <button aria-pressed={!technical} className={!technical ? "on" : ""} onClick={() => setView("simple")}>Simple view</button>
          <button aria-pressed={technical} className={technical ? "on" : ""} onClick={() => setView("technical")}>Technical view</button>
        </div>
      </header>

      <section className="proof-section" aria-label="On-chain testnet proofs">
        <div className="section-head">
          <span className="net onchain">A · On-chain · NEAR testnet & Solana devnet</span>
          <h2>Executed transactions</h2>
          <p className="muted">Test networks and test tokens. Explorers may show a bot check to automated tools; every hash is re-verified without keys by <code>node scripts/probes/verify-g6-g7.mjs</code>.</p>
        </div>
        {!technical ? (
          <div className="milestones">
            {MILESTONES.map((m) => (
              <article key={m.title} className="panel">
                <small className="muted">{m.net}</small>
                <h3>{m.title}</h3>
                <p>{m.text}</p>
                <ul className="txlinks">{m.ids.map((id) => <li key={id}><a href={href(tx(id))} target="_blank" rel="noreferrer">{id} <code>{tx(id).hash.slice(0, 8)}…</code> <IconExternal size={14} /></a></li>)}</ul>
              </article>
            ))}
          </div>
        ) : (
          <div className="scroll-x">
            <table className="dtable" aria-label="Executed transactions">
              <tbody>
                {TXS.map((t) => (
                  <tr key={t.id} data-proof={t.id}>
                    <td><b>{t.id}</b></td>
                    <td>{t.what}</td>
                    <td><a href={href(t)} target="_blank" rel="noreferrer"><code>{t.hash.slice(0, 8)}…{t.hash.slice(-4)}</code></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="alert warn small">Not done on-chain: G8 is not completed (deposit #3 holds an LP budget whose plan has 29.13 % price impact and was not authorised), and withdrawing from the V3 Treasury was never exercised.</p>
      </section>

      <section className="proof-section" aria-label="Local sandbox proof">
        <div className="section-head">
          <span className="net sandbox">B · Local sandbox · real mainnet code</span>
          <h2>NEARLY on Rhea DCL</h2>
        </div>
        <SandboxSummary technical={technical} onTechnical={() => setView(technical ? "simple" : "technical")} />
        {technical && <SandboxTechnical />}
      </section>

      <section className="proof-section" aria-label="Mainnet read-only">
        <div className="section-head">
          <span className="net read">C · Mainnet · read-only</span>
          <h2>NEARLY pool data and quotes</h2>
          <p className="muted">The real pool is read with public view calls and quoted with Rhea's own views: a historical quote pinned to a block, or a live indicative quote. Neither is an executable offer. <a href="#/explore/preview">See the quote</a>.</p>
        </div>
      </section>

      <p className="alert bad small" role="note">A, B and C were never one transaction: no SOL2NEAR contract exists on mainnet and no NEARLY position has been funded.</p>

      {technical && (
        <section className="panel">
          <h3>Evidence kind of every feature</h3>
          <div className="scroll-x">
            <table className="dtable" aria-label="Feature evidence">
              <tbody>
                {FEATURES.map((f) => <tr key={f.id}><td>{f.label}</td><td>{EVIDENCE_LABEL[f.evidence]}</td><td className="muted small">{f.proof}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h3>Documentation (GitHub)</h3>
        <ul className="doclinks">{DOCS.map(([t, p]) => <li key={p}><a href={`${REPO}/blob/main/${p}`} target="_blank" rel="noreferrer">{t}</a></li>)}</ul>
        <p className="muted small">
          Known limits: G8 is not completed; the V4 memecoin adapters run only in a local sandbox; the deployed testnet contract accounts still hold a developer
          full-access key; contracts are unaudited.
        </p>
      </section>
    </main>
  );
}
