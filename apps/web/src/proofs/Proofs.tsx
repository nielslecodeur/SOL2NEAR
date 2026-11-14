// Proofs & documentation (#/proofs): the public proof ledger, read-only. Every hash below is re-verified by
// `node scripts/probes/verify-g6-g7.mjs` / `verify-testnet.mjs` (RPC, no keys). Nothing here signs or sends anything.
import { EVIDENCE_LABEL, FEATURES } from "../../../../packages/near-client/src/index.ts";

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

const DOCS: [string, string][] = [
  ["Proof ledger (G6–G8)", "docs/G8_PROOF_LEDGER.md"],
  ["G8 status: deposit #3, prepared LP, not executed", "docs/G8_FINAL_EXECUTION.md"],
  ["Independent audit simulation (G9)", "docs/G9_INDEPENDENT_AUDIT.md"],
  ["Review without signing (checklist)", "docs/G9_PUBLIC_REVIEW_CHECKLIST.md"],
  ["Rhea DCL / Nearly feasibility (V4.2A, sandbox)", "docs/V4_2A_DCL_FEASIBILITY.md"],
  ["Creator Portal (V4.3A)", "docs/V4_3A_CREATOR_PORTAL.md"],
];

export function ProofsPage() {
  return (
    <main className="pools" aria-label="Proofs and documentation">
      <section className="card">
        <h3>Proofs &amp; documentation</h3>
        <p className="muted">
          Executed transactions on NEAR <b>testnet</b> and Solana <b>devnet</b>. Pool 2951 is a USDC/wNEAR test pool, <b>not a memecoin</b>. Explorers may show a
          bot check to automated tools; every hash is re-verified without keys by <code>node scripts/probes/verify-g6-g7.mjs</code> and{" "}
          <code>verify-testnet.mjs</code> (README, step 8).
        </p>
        <table className="status" aria-label="Executed transactions">
          <tbody>
            {TXS.map((t) => (
              <tr key={t.id} data-proof={t.id}>
                <td><b>{t.id}</b></td>
                <td>{t.what}</td>
                <td><a href={t.url === "sol" ? sol(t.hash) : near(t.hash)} target="_blank" rel="noreferrer"><code>{t.hash.slice(0, 8)}…{t.hash.slice(-4)}</code></a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>Evidence kind of every feature</h3>
        <table className="status" aria-label="Feature evidence">
          <tbody>
            {FEATURES.map((f) => <tr key={f.id}><td>{f.label}</td><td>{EVIDENCE_LABEL[f.evidence]}</td><td className="muted small">{f.proof}</td></tr>)}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>Documentation (GitHub)</h3>
        <ul>{DOCS.map(([t, p]) => <li key={p}><a href={`${REPO}/blob/main/${p}`} target="_blank" rel="noreferrer">{t}</a></li>)}</ul>
        <p className="muted small">
          Known limits: G8 is not completed (deposit #3 holds an LP budget whose plan has 29.13 % price impact and was not authorised); the V4 memecoin
          adapters run only in a local sandbox; the deployed testnet contract accounts still hold a developer full-access key; contracts are unaudited.
        </p>
      </section>
    </main>
  );
}
