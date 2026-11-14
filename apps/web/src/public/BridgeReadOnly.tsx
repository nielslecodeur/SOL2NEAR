// PUBLIC READ-ONLY BUILD: replaces src/BridgeLive.tsx. No Solana wallet is detected or connected, and no deposit can be
// prepared or sent. Only the public Tidepool health check is read.
import { useEffect, useState } from "react";
import { createTidepoolClient, memoryStore } from "../../../../packages/crosschain/src/index.ts";

export type InjectedWallet = never;
/** Always undefined in the public build: an installed Phantom is never used by this site. */
export const injected = (): undefined => undefined;

const tidepool = createTidepoolClient({ store: memoryStore() });

export function BridgeLive(_: { nearAccount: string; onHealth?: (reachable: boolean) => void }) {
  const [health, setHealth] = useState("checking Tidepool…");
  useEffect(() => {
    tidepool.health().then(
      (h) => setHealth(h.ok && h.solanaRouteOk ? "up · Solana devnet route ok" : `degraded · ok=${h.ok} solanaRoute=${h.solanaRouteOk}`),
      () => setHealth("unreachable from this network"),
    );
  }, []);
  return (
    <div aria-label="Bridge (read-only)">
      <p className="muted">Tidepool (community sandbox, not NEAR Intents): <b>{health}</b></p>
      <p>
        <span className="badge neutral">READ-ONLY DEMO</span> The Solana leg (a Phantom-signed SPL transfer to a live Tidepool quote) is <b>not available</b> on
        this site. It was executed once on devnet: Solana <code>bGUicpgy…887R</code> → NEAR <code>J58H2uyu…RFqf</code> (see Proofs).
      </p>
    </div>
  );
}
