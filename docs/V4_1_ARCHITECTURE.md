# V4.1 — Classic memecoin liquidity pilot: architecture

Date: 2026-11-14. Solo project. Checkpoint **V4.1A**: local implementation and validation.

**Nothing in this document is deployed.**
- `TreasuryV4` and the `S2NMEME` sandbox token exist only as code, local tests and a local sandbox run.
- The deployed contracts are untouched: `treasury.sol2near-dev.testnet`, `fuel.sol2near-dev.testnet` and Ref pool 2951.

Results and evidence: [`V4_1_EXECUTION.md`](V4_1_EXECUTION.md).

## 1. Pool choice: why a sandbox pilot

V4.0 found the facts below (`docs/V4_0_EXECUTION.md`). They were re-read for V4.1:

| Candidate | Blocking facts (on-chain) | Can V4.1 resolve them without inventing liquidity? |
|---|---|---|
| Ref #2131 MEV/wrap.testnet | (1) **No route**: in 2 963 Classic and 11 690 DCL testnet pools, Tidepool USDC and Tidepool wNEAR appear only in pool 2951, and meme pools are paired with `wrap.testnet`, a different token. (2) Token tax unknown. (3) Not the V3 Treasury's pool | **No.** A route would need a *new* USDC(tp)/MEV pool seeded by us. That is a parallel pool next to the real MEV market (spec §5.4 forbids this), and it would be our own liquidity presented as the token's |
| Ref #2190 SHITZU/wrap.testnet | same as #2131 | **No**, same reason |
| Mainnet CHILL, BLACKDRAGON (Classic), NEARLY (DCL) | Mainnet only, while SOL2NEAR is testnet only. Tidepool USDC does not exist on mainnet. NEARLY is DCL (NFT positions) | **No** (rules + V4.2) |

**Decision: the spec's fallback (§5.4).** An isolated testnet sandbox pilot:
- a clearly labelled test token, **S2NMEME** ("SOL2NEAR Sandbox Meme (TEST TOKEN, NO VALUE)");
- one Ref Classic pool **USDC(tp)/S2NMEME**;
- a separate **TreasuryV4**.

This proves the adapter. It does **not** prove compatibility with a live memecoin, and the UI and docs say so.

Pairing the pilot token directly with the Treasury's USDC keeps the acquisition route to **one hop inside the target pool**. It is the same route as the proven V3 zap (C2, G6-LP, G6-LP2), and it creates no second pool or bridge between tokens.

## 2. Components (what changed, what is reused)

```text
Solana USDC ─Tidepool (G7, unchanged)─▶ NEAR USDC(tp) ─ft_transfer_call─▶ TreasuryV4  (NEW account, NOT deployed)
                                                                        │ 90/8/2 (ledger.rs, unchanged copy)
                                                                        │ execute_lp (creator-signed):
                                                                        │   ft_transfer_call → Ref
                                                                        │   get_pool + get_return → on-chain guards
                                                                        │   swap USDC→S2NMEME (same pool)
                                                                        │   add_liquidity → get_pool_shares + get_deposits
                                                                        ▼
                                              Ref Classic USDC(tp)/S2NMEME (pool NOT created)
                                              LP shares held by TreasuryV4 for the creator, locked 600 s
                                              exit: withdraw_lp (mft_transfer) → creator remove_liquidity
FUEL (deployed): reads only treasury.sol2near-dev.testnet / pool 2951 → V4 positions FUEL_NOT_ELIGIBLE
```

| Module | Change |
|---|---|
| `contracts/treasury` (V3, deployed) | **none** |
| `contracts/fuel` (deployed) | **none** |
| `contracts/treasury-v4` | **new crate**, a fork of V3 (same state machine, `in_flight` lock, `#[private]` stage-checked callbacks, `reconcile`), with the additions in §3–§6 |
| `contracts/sandbox-meme` | **new**: a plain NEP-141/145 built on `near-contract-standards` (as FUEL is). The fixed supply is minted once. No mint, burn, admin or tax. It refuses non-testnet and non-sandbox accounts |
| `packages/near-client/src/lpPlan.ts` | reused unchanged: the zap, the Ref formula and the impact calculation |
| `packages/near-client/src/treasuryV4.ts` | **new**: `V41_PILOT` (planned accounts), `planV4`, `checkPlanGuards` (a mirror of the contract guards, for the review only), call builders, `pilotDeployment` (live), `fuelEligibility` (live FUEL config) |
| `packages/near-client/src/pools.ts` (V4.0) | unchanged. The pilot is **not** in the allowlist, because its pool does not exist on-chain |
| `packages/crosschain` | unchanged (path B feeds USDC(tp), the token TreasuryV4 accepts) |
| `apps/web` | Pools page: new **V4.1 pilot card** (`PilotV41.tsx`), read-only and **locked** |
| `sandbox-tests/` | **new**: a near-workspaces run with the real Ref and Tidepool USDC wasm (Linux/WSL) |

## 3. Configuration and on-chain validation

Everything is set once in `new()`. **There is no setter and no owner.**

| Parameter | Validation in the contract |
|---|---|
| Network | `network` ∈ {`testnet`, `sandbox`}. The Treasury's own account, the DEX and both tokens must end with `.testnet` (or `.test.near` in a local sandbox), so a mainnet id is refused at init |
| DEX, pool id, token ids | fixed in `PoolConfig` |
| Pool kind and tokens | `setup` reads `get_pool`: the pool must be `SIMPLE_POOL` and hold exactly `{usdc_token, base_token}` (either order). Otherwise it is not ready, and deposits are refunded |
| Decimals | `setup` reads `ft_metadata` of **both** tokens. They must equal `usdc_decimals` / `base_decimals`. Proven in the sandbox: a Treasury configured with 24 decimals for S2NMEME stayed `ready = false` |
| Accepted token | only `usdc_token` (`ft_on_transfer`, checked against the predecessor), `msg = {"action":"deposit"}`, ≥ `min_deposit`. Anything else is refunded in full |
| Slippage | `max_slippage_bps` ≤ 500 (ceiling hard-coded, guards cannot be switched off) |
| Price impact | `max_price_impact_bps` ≤ 2 000 |
| Execution delay | each plan has `deadline_ns`, at most `max_plan_ttl_ns` (≤ 1 h) after submission. It is re-checked before the swap and before add_liquidity: an expired plan **parks** the funds, it never executes late |
| Creator rights | `execute_lp`, `abort_lp`, `withdraw_leftover`, `withdraw_lp`, `withdraw_reserve` and `withdraw_base` are creator-only. No admin path can move funds or LP |

**Execution guards (on-chain, whatever the frontend sends):**
1. **Before the swap**, the contract reads Ref `get_pool` and `get_return` for the exact `swap_amount_in`, then checks that:
   - the pool is still the configured one;
   - the price impact against spot (fee included) is ≤ `max_price_impact_bps`;
   - `min_swap_out` ≥ Ref quote × (1 − `max_slippage_bps`).

   On failure, the funds stay in Treasury's Ref deposit (`InRef`), with `last_error` set and the event `lp_job_failed`.
2. **Before add_liquidity**, each `min_amounts[i]` must be ≤ the amount provided and ≥ provided × (1 − 2 × `max_slippage_bps`). The factor 2 is there because Ref rounds shares.
3. **After add_liquidity**:
   - the shares come from Ref `get_pool_shares`;
   - the amounts consumed come from the deltas of Ref `get_deposits`, never from the plan.

## 4. Accounting (atomic, deterministic)

- **Split:** `ledger::split` is copied unchanged: LP = ⌊A·9000/10000⌋, reserve = ⌊A·800/10000⌋, community = the rest. It applies to the amount actually credited.
- **Contract-wide buckets:**
  - `pending_budget_total`: LP budgets still in Treasury;
  - `ref_expected_usdc` / `ref_expected_base`: what Treasury must hold on Ref (parked plans and leftovers);
  - `reserve_total` / `community_total`;
  - `base_balance_total`: recovered base token owed to creators;
  - `recorded_shares`.
- **Per deposit, the USDC side always reconciles:** `usdc_swapped + usdc_in_lp + dust_usdc + usdc_returned_to_reserve + usdc_recovered = lp_budget`. The unit tests check it in every terminal path.
- **Real balances, checked in the sandbox run:**
  - Treasury's USDC on the token = reserves + community + pending budgets;
  - Treasury's S2NMEME on the token = base balances;
  - Treasury's Ref deposits = `ref_expected_*`.
- **Not added in V4.1:**
  - no protocol fee;
  - the 2 % community bucket stays in the contract, as in V3, with no distribution method.

## 5. Position (economic owner)

Each `Deposit` records:
- `creator` (economic owner), `dex`, `pool_id`, `base_token`, `id` (deposit id);
- the amounts actually used: `usdc_swapped`, `usdc_in_lp`, `base_in_lp`;
- `lp_shares` (as returned by Ref) and `lp_verified` (Ref `get_pool_shares` ≥ recorded + minted, and consumed amounts read);
- leftovers: `dust_usdc`, `dust_base`, `usdc_recovered`, `base_recovered`, `usdc_returned_to_reserve`;
- the lock: `unlock_at`;
- `status` (the 12-state machine), `last_error`;
- transaction references: `marks[]`, the block height and time of each stage, plus `lp_confirmed_block`.

A contract cannot see transaction hashes, so an indexer or the dashboard history pairs the blocks with hash links.

`get_position` adds:
- `locked`, `lp_withdrawable` and `leftovers_recoverable`;
- `fuel_status = FUEL_NOT_ELIGIBLE`, with its reason.

## 6. Exit and recovery

| Situation | Path | Safety |
|---|---|---|
| LP confirmed, lock running | `withdraw_lp` → `ERR_LP_LOCKED` | lock read on-chain (`unlock_at`), not in the UI |
| LP confirmed, lock over | the creator calls Ref `mft_register(":<pool>")` once. Then `withdraw_lp`: Ref `mft_transfer` of exactly the deposit's shares to the creator, then a fresh Proof of Liquidity. The creator leaves the pool with Ref `remove_liquidity`, then `withdraw` | creator only. Status `LpConfirmed → LpWithdrawPending → LpWithdrawn`. A failed transfer rolls back to `LpConfirmed`. A second withdrawal is refused (`ERR_NO_CONFIRMED_LP`). A replayed callback is ignored |
| Job failed (guard, swap, add) | funds parked `InRef` or `Swapped`. The creator either resumes (`execute_lp` with a fresh plan) or `abort_lp` | no double spend: a resume never re-sends the budget to Ref |
| Abort | `BudgetAllocated` → the budget goes to the creator's USDC reserve. `InRef` / `Swapped` → leftovers of this deposit | status `Aborted`. Allowed only before the LP exists |
| Leftovers (dust after LP, or aborted funds) | `withdraw_leftover(deposit, token)`: Ref `withdraw` to Treasury, then Ref `get_deposits`. Credited to the creator's reserve (USDC) or base balance (S2NMEME) **only if Ref's balance really dropped**. Then `withdraw_reserve` / `withdraw_base` (ft_transfer, re-credit on failure) | judged from Ref state, because Ref re-credits a failed withdraw. One job at a time. No double withdraw (`ERR_NOTHING_TO_WITHDRAW`) |
| Lost callback (gas, crash) | `reconcile` after 10 min: an LP job's stage is re-derived from Ref `get_pool_shares` and `get_deposits` (pre-swap check → back to `InRef`); a leftover job is settled from Ref `get_deposits` (V4.1B fix) | stale or replayed reconcile is ignored |

**V3 vs V4:** V3 cannot recover leftovers and has no abort. Its `withdraw_lp` exists in code but **has never been exercised on-chain**. V4.1 adds the recovery path and exercises the whole exit against the real Ref code in the sandbox.

## 7. FUEL

The deployed FUEL `get_reactor().config` was read on 2026-11-14: `treasury_id = treasury.sol2near-dev.testnet`, `pool_id = 2951`, `min_lock_ns = 600 s`.
- `register_position` reads the deposit from that `treasury_id`, and `admit` refuses another pool (`contracts/fuel/src/lib.rs:554`).
- There is no setter.

So **TreasuryV4 positions cannot be registered: `FUEL_NOT_ELIGIBLE`.** The contract, the client (`fuelEligibility`, read live) and the UI all show this. No reward is invented.

A future FUEL version (separate approval; supply and distribution unchanged) would need:
- a set of accepted Treasury/pool pairs, or one FUEL instance per Treasury;
- reading V4 `Deposit`. V4 kept FUEL's field names on the USDC side (`usdc_in_lp`, `usdc_swapped`, `dust_usdc`, `lp_verified`, `pool_id`, `lp_confirmed_at`, `unlock_at`);
- extending its USDC reconciliation identity with `usdc_returned_to_reserve + usdc_recovered`;
- the proof of shares at `(dex, pool_id)` of that Treasury.

The V4 lock (600 s) already equals FUEL's `min_lock_ns`.

## 8. UI (Pools page)

The V4.0 catalogue is unchanged. A **"V4.1 Classic memecoin pilot · LOCKED"** card shows:
- the live deployment status of the planned accounts (today `NOT DEPLOYED`);
- the pool identity (planned), the fee, token tax (none, by construction), the 90/8/2 split, the on-chain guards, lock and exit;
- FUEL status from the deployed FUEL config;
- a "not a yield, not guaranteed" fee statement and the memecoin risk;
- the 7-step journey (Pool selected → Quote → Review → Deposit → Swap → LP → Position), every step `LOCKED`;
- the exact calls a creator would sign.

The fund button is disabled. A failed read unlocks nothing. Even once deployed, the card stays locked until the pool passes the V4.0 live checks and is added to the allowlist (V4.1B).

## 9. Remaining design limits (see the execution report for risks)

- One pool per TreasuryV4, by design (spec §5.2: no free choice of DEX or pool at execution).
- The route is a single hop inside the pool. A real memecoin paired with `wrap.testnet` would need a 2-hop route (USDC → wNEAR → MEME) and a wNEAR leg, which V4.1 does not implement.
- Tidepool USDC (the quote token) has minters (`add_minter` / `mint` in its wasm). It is a test token, not an audited stablecoin.
- The contract assumes tokens without a transfer tax. Through a single-hop zap the base token never moves by `ft_transfer` on entry, only at leftover withdrawal. A taxed token would still need its own V4.2 study.
