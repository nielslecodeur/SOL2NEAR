// One card shape for every position (V3 Classic live, V4.1 Classic, V4.2A DCL). The proof block differs by kind:
// LP shares for Classic, DCL position id + range + liquidity for DCL. The evidence badge says where the data comes from.
import type { PositionEvidence, UnifiedPosition } from "../../../../packages/near-client/src/index.ts";

const EV: Record<PositionEvidence, [string, string]> = {
  TESTNET_CONFIRMED: ["confirmed", "CONFIRMED ON NEAR TESTNET"],
  TESTNET_PENDING: ["pending", "NEAR TESTNET · NOT CONFIRMED AS LP"],
  SANDBOX_PREVIEW: ["pending", "LOCAL SANDBOX PREVIEW · NOT A TESTNET POSITION"],
  NOT_DEPLOYED: ["neutral", "NOT DEPLOYED"],
};
const KV = ({ k, children }: { k: string; children: React.ReactNode }) => <div><dt>{k}</dt><dd>{children}</dd></div>;

export function UnifiedCard({ p }: { p: UnifiedPosition }) {
  const [tone, label] = EV[p.evidence];
  return (
    <article className="card unified" aria-label={`Position ${p.key}`} data-evidence={p.evidence}>
      <header className="poolhead">
        <b>{p.version} · {p.kind}</b>
        <span className={`badge ${tone}`}>{label}</span>
        <span className="badge neutral">{p.state}</span>
      </header>
      <dl className="kv">
        <KV k="Creator">{p.creator}</KV>
        <KV k="Pool">{p.pool}</KV>
        <KV k="Contracts">{p.contracts.map((c) => <code key={c}>{c} </code>)}</KV>
        <KV k="Arrived (net)">{p.netArrived}</KV>
        <KV k="Deployed">{p.deployed}</KV>
        <KV k="Residual">{p.residual}</KV>
        <KV k="Proof">{p.proof.type === "LP_SHARES"
          ? <>LP shares {p.proof.shares} {p.proof.verified ? "· verified on the DEX" : "· not verified"}</>
          : <>DCL position <code>{p.proof.lptId ?? "—"}</code> · range {p.proof.range ? `[${p.proof.range.join(", ")}]` : "—"} · liquidity {p.proof.liquidity} · {p.proof.standard}</>}</KV>
        <KV k="Held on-chain by"><code>{p.onchainHolder}</code> <small className="muted">({p.holderCheck})</small></KV>
        <KV k="Economic owner"><code>{p.economicOwner}</code></KV>
        <KV k="Lock">{p.lock}</KV>
        <KV k="Exit">{p.withdraw}</KV>
        <KV k="Fees observed">{p.feesObserved}</KV>
        <KV k="Fees claimable">{p.feesClaimable}</KV>
        <KV k="FUEL">{p.fuel}</KV>
      </dl>
      {p.history.length > 0 && <details><summary>History ({p.history.length})</summary><ul>{p.history.map((h) => <li key={h}>{h}</li>)}</ul></details>}
    </article>
  );
}
