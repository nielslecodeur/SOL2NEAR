# SOL2NEAR — Architecture (Checkpoint A1)

Scope: what is implemented in `contracts/treasury` and how it maps to the V3 spec
(`docs/SOL2NEAR_V3_Specification_Projet_Complete.md`). Verified external facts are in `docs/FEASIBILITY.md`.

## 1. Money flow

```
Solana Devnet USDC ──Tidepool──► user.testnet (plain ft_transfer, verified tx 2bDGk6…92Am)
user.testnet ──ft_transfer_call(Treasury, msg={"action":"deposit"})──► Treasury.ft_on_transfer
Treasury: split 90 / 8 / 2 (atomic, residue -> community)
creator ──execute_lp(plan)──► Treasury ──► Ref ft_transfer_call ─► swap (partial) ─► add_liquidity ─► verify
LP shares (Ref MFT ":<pool_id>") held by Treasury, recorded per deposit, locked until unlock_at
creator ──withdraw_lp──► mft_transfer(shares → creator)       creator ──withdraw_reserve──► USDC
anyone ──verify_liquidity──► get_pool_shares(Treasury) vs recorded_shares → Proof + event
```

Why the user (not Treasury) is the Tidepool recipient: Tidepool settles with a plain `ft_transfer`,
so a contract recipient is never notified and cannot attribute the deposit. The second hop
`ft_transfer_call` makes the token contract itself prove sender and amount (no oracle, no frontend claim).

## 2. Deposit state machine

```
BudgetAllocated ─execute_lp─► AmmDepositPending ─ok─► InRef ─► SwapPending ─ok─► Swapped
      ▲                         │fail                 ▲          │fail             │
      └─────────────────────────┘                     └──────────┘                 ▼
                                                     Swapped ◄─fail─ AddLiquidityPending
                                                                           │ok
                                                                           ▼
                                   LpConfirmed ◄──────────────────── VerifyPending
                                       │ withdraw_lp (after unlock_at)
                                       ▼
                               LpWithdrawPending ─ok─► LpWithdrawn   (fail → LpConfirmed)
```

- **Resumable**: `execute_lp` restarts from `BudgetAllocated`, `InRef` or `Swapped` (new plan allowed).
- **One job at a time** (`in_flight`): share/dust deltas are unambiguous; withdrawals wait for it.
- **Callbacks** are `#[private]` and act only if the deposit is the in-flight job **and** in the
  expected stage → replays and late callbacks are ignored (`callback_ignored` event).
- **Failures** never mark funds as LP: each failure returns to the last *confirmed* stage and
  releases the lock; funds stay either in Treasury (budget) or in Treasury's Ref deposit.
- **Reconcile**: if no stage progress for 10 min, anyone can call `reconcile()`; it reads
  `get_pool_shares` + `get_deposits` on Ref and infers the real stage from Treasury's expected balances.
  A nonce (`in_flight.since`) prevents a stale reconcile from overriding progress.

## 3. Accounting invariants (view `get_accounting`)

| Field | Meaning |
|---|---|
| `total_received` | Σ USDC credited by the USDC contract |
| `pending_budget_total` | LP budgets still in Treasury (BudgetAllocated / AmmDepositPending) |
| `reserve_total` / `community_total` | 8 % creator reserves / 2 % community budget, held in Treasury |
| `ref_expected_usdc/wnear` | What Treasury expects in its Ref internal deposit (parked plans + dust) |
| `recorded_shares` | LP shares held for creators (LpConfirmed + LpWithdrawPending) |

Treasury USDC balance on the token contract should equal
`pending_budget_total + reserve_total + community_total` outside of in-flight transfers.
LP amounts actually used are measured from Ref deposit deltas, not assumed; leftovers are
stored per deposit as `dust_usdc` / `dust_wnear`.

## 4. Proof of Liquidity (SOL2NEAR definition, not an external standard)

- `lp_shares` per deposit = value returned by Ref `add_liquidity`.
- `lp_verified` = Treasury's on-chain share balance ≥ previously recorded + minted, read right after.
- `verify_liquidity()` (anyone) records `{onchain_shares, recorded_shares, ok, block_height}` and
  emits `EVENT_JSON {"standard":"sol2near","event":"proof_of_liquidity",…}`.
- FUEL (checkpoint 2, `contracts/fuel`) will release rewards only for `LpConfirmed && lp_verified`
  deposits after the lock, never from a frontend claim.

## 5. Immutability and roles

- No owner, no admin method: `Config` (tokens, Ref, pool id, min deposit, lock duration) is fixed
  in `new()`. 90/8/2 are compile-time constants.
- `setup()` is permissionless and idempotent (storage registrations + `register_tokens` + pool check).
- Only the creator of a deposit can execute its LP plan, withdraw its LP or its reserve.
- The community budget (2 %) has no withdrawal method yet: rules are defined in checkpoint 2.
- Deleting the account's full-access key after deployment (true immutability) is irreversible and
  will only be done on explicit decision.

## 6. Gas (static, ≤ 300 Tgas per tx)

`execute_lp` from `BudgetAllocated` needs ~145 Tgas of chained work + margin (enforced ≥ 160 Tgas);
callers should attach 300 Tgas. Per-call budgets are constants at the top of `lib.rs`.

## 7. Build & test

```powershell
# unit tests (Windows): aws-lc-sys needs CMake (bundled with VS 2022) and no NASM
$vs = "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake"
$env:PATH = "$vs\CMake\bin;$vs\Ninja;$env:PATH"; $env:AWS_LC_SYS_NO_ASM = "1"
cargo test -p sol2near-treasury

# wasm (fallback until cargo-near is installed): ~302 KB stripped
$env:RUSTFLAGS = "-C link-arg=-s"; cargo build -p sol2near-treasury --target wasm32-unknown-unknown --release
```

Not yet proven: that this raw wasm (Rust 1.98) is accepted by nearcore testnet (FEASIBILITY H8);
`cargo near build` is the reference build once installed.

## 8. Known limits (A1)

- Global lock serialises LP jobs (fine for a demo, not for many creators).
- Storage of deposits is paid by Treasury's balance (no per-depositor storage charge yet).
- Dust stays in Treasury's Ref deposit (attributed per deposit; withdrawal method in a later checkpoint).
- Ref behaviour is taken from probes of the deployed wasm, not from source (repo 404):
  H3/H4/H5/H11 must be confirmed by `scripts/testnet-bootstrap.md` before deploying Treasury.
- Gifted LP shares (someone `mft_transfer`s shares to Treasury) could inflate a delta only in the
  `reconcile` path; the normal path uses the `add_liquidity` return value.
