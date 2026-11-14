# G9.1 — Public read-only demo: readiness

Status: **READY FOR PUBLIC DEMO DEPLOYMENT APPROVAL** (with the limitations listed below).
The demo has been **prepared and tested locally only**. **It is not deployed**: no public URL exists yet.

## 1. Published vs local-only

| Item | State |
|---|---|
| G9 commits `62dfc04`, `9033645`, `9b96f76` | **published** on `origin/main` (head `9b96f76f8c59d9c9a0ef288c06f5078c7b1dec7c`, checked on the remote) |
| G9.1 read-only build, Proofs page, bundle check, e2e tests, Pages workflow, this doc | **local commit only, not pushed** |
| GitHub Pages site | **not enabled, not deployed** |
| FullAccess keys on `treasury.sol2near-dev.testnet` and `fuel.sol2near-dev.testnet` | **kept** (lead's decision), disclosed in README, portal and G9 docs |
| G8 (`execute_lp(3)`) | **not executed** (refused by the lead), still `G8 READY FOR USER SIGNATURE` |

## 2. Hosting chosen: GitHub Pages via GitHub Actions

- Why: same repository as the code (no new account or cloud project), static files only, HTTPS, deploys only what the workflow built
  from a given commit, and it can be unpublished in one click.
- Workflow: `.github/workflows/pages-readonly-demo.yml`, trigger **`workflow_dispatch` only**. Pushing the file deploys nothing.
  Steps: `pnpm install --frozen-lockfile` → `pnpm --filter @sol2near/web build:public` → `node scripts/check-public-bundle.mjs`
  (the job **fails** and deploys nothing if signing code is found) → `actions/upload-pages-artifact@v3` (`apps/web/dist-public`)
  → `actions/deploy-pages@v4`.
- Permissions: `contents: read`, `pages: write`, `id-token: write` (the minimum for `deploy-pages`). No secret is used.
- Expected URL, **by GitHub convention only, not live**: `https://nielslecodeur.github.io/SOL2NEAR/`. The app uses `base: "./"`
  and hash routing (`#/`, `#/proofs`, …), so it works under that sub-path and survives reloads without a 404 fallback.

## 3. What makes it read-only (not just disabled buttons)

`vite build --mode public` replaces the signing modules **at module resolution**, so their code is not in the bundle:

| Real module | Replaced by | Effect |
|---|---|---|
| `src/NearPanel.tsx` | `src/public/NearPanelReadOnly.tsx` | no NEAR Wallet Selector, no `@near-js/transactions` |
| `src/BridgeLive.tsx` | `src/public/BridgeReadOnly.tsx` | no Phantom detection, no Tidepool deposit; Tidepool health read only |
| `src/near/wallet.ts`, `packages/crosschain/src/wallet.ts` | `src/public/noSigning.ts` | any signing call throws |
| `packages/crosschain/src/solana.ts` | `src/public/noSolanaTx.ts` | no Solana transaction can be built |

Defence in depth:
- **CSP meta** injected in `index.html`: `script-src 'self'`, `connect-src` limited to `near-testnet.drpc.org`, `test.rpc.fastnear.com`,
  `free.rpc.fastnear.com`, `near.drpc.org` (mainnet **view calls** for Explore mode), `api.devnet.solana.com`, `www.usetidepool.tech`;
  `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`.
- Permanent banner on every route: "PUBLIC READ-ONLY DEMO — this site contains no wallet and no signing code: it cannot send any transaction".
- `scripts/check-public-bundle.mjs` (`pnpm check:public`) scans the built JS for: Wallet Selector, NEAR tx builder
  (`actionCreators`, `functionCallAccessKey`, `signAndSendTransactions`), `.signAndSendTransaction(`, Phantom lookup, SPL builder
  (`createTransferCheckedInstruction`, `TransferChecked`), the e2e hook, `eval`; plus banner and CSP presence.
  Result on `dist-public`: all PASS, 1 JS file, 348 KB. **Control**: on the normal `apps/web/dist` it fails, as expected.
- CORS checked from Origin `https://nielslecodeur.github.io`: all 6 endpoints allow it (preflight `OPTIONS`).

## 4. Visible vs unavailable

| Visible (read live or static) | Unavailable in the public demo |
|---|---|
| Creator Portal (`#/`): journey, Live and Explore modes, pool cards, plans with price impact, the 20 % block | connecting a NEAR or Solana wallet |
| Dashboard, Pools, Positions, Reactor: state of the deployed testnet contracts (view calls) | bridge deposit, `fund`, `execute_lp`, FUEL register / claim, any signature |
| Explore mode: real mainnet memecoin pools (Rhea DCL, Nearly) via **view calls only** | anything on mainnet besides view calls |
| **Proofs** page (`#/proofs`, new): 16 executed transactions (B1, B4, C1–C7, G6-D, G6-LP, G6-LP2, G6-CLAIM, G7-SOL, G7-NEAR, G7-TREAS) with NearBlocks / Solana Explorer links, feature evidence table, doc links, limits ("G8 is not completed") | — |

The two portal sentences that described real transactions now read, in the public build only:
"State is read live; signing is not available in this public demo …" and "Bridge · Solana devnet → NEAR testnet (read-only here)".

## 5. Tests (local, 2026-11-14)

| Check | Result |
|---|---|
| `pnpm typecheck` | OK |
| `pnpm --filter @sol2near/web test` | 48/48 |
| `pnpm --filter @sol2near/web e2e:offline` | **16/16** (includes the 4 `@offline @public` tests below) |
| `pnpm --filter @sol2near/web e2e:live` (before the last wording change) | 31 tests: 30 passed + 1 known flaky (FastNEAR 429 without CORS header) |
| `pnpm check:public` | PASS |
| `pnpm check:release` | all release checks passed |

The `@public` tests run on `vite preview --outDir dist-public`, exactly as a static host serves it, with **every external request
aborted** and a spy Phantom provider injected (it must be called 0 times):
1. every route (`""`, `#/`, `#/dashboard`, `#/pools`, `#/positions`, `#/proofs`, `#/reactor`) loads directly and after a reload,
   banner present, no signing button, no page error;
2. portal: wallets explained as unavailable, NEAR panel is the read-only notice, bridge card cannot deposit, no enabled
   fund/execute/sign/deposit/bridge/deploy/claim/withdraw/connect button;
3. Proofs page: 16 rows, explorer links, CSP meta;
4. 390 px: no horizontal scroll on `#/`, `#/proofs`, `#/pools`, `#/positions` (a pre-existing overflow of long RPC error badges was fixed in `styles.css`).

Screenshots: `docs/v4/g91-public-portal.jpg`, `docs/v4/g91-public-proofs.jpg`.

## 6. FullAccess keys (kept, disclosed)

`view_access_key_list` shows a full-access key on `treasury.sol2near-dev.testnet` and `fuel.sol2near-dev.testnet`.
The contracts have no admin method or setter, but the key holder (the developer) could redeploy different code.
Decision of the lead: **keep them for now and keep their existence documented** (README intro and risks, portal hero text,
G9 audit, this doc). The public demo holds no key and cannot use them.

Removing them later (not authorized, not planned now):
- **For**: locks the deployed code at the account level; the "rules fixed at deployment" claim becomes fully true.
- **Risks**: irreversible; no bug fix or redeploy possible on those accounts afterwards; a mistake (wrong key, wrong account) cannot be undone.
- **Preconditions**: a decision that no further fix is needed on testnet; confirm the code hashes again (`node scripts/probes/g8-audit.mjs`);
  one `DeleteKey` transaction per account, each approved separately; update README / portal / docs in the same change.

## 7. Remaining risks of the public demo

- Public RPCs have no SLA: FastNEAR rate limits (429, no CORS header) can leave some cards "unreadable". The app shows that
  state as OBSERVE ONLY, never as executable.
- Tidepool is a **community sandbox**, not official NEAR Intents; its health check may fail.
- The page states and links facts already public on-chain; it reveals no new data. No analytics, no cookies, no third-party script
  (Google Fonts CSS and font files only).
- GitHub Pages serves no custom HTTP headers: the CSP is a `<meta>` (no `frame-ancestors`, so the page can be framed; with no
  signing on the page, clickjacking cannot trigger a transaction).
- Visitors could still mistake test tokens for value: banner and "testnet / devnet only" wording on every route.

## 8. Deployment procedure (needs the lead's approval for each step)

1. **Push** the local G9.1 commit(s) to `origin/main` (`git push origin main`, no force).
2. GitHub → repository **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.
3. GitHub → **Actions → "Deploy read-only demo (GitHub Pages)" → Run workflow** (branch `main`).
   CLI equivalent: `gh workflow run pages-readonly-demo.yml --ref main`, then `gh run watch`.
4. Verify on the deployed URL (the one printed by the `deploy` job, not assumed): banner on every route, Proofs page,
   no wallet button, browser devtools network tab shows only the CSP-listed hosts.

## 9. Rollback

- Fastest: **Settings → Pages → Unpublish site** (or switch Source off / disable Pages).
- Revert content: run the workflow on an earlier commit (`gh workflow run pages-readonly-demo.yml --ref <commit-or-branch>`),
  or revert the commit on `main` and rerun.
- Nothing on-chain depends on the site: unpublishing has no effect on contracts or funds.

## 10. Exact local commands (reproduce)

```powershell
pnpm install --frozen-lockfile
pnpm --filter @sol2near/web build:public      # → apps/web/dist-public
pnpm check:public                             # proves no signing code in the bundle
pnpm --filter @sol2near/web e2e:offline       # 16 tests incl. 4 @public
pnpm --filter @sol2near/web exec vite preview --outDir dist-public   # look at it locally
```
