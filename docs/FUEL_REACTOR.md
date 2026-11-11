# FUEL Reactor — a memecoin driven by verified liquidity

**In 30 seconds:** FUEL is a fixed-supply NEP-141 token. It can only be earned by locking real
liquidity in a Ref/Rhea pool through the SOL2NEAR Treasury. The community plays *seasons*: if the
season's verified new liquidity reaches the target, the Reactor levels up and rewards unlock. If it
misses, rewards go back to the reserve, the Reactor levels down, and a small prefunded slice of
FUEL is burned for good. The price chart plays no part: every rule reads on-chain LP state.

Contract: `contracts/fuel` (near-sdk 5.30.1 + near-contract-standards). Status: **implemented and
unit-tested (31 tests), wasm built with cargo-near, NOT deployed** (see `docs/CHECKPOINT_A2.md`).

## 1. Supply: minted once, no mint method

| Allocation | FUEL | Held by | Can move how |
|---|---:|---|---|
| Proof-of-Liquidity reserve | 600 000 | FUEL contract | only through admitted positions → claims (creators) / community reserve |
| Ecosystem | 199 000 | `ecosystem_id` | normal NEP-141 transfers by its owner |
| Reactor burn reserve (from the ecosystem 200 000) | 1 000 | FUEL contract | only `close_season` of a FAILED, activated season, ≤ `season_burn` (≤ 10) each |
| Liquidity provisioning | 150 000 | `liquidity_id` | normal transfers |
| Team | 50 000 | FUEL contract | `release_team()`: nothing before `genesis + cliff`, then linear until `genesis + vesting`, to `team_id` only |
| **Total** | **1 000 000** | | `ft_mint` events at init; the ABI has no mint function |

Every FUEL held by the contract belongs to exactly one bucket (`get_buckets`):
`contract_balance = pol_available + pol_committed + community_reserve + burn_reserve + team_locked`,
and `total_supply + burned_total = 1 000 000`. Unit tests assert both after every scenario.

`storage_unregister` ignores `force`, so unregistering can never burn a holder's balance.

## 2. Proof of Liquidity: how a position becomes admissible

`register_position(position_id)` can be called by anyone. In one async round-trip it reads:

1. `Treasury.get_deposit(id)`: the position as recorded by the Treasury;
2. `Treasury.get_accounting().recorded_shares`: every LP share the Treasury holds for creators;
3. `Ref.get_pool_shares(pool_id, Treasury)`: the shares **Ref itself** says the Treasury holds.

The callback (`on_position_proof`) admits the position only if every check below passes. When a
check fails, nothing is written and a `position_rejected` event gives the reason.

| Check | Error if not |
|---|---|
| Deposit exists, id matches | `ERR_UNKNOWN_POSITION`, `ERR_ID_MISMATCH` |
| Not already registered (no reuse, no second season) | `ERR_ALREADY_REGISTERED` |
| Status exactly `LpConfirmed`: deposit received, 90/8/2 done, swap OK, add_liquidity OK, LP still held (not pending, failed, parked or withdrawn) | `ERR_LP_NOT_CONFIRMED` |
| `lp_verified`: Treasury's post-mint on-chain check passed | `ERR_LP_UNVERIFIED` |
| Pool = FUEL's configured pool | `ERR_WRONG_POOL` |
| Shares > 0 and USDC in LP > 0 | `ERR_EMPTY_POSITION` |
| **Ref shares(Treasury) ≥ Treasury recorded shares and ≥ the position's shares** | `ERR_SHARES_NOT_BACKED_ON_REF` |
| Proof fields present (confirmed_at, block, unlock_at) | `ERR_MISSING_PROOF_FIELDS` |
| Lock `unlock_at − confirmed_at ≥ min_lock` | `ERR_LOCK_TOO_SHORT` |
| Treasury books reconcile: `lp_budget/reserve/community` = exact 90/8/2 of `amount` | `ERR_SPLIT_MISMATCH` |
| Every LP-budget USDC is accounted for: `usdc_swapped + usdc_in_lp + dust_usdc == lp_budget` | `ERR_USDC_RECONCILIATION` |
| Confirmed after genesis | `ERR_BEFORE_GENESIS` |
| `register_position` was **called** before `end + registration_grace` of the confirmation season | `ERR_REGISTRATION_WINDOW_CLOSED` |
| That season is still open (only hit if a callback lands > 60 s late) | `ERR_SEASON_CLOSED` |
| Called back by FUEL itself (`#[private]` + explicit check) | `ERR_PRIVATE_CALLBACK` |

The data comes only from the contracts' own view results. A caller cannot provide an amount, a USD
value or a transaction id. The proof snapshot (Ref shares, recorded shares, confirmation block) is
stored in the position and emitted in the `position_admitted` event.

## 3. Reward rule

```
reward  = min( usdc_in_lp × 10^12,                 // 1 FUEL per USDC of stablecoin actually in the pool
               vault cap left (rolling 30 days),    // ≤ 2 000 FUEL per vault (= creator)
               season budget left,
               PoL reserve available )
creator   = floor(reward × 80 %)                    // paid on claim
community = reward − creator                        // moves to the community reserve on SUCCESS
```

- `usdc_in_lp` is the USDC that Ref deposit deltas show actually entered the pool. It is not the
  90 % budget or a quote. The wNEAR leg is not counted, so the rule stays conservative and needs
  no price oracle.
- The cap counts at admission (conservative: a later failed season does not give the cap back).
  `shortcut: per-vault Vec of awards, pruned on write; fine for a demo, index by time if vaults get thousands of awards`.
- The community reserve is **not distributed to anyone**: there is no method to spend it.
  Distribution rules are future work.

## 4. Seasons

- Season `k` = `[genesis + k·duration, genesis + (k+1)·duration)`. No cron, no admin: the
  current season is derived from block time.
- A position counts **once**, for the season of its `lp_confirmed_at`. Capital confirmed earlier
  stays visible in the Treasury, but it can never recharge a later season.
- **Async policy, deterministic.** A position confirmed in season `k` counts for `k` if and only if
  `register_position` was *called* before `end_k + registration_grace`. The request time is
  recorded by FUEL itself and passed to its own callback. Calls made later are refused: never
  retroactive, never moved to `k+1`.
- `close_season(k)`: anyone can call it from `end_k + registration_grace + 60 s`. The extra 60 s
  covers in-flight proof callbacks, which take 1–3 blocks. It is idempotent: a second call fails,
  so a season burns at most once.
  - **SUCCESS** (`progress ≥ target`): `level + 1`; the community share moves to the community
    reserve; creators' rewards become claimable once their lock is over.
  - **FAILED**: `level − 1` (never below 0); every commitment returns to `pol_available`; burn
    `min(season_burn, burn_reserve)` from the burn reserve. This is `internal_withdraw` plus an
    `ft_burn` event, so `total_supply` really decreases.
  - Only seasons with at least one admitted position have a record. Empty seasons cannot be closed,
    so creating empty seasons cannot drain the burn reserve.
- `claim(position_id)`: anyone can call it, and the FUEL always goes to the Treasury-recorded
  creator. It requires season SUCCESS, the LP lock to be over, and the creator to be registered on
  FUEL. The payout is a synchronous internal transfer, so a failure reverts everything and the
  reward stays claimable. A second claim fails with `ERR_ALREADY_CLAIMED`.
- The level is a community progress indicator. It gives no economic right.

## 5. Parameters

| Parameter | Bound enforced in `new()` | Testnet demo value | Production (hypothetical, not deployed) |
|---|---|---|---|
| `season_duration_ns` | ≥ 60 s | 30 min | 30 days |
| `registration_grace_ns` | ≤ season duration | 5 min | 1 day |
| `season_target_usdc` | > 0 | 5 USDC (`5000000`) | to be set from real demand |
| `season_reward_budget` | ≤ 600 000 FUEL | 5 000 FUEL | — |
| `season_burn` | ≤ 10 FUEL | 10 FUEL | ≤ 10 FUEL |
| `min_lock_ns` | — | 10 min (= Treasury demo lock) | 30 days |
| `vault_cap` | 0 < cap ≤ 2 000 FUEL | 2 000 FUEL | 2 000 FUEL |
| `team_cliff_ns` / `team_vesting_ns` | vesting > 0, ≥ cliff | 60 min / 10 h | 12 / 36 months |

All parameters are immutable, and the contract has no admin method.

## 6. Why this fits *Memecoins With Mechanics*

- "Treasuries with rules": the 90/8/2 Treasury and the FUEL buckets are fixed at deployment.
- "Supply that reacts to the community": failed seasons burn real supply, successful ones level the
  Reactor up.
- "Judged on the mechanic, not the chart": every decision reads LP state on Ref and the Treasury;
  nothing uses a price.

## 7. Trust and limits (honest)

- FUEL trusts the Treasury contract's views for the position details (creator, USDC in LP, lock),
  and cross-checks the share backing against Ref directly. Both contract ids are fixed at init.
- Ref is governed by its own DAO and guardians (`docs/FEASIBILITY.md` R1). If Ref paused or
  changed, admissions would fail closed.
- Seasons are short on testnet so a full cycle fits in a demo, and the config says so.
- Not implemented: community-reserve distribution, LP-share NFTs or MFT transfer of positions to
  FUEL (the Treasury keeps the shares), wallet signing in the UI.
