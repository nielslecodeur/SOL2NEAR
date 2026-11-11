# CHECKPOINT A2 — FUEL Reactor, token mechanics, frontend

Date: 2026-11-11 (late evening UTC). Branch: `feat/core` (local commits, **not pushed**).
Status: **READY WITH LIMITATIONS**. Contracts and UI are implemented, unit-tested and built.
**Nothing is deployed, so no transaction proves the Ref LP or FUEL flow yet.**

## 1. Verified results (commands re-run on this checkpoint)

| Check | Result |
|---|---|
| `cargo test --workspace` (Windows) | Treasury **34 passed**, FUEL **31 passed** (after G2 fixes; see `docs/G2_READINESS.md`), 0 failed |
| `cargo test -p sol2near-fuel demo_walkthrough -- --nocapture` | narrated 6-step demo passes (MOCKED VM) |
| `bash scripts/build-wasm.sh` (WSL, cargo-near 0.22.0) | Treasury **250.3 KB**, SHA-256 `73b99075d8df832e32da2bd53c91e20194539a5a72a67c11ba373c44e0fb520e`; FUEL **256.8 KB**, SHA-256 `a33678f60eb25e3db83074db4d052bf6e102bca7fd953834c65115a8f409bbac` |
| FUEL ABI | 23 functions, **no mint method**; `on_position_proof` and `ft_resolve_transfer` private |
| `pnpm --filter @sol2near/web test` / `build` | 5 passed / built (160 KB JS, 52 KB gzip) |
| `pnpm test:ts`, `pnpm typecheck` | near-client 6 passed; typecheck OK |
| Live rules re-read (HACKATHON.md) | unchanged vs `docs/HACKATHON_CHECKLIST.md` |
| A1 wasm blocker | **resolved** since A1 (cargo-near 0.22.0 in WSL); see `CHECKPOINT.md` |

## 2. Implemented

- **FUEL** (`contracts/fuel`): see `docs/FUEL_REACTOR.md`.
  - Supply is 1 000 000, minted once at init: 600k PoL, 199k ecosystem + 1k burn reserve, 150k
    liquidity, and 50k team with an **on-chain** cliff and linear vesting.
  - Proof of Liquidity reads Treasury `get_deposit` + `get_accounting` and **Ref
    `get_pool_shares`** in a single round-trip. Rejected positions write nothing.
  - Reward rule: 1 FUEL per USDC actually in the LP, split 80/20, capped at 2 000 FUEL per vault
    over a rolling 30 days, and bounded by the season budget and the reserve.
  - Calendar seasons. A position counts once, for its confirmation season.
  - Permissionless `close_season`: SUCCESS levels up; FAILED levels down and burns ≤ 10 FUEL,
    once, from the burn reserve, as a real supply reduction. Empty seasons cannot be closed.
  - Synchronous, idempotent claims. `storage_unregister` never burns.
- **Treasury**: three proof fields were added to `Deposit` (`pool_id`, `lp_confirmed_at`,
  `lp_confirmed_block`).
- **Web** (`apps/web`):
  - Dashboard: received, 90/8/2, deposit statuses, LP shares backed on Ref, cross-chain card.
  - Vault detail pipeline, with block explorer links.
  - FUEL Reactor: level, countdown, verified progress, buckets, history.
  - Live testnet in read-only mode, plus a demo mode bannered SIMULATED whose numbers obey the
    contract invariants.
- **Docs**: `FUEL_REACTOR.md`, `ARCHITECTURE.md` §8–9, `HACKATHON_CHECKLIST.md` §4–5,
  README (command → result → verification), and §7 of `scripts/testnet-bootstrap.md`.

## 3. Required tests → where

| Prompt requirement | Test (contracts/fuel/src/tests.rs) |
|---|---|
| Double claim | `double_claim_is_rejected`, `demo_walkthrough` step 6 |
| Position reuse | `a_position_is_rewarded_once`, `register_rejects_known_position_before_any_call` |
| Non-existent position | `rejected_positions_write_nothing` (None), `unknown_position_cannot_be_claimed` |
| LP not locked | `rejected_positions_write_nothing` (short lock, withdrawn), `claim_waits_for_the_lp_lock` |
| Pending position | `rejected_positions_write_nothing` (SwapPending, BudgetAllocated), `pending_reward_cannot_be_claimed` |
| FUEL transfer failure | `failed_transfer_keeps_the_reward_claimable` |
| Insufficient reserve | `reward_never_exceeds_season_budget_or_reserve` |
| Cap exceeded | `vault_cap_is_rolling_30_days` |
| Wrong token / pool | `rejected_positions_write_nothing` (wrong pool, unverified, not backed on Ref) |
| Wrong calling contract | `proof_callback_rejects_other_callers` |
| Rounding & conservation | `rounding_conserves_every_atomic_unit`, `odd_reward_floors_to_creator_remainder_to_community`, `assert_invariants` in every scenario |
| No double burn / burn bounds | `failed_season_burns_at_most_10_fuel_once_and_releases_rewards`, `burn_stops_when_the_burn_reserve_is_empty`, `empty_seasons_cannot_be_closed_or_burned`, `burn_parameter_is_bounded` |
| Season farming | `old_capital_cannot_recharge_a_later_season` |
| Position theft | `successful_season_levels_up_and_enables_claims_after_lock` (caller gets nothing) |
| Vesting enforced | `team_vesting_is_enforced` |

All of these run on a **mocked NEAR VM**: Treasury and Ref answers are injected. They are not
sandbox or testnet tests.

## 4. Partial or blocked

| Item | State | Blocker |
|---|---|---|
| Ref pool + real LP (G2) | not done | Tidepool NEAR faucet (account ≥ 3 h, ~23:20 UTC) + your approval to sign |
| Deploy Treasury + FUEL, `setup`, full cycle (G3) | not done | needs G2 pool id + approval; ≈ 3 NEAR (Treasury) + ≈ 3 NEAR (FUEL) of storage, and `sol2near-dev` holds ~5 NEAR, so another faucet claim may be needed |
| Ref behaviour H3/H4/H5/H11 | unverified | G2 |
| Tidepool live bridge | dry quote only | teammate module + live transfer approval |
| Wallet signing in the UI | not built | A3: wallet selector, or near-cli commands meanwhile |
| UI visual check in a browser | not done in this session | open `pnpm --filter @sol2near/web dev` |
| Community reserve distribution | no method (by design) | rules to define |
| Integration tests against real Ref (sandbox import) | not written | A3 |

## 5. Rhea / Ref integration status

The Treasury pipeline and the FUEL proof call Ref methods that were probed on the deployed v1.9.19
wasm: `get_pool_shares`, `add_liquidity`, `swap`, `mft_transfer`, `register_tokens`. No SOL2NEAR
transaction has touched Ref yet. The LP share model is respected: shares are MFT `:<pool_id>`
(24 decimals), held by the Treasury, and read with `get_pool_shares`.

## 6. Tidepool status

Verified on 2026-11-11: route live and dry quote OK, settlement is a plain `ft_transfer` on NEAR.
`packages/crosschain` is still empty (no `feat/crosschain` branch on the remote). The UI uses an
isolated, labelled SIMULATED adapter and shows "not integrated" in live mode.

## 7. Git

Branch `feat/core`, created from `main@debc460`. Local commits for A2 are listed by
`git log main..feat/core`. Nothing is pushed.

## 8. Dependencies for A3

1. Faucet + G2 manual Ref sequence → pool id.
2. Approval to deploy Treasury and FUEL (demo config in `scripts/testnet-bootstrap.md` §6–7) and to run one full cycle.
3. Teammate `packages/crosschain` + handoff, then replacing the SIMULATED adapter.
4. Wallet signing in the UI (deposit, `execute_lp`, `register_position`, `close_season`, `claim`).
5. Demo video, X post (human), final rules check (`docs/HACKATHON_CHECKLIST.md` §9).

## 9. Open technical risks

- Ref storage costs and the 1-yocto `swap` deposit are unverified (H3/H4/H11). If they differ,
  the Treasury attachments must be changed before deploy.
- FUEL trusts the Treasury's view for `usdc_in_lp` and the lock. Share backing is cross-checked on
  Ref, but the USDC amount is not: a Treasury bug would propagate.
- A season can be closed by anyone right after it ends. Positions confirmed late in a season must
  be registered before someone closes it, otherwise they are refused (`ERR_SEASON_CLOSED`).
- The global LP lock in the Treasury serializes creators. Fine for a demo, not for scale.
- The testnet demo routes the ecosystem, liquidity and team allocations to the dev account.
