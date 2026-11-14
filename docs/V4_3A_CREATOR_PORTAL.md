# V4.3A — Creator Portal: journey, frictions, rules

Date: 2026-11-14. Solo project. Execution report: [`V4_3A_EXECUTION.md`](V4_3A_EXECUTION.md). Release audit: [`RELEASE_READINESS.md`](RELEASE_READINESS.md).

The Creator Portal is the landing page of the dashboard (`#/`). It turns the modules built in G2–V4.2A into one guided journey:

**Connect → Choose pool → Amount & simulation → Review & sign → Track position**

It reuses the real components and adds **no signing code**:
- the NEAR panel: wallet, deposit with review, `execute_lp`, FUEL;
- the Phantom bridge card (Tidepool);
- the V4.0 pool readers;
- the V4.2A DCL explorer.

## 1. Phase A — journey audit (a Solana creator who does not know NEAR)

What the creator has to do today on the **only executable path**: Solana devnet → Tidepool → NEAR testnet → Treasury → Ref pool 2951.

| # | Step | Needs | Friction class | What V4.3A does |
|---|---|---|---|---|
| 1 | Understand what the product does, what is real, what is not | reading scattered docs | **removable by the interface** | landing hero + *What is real today* table: each feature tagged with its evidence kind (testnet tx / bridge / live read / sandbox / not available) and its tx hashes |
| 2 | Phantom on **Solana devnet** | Phantom + Testnet mode (Phantom does not expose its network to a page) | **unavoidable** (wallet setting) | stated in step 1; a transfer built for devnet cannot land on mainnet (devnet blockhash) |
| 3 | Devnet USDC (Tidepool mint `7paf…r4Xr`) | a faucet / the Tidepool mint | **unavoidable** in a testnet demo | step 1 reads the address's real devnet USDC balance and says when it is 0 |
| 4 | A **second wallet** (NEAR testnet: MyNearWallet or Meteor) + a NEAR account + testnet NEAR for gas | account creation, faucet | **needs a new architecture** to remove (sponsored / delegated NEAR transactions or a vault receiving the bridge output directly, with an authorisation model) | explained in step 1 ("two chains, two keys"); the real NEAR panel is shown in steps 1 and 4 |
| 5 | USDC storage registration on NEAR (0.00125 NEAR) | one more approval | **removable by orchestration** without a security change (it could be batched with the deposit in one wallet request); not done, see §6 | step 1 reads `storage_balance_of` and shows whether it is missing; the simulator lists it |
| 6 | Bridge: quote, then SPL transfer in Phantom | 1 signature | **unavoidable** (the user moves their own funds) | the simulator shows quote, cost, guaranteed minimum, staleness (> 60 s blocks), Treasury minimum (the G7 lesson: 1 USDC arrives as 0.9974 < 1) |
| 7 | Wait for settlement, check arrival on NEAR | Tidepool polling | **removable by the interface** (already done in the bridge card) | bridge card embedded in step 4; it resumes after a reload |
| 8 | Deposit into the Treasury (`ft_transfer_call`) | 1 NEAR signature | **unavoidable** in the current custody model | step 4 lists it; the NEAR panel prepares it with an exact review |
| 9 | `execute_lp` | 1 NEAR signature | **removable by orchestration only with a contract change** (the Treasury would have to start the LP on deposit; V3 is deployed and frozen) | listed in step 4 |
| 10 | FUEL register / claim | 1–2 NEAR signatures, during an open season | **unavoidable** in the deployed FUEL design | listed as optional |
| 11 | CLI | was the fallback for the deposit after a bridge | **removed by the interface** | the NEAR panel deposits the bridged amount; the CLI line remains as a documented fallback only |
| 12 | Know what Classic / DCL, LP shares, ranges mean | DeFi knowledge | **removable by the interface** | plain-language texts per step; Classic and DCL are never mixed (§3) |
| 13 | Get money back | the V3 Treasury has never exercised `withdraw_lp` | **unavoidable in the current system** (no tested exit on the deployed contract) | "Exit: not offered" on every V3 position, with the reason |
| 14 | Fund a **memecoin** | no testnet memecoin pool reachable from Tidepool USDC; Nearly pools on mainnet | **needs a dependency** (a public deployment decision) | Explore mode: read-only, with the reason on every button |

**Not invented:** a Phantom-only journey. Phantom cannot sign NEAR transactions. A one-signature flow would need a new custody or delegation design and its own security review (see the V4 spec §6.2).

## 2. The two modes (strictly separate)

| | **Live · NEAR testnet** | **Explore · NEAR memecoins (read-only)** |
|---|---|---|
| Data | testnet views + the deployed V3 Treasury / FUEL; dry Tidepool quotes | mainnet DCL views (`get_pool`, `quote`, `predict_hotzap`), V4.2A sandbox views |
| Pools offered | only pools that are on the allowlist, assessed `ELIGIBLE` from live data and on testnet → today **#2951 USDC/wNEAR, labelled "not a memecoin"** | NEARLY, NEARKAT, DRAGON (DCL, mainnet) |
| Actions | real, each in the user's wallet after a review (NEAR panel, bridge card) | **none**: disabled buttons named "Fund — execution not available yet" / "Execute on DCL — not available yet". The NEAR panel is hidden |
| Banner | "Deployed contracts on NEAR testnet only…" | striped `EXPLORE MODE … Nothing in this mode can be signed or executed` |

The choice of mode and step is kept per viewer (`localStorage`, with try/catch). The chain stays authoritative: every value is re-read.

### Visual vocabulary (one label per kind of fact)

| Kind | Label shown |
|---|---|
| executed on testnet | `Executed on NEAR testnet` / position `CONFIRMED ON NEAR TESTNET` |
| bridge | `Bridged once: Solana devnet → NEAR testnet` |
| live read, no tx | `Live read (no transaction)` / `MAINNET · read-only` |
| sandbox | `Local sandbox only (real code, local state)` / `LOCAL SANDBOX PREVIEW · NOT A TESTNET POSITION` + striped banner |
| simulation | `SIMULATION` badge; every simulator row tagged `quote` / `live view` / `contract rule` / `measured` / `user input` / `unavailable` |
| not available | `Not available` / `NOT DEPLOYED` |
| mainnet transaction | **never shown**: no mainnet transaction exists or can be prepared |

## 3. Pool selection conditions

A pool can be **selected for a transaction** only if all of these hold:
1. it is in the registry (exact contract ids, never a ticker);
2. every V4.0 live check passes (network, readable, identity, decimals, kind, liquidity, tax, USDC route, Treasury pool);
3. it is on **NEAR testnet**;
4. the deployed Treasury can fund it.

`poolOffers` implements this, and the unit tests force a mainnet row to `ELIGIBLE` to prove it stays unselectable. A failed read selects nothing.

**Classic vs DCL, never mixed:**
- Classic pool 2951 uses the Classic LP plan (`lpPlan.ts`, Ref `get_return`) and fungible shares.
- DCL pools use the DCL estimator (`buildDclPlan`, `predict_hotzap`) and a position with a range.
- The two proof models stay distinct in the unified position shape (`LP_SHARES` vs `DCL_POSITION`).

## 4. Contribution simulator (Live mode, pool 2951)

The 14 rows of the checkpoint come from `simulateLiveContribution` (pure, unit-tested):

| # | Row | Source |
|---|---|---|
| 1 | source amount | user input |
| 2 | bridge quote, cost, time; **STALE after 60 s** | Tidepool dry quote (`/v0/quote`, no deposit address) |
| 3 | received on NEAR = **guaranteed minimum** | quote |
| 4–5 | 90/8/2 split and LP budget, applied to the guaranteed minimum | contract rule (same arithmetic as `ledger::split`) |
| 6–9 | route, tokens, DEX fee, slippage guard and price impact | live `get_pool` + Ref `get_return` (same code as *Deploy liquidity*) |
| 10 | token taxes | measured on G2–G7 transfers (not a source audit) |
| 11 | LP position | contract rule; shares are read after the LP, never estimated |
| 12 | gas and storage | storage read live; `execute_lp` 37 Tgas measured on G6-LP2 |
| 13 | unused capital | rules + measured dust |
| 14 | pool risks | live view |

Rules:
- Without a quote, rows 3 and 6–9 and 13 are `unavailable` and **no split is shown**: nothing is guessed.
- Blocking conditions are listed: no quote; stale quote; guaranteed minimum below the Treasury minimum; price impact ≥ 20 %.

**DCL (Explore mode):** the V4.2A estimator (mainnet reference simulation). It shows:
- the range, as points and prices;
- the share of the budget per leg;
- the swap outputs and what goes into the position, from `predict_hotzap`;
- the leftovers, the slippage guards and the tax status.

It also explains what happens out of range: the position becomes a single asset and earns no fee. And it states the exposure and the exit conditions.

## 5. Position states (unified shape, distinct proofs)

`UnifiedPosition` fields:
- creator, pool, contracts;
- net arrived, deployed, residual;
- **proof** (`LP_SHARES {shares, verified}` | `DCL_POSITION {lptId, range, liquidity, NEP-171}`);
- **on-chain holder** + how it was checked;
- **economic owner**;
- lock, exit conditions;
- fees observed / claimable;
- FUEL, execution state, history.

| Source | Evidence | Exit | Fees | FUEL |
|---|---|---|---|---|
| V3 Treasury (deployed), read live | `CONFIRMED ON NEAR TESTNET` when `LpConfirmed` + `lp_verified`, else `NEAR TESTNET · NOT CONFIRMED AS LP` | **Not offered** (`withdraw_lp` never exercised on-chain) | Classic: inside the share value, no separate claim | from the deployed FUEL (`Claimed`, …) or "not registered" |
| V4.1 TreasuryV4 | not deployed → its V4.1B cards show `NOT_DEPLOYED` live, or a bannered sandbox preview | `withdraw_lp` (mft_transfer) after the lock | inside the shares | `FUEL_NOT_ELIGIBLE` |
| V4.2A TreasuryDCL | `LOCAL SANDBOX PREVIEW` | four **separate** operations (below) | exact claims from DCL return values; `OUT OF RANGE: earning nothing` when applicable | `FUEL_NOT_ELIGIBLE` |

The four DCL operations:
1. `withdraw_position` transfers **ownership** of the position (it does not remove liquidity);
2. removing liquidity is a separate DCL call **by the creator**;
3. claiming fees is `claim_fees`;
4. leftovers and claimed fees are recovered with `withdraw_dex_balance` + `withdraw_token`.

**DCL ownership model, verified on the deployed v2.4.2 bytes:**
- the position exposes `nft_token`, `nft_transfer` (exactly 1 yocto) and approvals;
- after a transfer, the old owner gets `E215: not liquidity owner`;
- `get_liquidity.owner_id` is the authority TreasuryDCL checks.

It is a DCL position **with** a NEP-171 interface. It was not assumed from its id.

## 6. Unresolved frictions (and why)

| Friction | Why it stays |
|---|---|
| Two wallets, five to six signatures | two chains and the deployed V3 contract. Fewer signatures need either a new contract (LP on deposit) or a delegated / sponsored NEAR transaction design, which needs its own security analysis. Not built |
| USDC storage registration as a separate approval | batching it with the deposit is possible in the NEAR panel; not done in V4.3A, to avoid touching the signed-transaction code validated in G6 on deadline day |
| No exit from the deployed V3 Treasury | untested on-chain; offering it would be a claim without proof |
| No memecoin execution | dependency: a public deployment decision (V4.2A §8 options a/b/c) |
| Phantom network not readable by the page | wallet limitation; explained |

## 7. Risks shown to the creator

- The value of pooled assets moves; a memecoin can lose most of its value; test tokens have no value.
- Fees are variable and can be zero. A concentrated position earns nothing out of range. **No yield is promised. No APR is computed.**
- Tidepool is a community sandbox without SLA; the bridged amount can differ from the quote, within its guaranteed minimum.
- The contracts are unaudited. Ref and Rhea are upgradeable by their DAOs.
- The V3 position has no tested exit.
