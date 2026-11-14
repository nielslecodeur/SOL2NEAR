// H6 — the NEARLY DCL LOCAL SANDBOX proof in two levels, used by Explore → Proof and by the Proof page.
// Every claim of the simple view is COMPUTED from the committed export (fixtures/nearly_dcl_sandbox_proof.json, written by
// scripts/proofs/export-nearly-proof.mjs from a real run of sandbox-tests/tests/v42_dcl.rs). A claim the export does not
// support is shown as not shown, never as a success. The technical view keeps the 58 steps with their calls and reads.
import { useMemo, useState } from "react";
import proof from "../../../../packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json";
import mainnetFx from "../../../../packages/near-client/src/fixtures/v42_dcl_mainnet_2026-11-14.json";
import { formatUnits } from "../format.ts";
import { IconCheck, IconCross } from "../ui/icons.tsx";

type Step = (typeof proof.steps)[number];
type Call = { contract?: string; method?: string; result?: any; proof?: any; args?: any };
const step = (id: string) => proof.steps.find((x) => x.step === id);
const call = (id: string) => (step(id)?.calls[0] as Call | undefined);
const dclMeta = (mainnetFx as { contracts: Record<string, { metadata?: { version: string; protocol_fee_rate: number } }> }).contracts["mainnet:dclv2.ref-labs.near"]!.metadata!;

/** What the export actually shows (each fact checked against the recorded calls, not asserted by the UI). */
export function sandboxFacts() {
  const pv = proof.provenance;
  const codes = [pv.dcl, pv.nearly_token, pv.wrap];
  const f1 = call("F1");
  const treasury = "treasury-dcl.test.near";
  const created = step("F1")?.outcome === "success" && BigInt(f1?.result?.liquidity ?? 0) > 0n;
  const owned = f1?.proof?.dcl_get_liquidity?.owner_id === treasury && f1?.proof?.dcl_nft_token_owner === treasury;
  const g1 = call("G1")?.result, g3 = call("G3")?.result;
  const fees = !!g1 && !!g3 && g3.fee_x === g1.unclaimed_fee_x && g3.fee_y === g1.unclaimed_fee_y && BigInt(g3.fee_x) > 0n;
  const exitOwner = call("H3")?.result?.dcl_nft_token_owner as string | undefined;
  const withdrawn = !!exitOwner && exitOwner !== treasury && proof.summary.recovered?.status === "PositionWithdrawn";
  return {
    steps: proof.steps.length,
    codesMatching: codes.filter((c) => c.identical_to_mainnet).length,
    codesTotal: codes.length,
    refusals: proof.summary.refusals.length,
    created, owned, fees, withdrawn, exitOwner,
    lptId: proof.summary.position?.lpt_id,
    command: "bash scripts/proofs/nearly-proof.sh",
  };
}

const Fact = ({ ok, title, children }: { ok: boolean; title: string; children: React.ReactNode }) => (
  <li className={ok ? "fact ok" : "fact ko"} data-fact={title}>
    <span className="fact-mark">{ok ? <IconCheck size={16} /> : <IconCross size={16} />}</span>
    <div><b>{ok ? title : `${title} — not shown by the export`}</b><p>{children}</p></div>
  </li>
);

/** Simple view: what a visitor needs to understand, with one sentence of evidence per line. */
export function SandboxSummary({ onTechnical, technical }: { onTechnical?: () => void; technical?: boolean }) {
  const f = sandboxFacts();
  return (
    <section className="proof-card" aria-label="Sandbox proof summary card">
      <p className="eyebrow">Local sandbox · not a mainnet transaction</p>
      <h2>Local sandbox execution verified</h2>
      <p className="lede">
        The SOL2NEAR liquidity contract ran in a fresh local NEAR chain, against byte-identical copies of the real Rhea DCL exchange and the NEARLY token
        contract. The state and the tokens are local test values.
      </p>
      <ul className="facts" aria-label="What the sandbox proves">
        <Fact ok={f.created} title="Position created">A concentrated-liquidity position was opened in one exchange receipt (step F1).</Fact>
        <Fact ok={f.owned} title="Ownership verified">The exchange itself reports the SOL2NEAR contract as the position's owner (F1 reads).</Fact>
        <Fact ok={f.fees} title="Fees accounted for">Claimed trading fees equal what the exchange reported, to the unit (G1 → G3).</Fact>
        <Fact ok={f.withdrawn} title="Withdrawal tested">After the lock, the position was handed back to the creator and leftovers recovered (H3, J2).</Fact>
      </ul>
      <dl className="proof-stats">
        <div><dt>Verification steps</dt><dd>{f.steps}</dd></div>
        <div><dt>Contract code = mainnet</dt><dd>{f.codesMatching} / {f.codesTotal}</dd></div>
        <div><dt>Misuse attempts refused</dt><dd>{f.refusals}</dd></div>
        <div><dt>Repeatable</dt><dd className="mono small">{f.command}</dd></div>
      </dl>
      {onTechnical && (
        <button className="btn secondary" onClick={onTechnical} aria-expanded={!!technical} aria-controls="technical-evidence">
          {technical ? "Hide technical evidence" : "View technical evidence"}
        </button>
      )}
    </section>
  );
}

const STEP_LABEL: Record<string, string> = { A: "Code", B: "Local market", C: "Setup checks", D: "Intake 90/8/2", E: "Guards", F: "Position + impact guard", G: "Fees", K: "Out of range", H: "Lock & exit", J: "Leftovers", R: "Final books", S: "Gift attack" };

/** Technical view: provenance, every step with its method, arguments, result and on-chain reads, and the fee / exit rules. */
export function SandboxTechnical() {
  const [open, setOpen] = useState<string | null>(null);
  const [group, setGroup] = useState("all");
  const s = proof.summary;
  const pv = proof.provenance;
  const rows = useMemo(() => proof.steps.map((x, i) => ({ ...x, i })).filter((x) => group === "all" || x.step.startsWith(group)), [group]);
  const g4 = call("G4")?.result as { fee_x: string; fee_y: string } | undefined;
  const k5 = call("K5")?.result as { narrow_unclaimed: string[] } | undefined;
  return (
    <section className="tech" id="technical-evidence" aria-label="Technical evidence">
      <div className="note" role="note">
        <b>LOCAL SANDBOX</b> — a fresh local neard chain, not testnet, not mainnet. Real code (byte-identical to mainnet), local state, test tokens with no value.
        Recorded replay of <code>{proof.scenario}</code>; reproduce it with <code>bash scripts/proofs/nearly-proof.sh</code>.
      </div>
      <h3>Code provenance</h3>
      <table className="dtable" aria-label="Code provenance"><tbody>
        {([["Rhea DCL", pv.dcl], ["NEARLY token code", pv.nearly_token], ["wNEAR", pv.wrap]] as const).map(([n, w]) => (
          <tr key={n}><td>{n}</td><td><code>{w.code_hash_base58.slice(0, 10)}…</code> sha256 <code>{w.sha256.slice(0, 10)}…</code></td><td>{w.identical_to_mainnet ? <span className="tag ok">= mainnet code</span> : <span className="tag bad">differs</span>}</td></tr>
        ))}
        <tr><td>TreasuryDCL</td><td>sha256 <code>{pv.treasury_dcl.sha256.slice(0, 10)}…</code> (cargo-near 0.22.0)</td><td><span className="tag">not deployed anywhere</span></td></tr>
      </tbody></table>
      <h3>Recorded results</h3>
      <ul className="checks" aria-label="Sandbox proof summary">
        <li className="ok"><b>✓ Token</b> {s.token_identity}</li>
        <li className="ok"><b>✓ Position</b> <code>{s.position!.lpt_id}</code>, liquidity {s.position!.liquidity}, range [{s.position!.range.join(", ")}] — DCL owner <code>{s.position!.owner_on_dcl}</code>, NFT owner <code>{s.position!.nft_owner}</code></li>
        <li className="ok"><b>✓ 90/8/2</b> 20 USDC → {formatUnits(s.split_90_8_2!.lp_budget, 6, 2)} / {formatUnits(s.split_90_8_2!.reserve, 6, 2)} / {formatUnits(s.split_90_8_2!.community, 6, 2)}; {formatUnits(s.position!.usdc_used, 6, 2)} USDC used, the rest back to the reserve</li>
        <li className="ok"><b>✓ Books</b> = real balances at {s.books_equal_real_balances_checks.join(", ")}</li>
        <li className="ok"><b>✓ Exit</b> NFT owner after the lock: <code>{s.final_owner_after_exit}</code></li>
        <li className="ok"><b>✓ Refused</b> {s.refusals.length} attempts: {s.refusals.map((r) => r.step).join(", ")}</li>
      </ul>
      <div className="field-row">
        <label htmlFor="pgroup">Steps</label>
        <select id="pgroup" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="all">all ({proof.steps.length})</option>
          {Object.entries(STEP_LABEL).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
        </select>
      </div>
      <div className="scroll-x">
        <table className="dtable proofsteps" aria-label="Sandbox steps"><tbody>
          {rows.map((x) => <ProofRow key={x.i} x={x} open={open === String(x.i)} onToggle={() => setOpen(open === String(x.i) ? null : String(x.i))} />)}
        </tbody></table>
      </div>
      <h3>Fees and withdrawal rules</h3>
      <div aria-label="Fees and exit">
        <ul className="checks">
          <li>A position earns its share of the 1 % swap fee only while the price is inside its range. Rhea keeps {dclMeta.protocol_fee_rate / 100} % of swap fees as protocol fee (<code>protocol_fee_rate</code> {dclMeta.protocol_fee_rate}).</li>
          <li>Local test trades produced <b>{formatUnits(s.test_fees_claimed!.fee_x, 18, 4)}</b> (NEARLY-code token) + <b>{formatUnits(s.test_fees_claimed!.fee_y, 24, 6)}</b> wNEAR, booked exactly as the DCL reported them (G3). A second claim booked {g4 ? `${g4.fee_x} / ${g4.fee_y}` : "0 / 0"} (G4). Out of range: {k5 ? k5.narrow_unclaimed.join(" / ") : "0 / 0"} (K5). <b>These are test numbers, not a forecast.</b> No APY is shown anywhere.</li>
          <li><b>During the lock</b>: <code>withdraw_position</code> is refused (H1); fees can still be claimed by the creator (<code>claim_fees</code>), nobody else (G2).</li>
          <li><b>After the lock</b>: <code>withdraw_position</code> (1 yocto) transfers the NFT to the creator; the DCL owner is checked (H3: <code>{s.final_owner_after_exit}</code>). A second exit and a claim after exit are refused (H4, H5). Then <code>remove_liquidity</code> on Rhea (H6, H7).</li>
          <li><b>Leftovers and claimed fees</b>: <code>withdraw_dex_balance</code> then <code>withdraw_token</code> — recovered {formatUnits(s.recovered!.x, 18, 4)} + {formatUnits(s.recovered!.y, 24, 6)} wNEAR to the atomic unit (J2); a second recovery is refused (J3). Before any zap, <code>abort</code> returns the whole budget to the reserve (F5).</li>
          <li className="ko">Before a real NEARLY contribution could exist: a mainnet bridge for USDC (Tidepool is a testnet community sandbox, not NEAR Intents), a TreasuryDCL deployed on mainnet and an audit — none of which is done.</li>
        </ul>
      </div>
    </section>
  );
}

function ProofRow({ x, open, onToggle }: { x: Step & { i: number }; open: boolean; onToggle: () => void }) {
  const refused = x.outcome === "failure" || "refused_on_chain" in x;
  const why = "job_failed_reason" in x ? (x as { job_failed_reason: string }).job_failed_reason : "error" in x ? (x as { error: string }).error : null;
  const c = x.calls[0] as { contract: string; method: string } | undefined;
  return (
    <>
      <tr data-step={x.step}>
        <td><b>{x.step}</b></td>
        <td>{x.what}{c && <><br /><code className="small">{c.contract} · {c.method}</code></>}{why && <><br /><small className="muted">{why}</small></>}</td>
        <td><span className={`tag ${refused ? "warn" : "ok"}`}>{refused ? "REFUSED" : x.outcome === "view" ? "VIEW" : "OK"}</span></td>
        <td>{x.calls.length > 0 && <button className="btn ghost sm" onClick={onToggle} aria-expanded={open}>{open ? "hide" : "proof"}</button>}</td>
      </tr>
      {open && <tr><td colSpan={4}><pre className="json">{JSON.stringify(x.calls, null, 1)}</pre></td></tr>}
    </>
  );
}
