# V4.0 — Pool discovery, verification and selection (read-only)

Date: 2026-11-13/14. Solo project. Spec: [`docs/SOL2NEAR_V4_Memecoin_Liquidity_Router.md`](../SOL2NEAR_V4_Memecoin_Liquidity_Router.md) §7 "V4.0".

**Nothing in V4.0 signs, deploys or sends a transaction.** All the evidence below comes from public NEAR RPC `view` calls:
- on testnet, and on mainnet for reference pools only;
- reproducible with `node scripts/probes/v4-pool-scan.ts --rank`.

Untouched:
- Rust contracts;
- the 90/8/2 split;
- FUEL rules;
- the G2–G7 flows.

V4.1, V4.2 and V4.3 were not started.

## 1. What was built

| Piece | File | What it does |
|---|---|---|
| Pool Registry (allowlist v1) | `packages/near-client/src/pools.ts` | 6 verified `PoolDescriptor`s (spec §5.3 shape + evidence fields). Tokens are identified by exact NEP-141 ids, never by ticker. Everything is `OBSERVE_ONLY` by default; only the pilot pool is curated `ELIGIBLE` |
| Compatibility checks | same file, `assessPool` | 8 checks per pool from live data: `network`, `readable`, `identity` (ids + `ft_metadata` decimals), `kind`, `liquidity`, `tax`, `usdc_route`, `treasury_pool`. A curated `ELIGIBLE` entry falls back to `OBSERVE_ONLY` as soon as one check fails; `SUSPENDED` stays suspended |
| Selection guard | `selectPool` | Selectable = in the registry **and** assessed `ELIGIBLE` from live data. Unknown keys and stale stored selections are refused |
| Live reader | `apps/web/src/pools/live.ts` | Reads `get_pool`, `get_pool_volumes` and `ft_metadata` for Classic pools, `get_pool` for DCL, and Treasury `get_config` for the target. Mainnet goes through a **separate read-only RPC client**, never given to the wallet code |
| Read-only preflight | `preflight` | For the selected pool: the same LP plan code as *Deploy liquidity* (`previewSwap`, `priceImpactBps`, `impactLevel`), from a fresh `get_pool`, cross-checked with Ref's own `get_return` |
| Dashboard page | `apps/web/src/PoolsPage.tsx`, route `#/pools` ("Pools (V4.0)") | Short catalogue. Each card shows pair, DEX, pool id, Classic/DCL, network, both token contracts and decimals, live fee, reserves, cumulative swap input, tax policy, the 8 checks and the evidence. Only `ELIGIBLE` pools get a *Select* button; the others show "Not selectable." with the first reason. The selection is kept in `localStorage` and re-validated on every read |
| Reproducible scan | `scripts/probes/v4-pool-scan.ts` | Route evidence, candidate ranking (`--rank`), registry checks; `--write-fixture` saves the raw reads used by the tests |

**Reused, unchanged:**
- `lpPlan.ts`: zap, impact, pool order;
- `near/rpc.ts`: provider failover;
- `near/actions.ts`: slippage and impact thresholds;
- the Treasury's own `get_config`, which supplies `ref_exchange`, `pool_id` and `usdc_token`.

The selection has **no effect on any transaction**: the deposit and LP flows still use the Treasury's fixed pool.

## 2. Audit: what the current architecture can and cannot fund

| Fact | Source | Consequence for V4 |
|---|---|---|
| The Treasury's `ref_exchange`, `pool_id` (2951) and `usdc_token` are set in `new` and have **no setter** | `contracts/treasury/src/lib.rs` (`new`; `execute_lp` uses `self.config.pool_id`) | The deployed Treasury can never fund another pool. Another pool = a separate TreasuryV4 account (V4.1), as the spec requires |
| `execute_lp` does **one** swap (USDC → other token) inside the same pool, then `add_liquidity` | `contracts/treasury`, `lpPlan.ts` | A pool must contain the Treasury's USDC, or a multi-hop route needs new contract code |
| FUEL's `config.pool_id` is fixed too (no setter), and a position from another pool is refused | `contracts/fuel/src/lib.rs:554` (`d.pool_id != Some(self.config.pool_id)`) | FUEL recognises pool 2951 positions only. Other pools stay `NOT_ELIGIBLE` for FUEL until a tested adaptation (spec §7 V4.1) |
| `withdraw_lp` exists in the Treasury | `lib.rs:569` | Never exercised on-chain: not called "withdrawable" anywhere |

## 3. What exists on Ref / RHEA (read 2026-11-13 ~22:57 UTC)

| Contract | Pools | Note |
|---|---:|---|
| `ref-finance-101.testnet` (Classic, v1.9.19) | 2963 | 2928 simple, 10 stable, 17 rated, 8 degen. 1643 simple pools have both reserves > 0 |
| `dclv2.ref-dev.testnet` (DCL, v2.3.14) | 11690 | **0** pools with a Tidepool token. **0** meme-cooking pools with liquidity |
| `v2.ref-finance.near` (Classic, v1.9.21) | 9018 | mainnet |
| `dclv2.ref-labs.near` (DCL, v2.4.2) | 6654 | mainnet. Each pool has a `tax` field; only 2 of 6654 are taxed at pool level (none of the Nearly pools below) |

**Key route finding (testnet):**
- `usdc.tidepool-sandbox.testnet` and `wnear.tidepool-sandbox.testnet` appear in **one** Ref Classic pool only, #2951, and in **no** testnet DCL pool.
- Testnet memecoin pools are paired with `wrap.testnet`, which is a different token from Tidepool's wNEAR.

So **no route exists today from the Treasury's USDC to any testnet memecoin pool**.

### Catalogue v1 (live values from the fixture; the dashboard re-reads them)

| Pool | Kind | Network | Tokens (exact ids) | Fee | Reserves | Tax | Status | Main reasons |
|---|---|---|---|---:|---|---|---|---|
| Ref #2951 USDC/wNEAR | Classic | testnet | `usdc.tidepool-sandbox.testnet` / `wnear.tidepool-sandbox.testnet` | 30 bps | 80.6999 USDC / 14.0112 wNEAR | NONE_VERIFIED (observed in G2/G6/G7 transfers, not audited) | **ELIGIBLE** (pilot, **not a memecoin**) | — |
| Ref #2131 MEV/wNEAR | Classic | testnet | `mev-33.factory.v9.meme-cooking.testnet` / `wrap.testnet` | 10 bps | 499,034,474.6 MEV / 3,160.93 wNEAR | UNKNOWN | OBSERVE_ONLY | tax unknown · no USDC route · not the Treasury pool |
| Ref #2190 SHITZU/wNEAR | Classic | testnet | `shitzu-0.factory.v10.meme-cooking.testnet` / `wrap.testnet` | 10 bps | 7,298,572.1 SHITZU / 1,025.94 wNEAR | UNKNOWN | OBSERVE_ONLY | same; a test token, **not** `token.0xshitzu.near` |
| Ref #5462 CHILL/wNEAR | Classic | mainnet | `chill-129.meme-cooking.near` / `wrap.near` | 10 bps | 858,675,932 CHILL / 48,390.3 wNEAR | UNKNOWN | OBSERVE_ONLY | mainnet · tax unknown · no route · not the Treasury pool |
| Ref #4276 wNEAR/BLACKDRAGON | Classic | mainnet | `wrap.near` / `blackdragon.tkn.near` | 30 bps | 5,210.76 wNEAR / 3,315,841,683,068 BLACKDRAGON | UNKNOWN | OBSERVE_ONLY | same |
| DCL `nearly-993927.nearlytrade.near\|wrap.near\|10000` | DCL | mainnet | `nearly-993927.nearlytrade.near` / `wrap.near` | 100 bps (fee tier 10000 = 1 %) | 95,610,611.9 NEARLY / 12,966.88 wNEAR (pool totals) | UNKNOWN (pool `tax` null; token-level tax not readable) | OBSERVE_ONLY | mainnet · DCL = NFT positions (V4.2) · tax unknown |

How the candidates were chosen, all with `--rank`:
- for each family, the pool with the most wNEAR among launchpad-issued tokens: meme.cooking testnet factory, meme.cooking / tkn.near on mainnet, and Nearly (`nearlytrade.near`) on DCL;
- BLACKDRAGON was added as a widely known tkn.near memecoin; it ranks 5th, behind TOUCHED, PURGE and JAMBO.

"Memecoin" is a **curation label** backed by the issuing launchpad account. It is not an on-chain fact.

**Taxes:**
- No meme token here exposes a known tax view.
- They are marked `UNKNOWN`, which blocks selection, rather than guessed.
- Nearly tokens run a NEAR **global contract** (`code_hash` 1111…, `global_contract_hash` 5qScjXG9…). The spec states, citing nearly.trade/docs, that they can tax LP operations; this was **not re-verified** here.

## 4. Decision (spec §7 V4.0)

| Scope | Decision | Why |
|---|---|---|
| Testnet, **real** memecoin pool, Classic | **BLOCKED** with the deployed contracts | no route from Tidepool USDC (only #2951 holds it), Treasury pool fixed, testnet meme token taxes unknown |
| Testnet, **sandbox** memecoin pool, Classic | **GO for V4.1 (needs your approvals)** | a clearly labelled test token + a Classic pool against `usdc.tidepool-sandbox.testnet` (or Tidepool wNEAR) + a separate TreasuryV4 account. The current adapter model (one swap inside the pool, fungible shares) is proven (C2, G6-LP, G6-LP2). It would prove the adapter, **not** mainnet memecoin support |
| Mainnet, Classic memecoin pools (CHILL, BLACKDRAGON) | **OBSERVE_ONLY** | same Classic model as the Treasury, real depth, but SOL2NEAR is testnet-only, Tidepool USDC does not exist on mainnet, and taxes are unverified |
| DCL / Nearly | **BLOCKED (V4.2 study)** | mainnet only, NFT positions with ranges, token-level taxes unknown, no Nearly or meme DCL pool on testnet |

Financial flow today and for V4.1, in the same notation as the spec:

```text
Solana USDC ─Tidepool─▶ NEAR USDC(tp) ─ft_transfer_call─▶ Treasury 90/8/2
   LP budget (90 %) ─execute_lp─▶ Ref Classic #2951 USDC(tp)/wNEAR(tp)   ← only pool reachable today
   V4.1 (proposal):  TreasuryV4 ─▶ Ref Classic #NEW  USDC(tp)/SANDBOX-MEME  (new token + pool + contract, each approved)
   mainnet meme Classic / Nearly DCL: observe only, no arrow
```

## 5. Tests (2026-11-14)

| Suite | Result | Notes |
|---|---|---|
| `packages/near-client` | **18 pass** (+12) | the registry and assessment on the **real reads** of the 6 pools (fixture `src/fixtures/v4_pools_2026-11-13.json`), plus SYNTHETIC variants marked as such. Variants covered: imposter token, decimals changed, metadata unreadable, emptied pool, kind changed, unreadable state, Treasury config unreadable or pointing elsewhere, SUSPENDED, DCL pool tax, unknown pool refused, preflight on the real pilot read |
| `packages/crosschain` | 36 pass | unchanged |
| `apps/web` unit | 48 pass | unchanged |
| e2e, real Chrome (`pnpm --filter @sol2near/web e2e`) | **18 pass** (+4) | `@live`: the catalogue read live, only #2951 selectable (fee equal to `get_pool`), 5 OBSERVE ONLY pools with no button and with reasons. `@live`: selecting #2951 survives a reload; the preflight equals Ref's `get_return`; 0 sign calls. `@live`: mobile 390 px, no horizontal scroll. `@mock`: a stored OBSERVE_ONLY selection is cleared, and with mainnet RPC down the mainnet pools are unreadable but still observe only |
| `pnpm typecheck` / web build | OK | production bundle: 0 `eval(`, no e2e hook |

Manual check in Chrome (dev server):
- the page renders the 6 pools with no console error;
- after selecting #2951, the preflight for a 1.8 USDC LP budget gave a swap of 0.896381 USDC → 0.153464 wNEAR;
- Ref `get_return` returned the same 0.153464 ("✓ equals the plan"), with a price impact of 1.39 %.

Screenshots: `docs/v4/preflight-2951.jpg`, `docs/v4/pool-cards.jpg`.

## 6. Limits

- The catalogue is **short and curated**. It is not an inventory of all NEAR memecoins, and the ranking uses wNEAR reserves only, not USD TVL.
- Reserves and the "swap input since creation" (Ref's cumulative counter) are **not** USD TVL, period volume or yield. No APR is shown.
- Mainnet pools are read from the browser through public mainnet RPC (FastNEAR, drpc), as **view calls only**. No mainnet account, key or transaction is involved, and every mainnet entry fails the `network` check.
- `NONE_VERIFIED` for the Tidepool tokens rests on observed transfers, not on a source audit.
- Route evidence ("only #2951 holds Tidepool USDC") comes from the dated scan, not from a live per-page check. Re-run the scan to refresh it.
- The pool-to-route graph of mainnet was not explored beyond direct wNEAR pairs.

## 7. Next steps (not started; each needs your go)

1. **V4.1 design note**: sandbox meme token and pool vs a proper TreasuryV4. This covers the token contract, the pool against Tidepool USDC, the multi-pool registry on-chain, the exit path (`withdraw_lp`) and FUEL `NOT_ELIGIBLE` until adapted.
2. Then, with **separate approvals for each step**: deploy the sandbox token, create the pool, deploy TreasuryV4 on a new account. Pool 2951, the Treasury and FUEL G2 stay untouched.
3. V4.2: DCL study (`dclv2.ref-dev.testnet` API, NFT custody, ranges, Nearly token taxes) before any code.
4. Keep G6–G8 first: V4.0 has no dependency on them, and they have none on V4.0.
