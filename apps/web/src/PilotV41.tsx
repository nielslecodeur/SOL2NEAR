// V4.1 Classic pilot card (Pools page). READ ONLY and LOCKED: TreasuryV4 and the S2NMEME sandbox token are NOT
// deployed. The card reads their deployment status and the deployed FUEL config live, and shows the exact journey,
// guards and calls a creator would sign once the pilot is deployed and validated. Nothing here can sign.
import { useEffect, useState } from "react";
import { V41_JOURNEY, V41_PILOT, v4Calls, type V4Call } from "../../../packages/near-client/src/index.ts";
import { formatUnits } from "./format.ts";
import type { PilotState } from "./pools/live.ts";

const fmtNear = (y: bigint) => (y === 0n ? "0" : y === 1n ? "1 yocto" : `${formatUnits(y, 24, 5)} NEAR`);
const CALLS: [string, V4Call][] = [
  ["Deposit", v4Calls.deposit(V41_PILOT.minDepositAtomic)],
  ["Swap + LP", v4Calls.executeLp("<deposit id>", null)],
  ["Exit (after lock)", v4Calls.withdrawLp("<deposit id>")],
  ["Recover leftovers", v4Calls.withdrawLeftover("<deposit id>", V41_PILOT.baseTokenId)],
];

export function PilotV41({ read }: { read: () => Promise<PilotState> }) {
  const [s, setS] = useState<PilotState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { read().then(setS, (e) => setErr((e as Error).message)); }, []);
  const dep = s?.deployment;
  const badge = !dep ? "reading…" : dep.state === "NOT_DEPLOYED" ? "NOT DEPLOYED" : dep.state === "DEPLOYED_NOT_READY" ? "DEPLOYED · NOT READY" : "DEPLOYED · awaiting validation";
  const g = V41_PILOT.guards;
  return (
    <section className="card pilot" aria-label="V4.1 Classic pilot">
      <h3>V4.1 Classic memecoin pilot · LOCKED</h3>
      <p>
        <b>{V41_PILOT.baseSymbol} / USDC</b> on Ref Classic, held by a separate <code>TreasuryV4</code>.{" "}
        <span className={`badge ${dep?.state === "READY" ? "pending" : "neutral"}`}>{badge}</span>{" "}
        <span className="badge refunded">SANDBOX TEST TOKEN · NO VALUE</span>
      </p>
      <p className="muted">
        No testnet memecoin pool is reachable from the Treasury's USDC (V4.0), so the pilot uses a test token created for it.
        It proves the Treasury adapter (deposit → swap → LP → custody → exit), <b>not</b> support for a live memecoin.
        Built and tested locally only: the full journey passed in a local NEAR sandbox against the real Ref and Tidepool USDC code (not testnet).
      </p>
      {err && <p className="badge failed">Live read failed: {err}. Nothing is unlocked on a failed read.</p>}
      {dep?.state === "NOT_DEPLOYED" && <p className="muted small">Live check: {dep.missing.map((m) => <code key={m}>{m} </code>)} not on testnet. Deployment needs your approval for each step.</p>}
      {dep?.state === "DEPLOYED_NOT_READY" && <p className="badge failed">{dep.detail}</p>}

      <dl className="kv">
        <div><dt>DEX</dt><dd><code>{V41_PILOT.dex}</code> · Classic simple pool · pool id {V41_PILOT.poolId ?? "assigned at creation"} · fee {V41_PILOT.feeBps} bps (planned; read live once deployed)</dd></div>
        <div><dt>Tokens</dt><dd><code>{V41_PILOT.usdcTokenId}</code> ({V41_PILOT.usdcDecimals} dec.) / <code>{V41_PILOT.baseTokenId}</code> ({V41_PILOT.baseDecimals} dec.), decimals checked on-chain by <code>setup</code></dd></div>
        <div><dt>Token tax</dt><dd>none: plain NEP-141, fixed supply minted once, no mint / burn / admin (contracts/sandbox-meme, tested)</dd></div>
        <div><dt>Split</dt><dd>90 % LP budget / 8 % creator reserve / 2 % community, on the USDC the Treasury actually accepts</dd></div>
        <div><dt>On-chain guards</dt><dd>price impact ≤ {g.maxPriceImpactBps / 100} %, swap ≥ Ref quote − {g.maxSlippageBps / 100} %, add_liquidity within {(2 * g.maxSlippageBps) / 100} %, plan deadline ≤ {Number(g.maxPlanTtlNs / 1_000_000_000n)} s. Checked by the contract against Ref at execution, whatever the frontend sends</dd></div>
        <div><dt>Lock &amp; exit</dt><dd>LP locked {Number(V41_PILOT.lockNs / 1_000_000_000n)} s, then <code>withdraw_lp</code> moves the shares to the creator; leftovers recoverable any time with <code>withdraw_leftover</code></dd></div>
        <div><dt>FUEL</dt><dd>{s ? <><b>{s.fuel.status}</b>{s.fuel.status === "FUEL_NOT_ELIGIBLE" && <>: {s.fuel.reason}</>}</> : "reading the deployed FUEL config…"}</dd></div>
        <div><dt>Fees</dt><dd>Pool fees accrue inside the LP position and depend on real trading volume. <b>Not a yield, not guaranteed</b>; FUEL is not a yield either</dd></div>
        <div><dt>Memecoin risk</dt><dd>The LP holds a volatile token: its value can fall to almost nothing (impermanent loss included). A shallow pool means high price impact</dd></div>
      </dl>

      <ol className="steps" aria-label="Pilot journey">
        {V41_JOURNEY.map((j) => (
          <li key={j.step}><b>{j.step}</b> <span className="badge neutral">LOCKED</span><div>{j.detail}{j.signs && <> · signed by {j.signs}</>}</div></li>
        ))}
      </ol>

      <details>
        <summary>Exact calls a creator would sign (each needs its own approval)</summary>
        <ul className="checks">
          {CALLS.map(([k, c]) => <li key={k}><b>{k}:</b> <code>{c.receiverId}.{c.methodName}</code> · attached {fmtNear(c.deposit)} · {Number(c.gas / 10n ** 12n)} Tgas</li>)}
        </ul>
      </details>
      <button className="ghost locked" disabled title="Locked: TreasuryV4 is not deployed and the pilot pool is not validated">Fund the pilot pool — locked</button>
    </section>
  );
}
