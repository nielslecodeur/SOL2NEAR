# Try Testnet — real wallet connection, signing locked

A build of the site with every signature locked. It was deployed on https://sol2near-demo.vercel.app for part of H8; since
the lead's later decision the site serves the **testnet live** build (same wallets, signing in the user's own wallet).

| Build | Command | Wallet | Can sign |
|---|---|---|---|
| Read-only demo | `pnpm --filter @sol2near/web build:public` | none (no wallet code in the bundle) | no |
| Try Testnet (this page) | `pnpm --filter @sol2near/web build:testnet` | **real NEAR Wallet Selector**: MyNearWallet, Meteor (testnet); Phantom connect (devnet balance) | **no** — locked twice |
| **Testnet live (deployed)** | `pnpm --filter @sol2near/web build:live` + `pnpm check:live` | same wallets | yes: each transaction reviewed on the page, then approved in the user's own wallet; testnet / devnet only |
| Full app (local dev) | `pnpm --filter @sol2near/web dev` | same wallets | same as testnet live, without the CSP meta |

## Run it

```bash
pnpm --filter @sol2near/web build:testnet
pnpm check:testnet                          # → "real wallet connection, every signature locked"
pnpm --filter @sol2near/web preview:testnet # http://localhost:4185/#/console  (menu: Try Testnet)
```
Click **Connect NEAR wallet**, choose MyNearWallet or Meteor, sign in with a **testnet** account. Sign-in asks for no contract
access key, so it creates nothing on-chain.

## What works

- Connect, disconnect, account switch (through the wallet), refusal (closing the wallet window connects nothing).
- Only testnet accounts are exposed to the app; a mainnet account is ignored.
- Real NEAR testnet reads for the connected account: NEAR balance, test USDC balance, storage registrations, Treasury deposits
  and their pipeline (deposit → LP → FUEL), V3 positions, the FUEL Reactor.
- The **review** of a deposit (or any other action) shows the exact call the wallet would sign.

## What is locked

- NEAR: the review has no send button ("Signing locked in this build"), and `src/near/wallet.ts` refuses before the wallet is
  asked (`SIGNING_LOCKED`). The minifier removes the code after the lock: `check:testnet` verifies it is absent.
- Solana: the signer module is replaced by the refusing stub, as in the public build; the Bridge button is locked.

## Tests

`apps/web/e2e/testnet.spec.ts` (live, real Chrome): the real modal lists MyNearWallet and Meteor; MyNearWallet opens its real
`testnet.mynearwallet.com/login` page without a contract id; closing it connects nothing; a restored MyNearWallet session
(`signedAccountId`, exactly what the wallet stores) shows the real balances and the 3 Treasury deposits of
`lowarena9362.testnet`; the deposit review of `sol2near-dev.testnet` shows `ft_transfer_call` and is locked, no wallet window
opens; Disconnect returns to Connect; a mainnet account stays disconnected.

A complete sign-in in a real wallet needs the account owner: it is the one step the automated tests cannot do.
