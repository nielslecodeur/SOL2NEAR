// PUBLIC READ-ONLY BUILD (`vite build --mode public`): replaces src/NearPanel.tsx. It has no wallet, no session and no
// transaction builder; the NEAR Wallet Selector and @near-js/transactions are therefore not in the public bundle.
export function NearPanel(_: { onAccount: (id: string | null) => void; onChanged: () => void; tidepoolReachable: boolean | null }) {
  return (
    <section className="card nearpanel-readonly" aria-label="NEAR wallet (not available in the public demo)">
      <h3>Your NEAR testnet account</h3>
      <p>
        <span className="badge neutral">READ-ONLY DEMO</span> Wallet connection and signing are <b>not included</b> in this public build: nothing here can
        deposit, execute liquidity or claim FUEL. The real flow (each step a reviewed approval in your own NEAR testnet wallet) runs from a local
        checkout: see the README, step 7.
      </p>
    </section>
  );
}
