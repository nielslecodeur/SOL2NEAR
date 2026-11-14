# G8 — Proof ledger (Solana devnet → NEAR testnet → Treasury → Ref → FUEL)

Read and re-verified on 2026-11-14 with **read-only** calls:
- `node scripts/probes/verify-g6-g7.mjs`: every NEAR tx final with its expected events, plus the Solana tx finalized;
- `node scripts/probes/verify-testnet.mjs`: contract and pool state;
- `node scripts/probes/g8-audit.mjs --json packages/near-client/src/fixtures/g8_audit_2026-11-14.json`: deposit #3 and the full correlation.

**Nothing in this ledger is invented.** The G8 rows have no hash because those transactions have **not** been signed.

**This is not an atomic cross-chain transaction.** It is a chain of separate transactions on two networks, linked by the records listed in §2.

## 1. The G8 chain

| # | Step | Network | Contract / account | Transaction | Amount | Status | Evidence kind | Limitation |
|---|---|---|---|---|---|---|---|---|
| 1 | Solana deposit to the Tidepool deposit address | Solana **devnet** | SPL token `7paf…r4Xr`, from `4NKELSMW…NE4z5` (ATA `AFDH7pLE…97M1`) to `5gUT7A3Z…vNpU` (ATA `CwHAAyy3…6RkN`) | [`bGUicpgy…887R`](https://explorer.solana.com/tx/bGUicpgyYtePFP3BcEXYHQ9me67uqFjFQWmS8FsKWhYSzwpcVDv5SZyyLxYneLX93Bic4JZRFrWvphQUkEs887R?cluster=devnet) | 2.000000 USDC (`transferChecked` 2000000) | finalized, `err = null`, slot 521 962 250 | **executed tx, re-verified** | signed by the user in Phantom; test USDC |
| 2 | Tidepool processes the deposit | Tidepool (off-chain service) | deposit address `5gUT7A3ZdqgnEe5eKTwQRBrwTcm3EJmNfRiCZTG2vNpU`, correlationId `d0112628-3063-4c47-9a40-5836b92468d2` | `GET /v0/status` | in 2.000000 → out 1.994800 (min 1.974852) | `SUCCESS` 2026-11-13 21:39:08 UTC | **third-party record, re-read** | Tidepool is a community sandbox, not NEAR Intents; its record is its own assertion |
| 3 | Settlement on NEAR: intents executed, then `ft_transfer` to the user | NEAR **testnet** | `verifier.tidepool-sandbox.testnet`, signer `maker.tidepool-sandbox.testnet` | [`J58H2uyu…RFqf`](https://testnet.nearblocks.io/txns/J58H2uyuGo4wJsjbNuX1AEEwszD4Z8CMAppCqCirRFqf) | 1.994800 USDC to `lowarena9362.testnet` | `SuccessValue`, FINAL | **executed tx, re-verified** | — |
| 4 | Deposit into the Treasury | NEAR testnet | `usdc.tidepool-sandbox.testnet` → `treasury.sol2near-dev.testnet` | [`J7uMjikj…Bdhz`](https://testnet.nearblocks.io/txns/J7uMjikj935TeunPoHj2i7xrCSSDrYEAmvdHv7DYBdhz) | 87.994800 USDC, fully used | `SuccessValue`, FINAL, event `deposit_allocated #3` | **executed tx, re-verified** | the creator deposited the **whole balance**: 86.000000 pre-existing + 1.994800 bridged (§2) |
| 5 | 90/8/2 allocation | NEAR testnet | Treasury `get_deposit(3)` | (same tx) | 79.195320 LP / 7.039584 reserve / 1.759896 community | `BudgetAllocated` | **on-chain state, re-read** | — |
| 6 | Ref swap (USDC → wNEAR, pool 2951) | NEAR testnet | Treasury → `ref-finance-101.testnet` | **not signed** | planned 32.943229 USDC → 4.052965 wNEAR | — | **prepared, awaiting the creator's signature** | 29.13 % price impact on the test pool (see `G8_FINAL_EXECUTION.md`) |
| 7 | Ref add_liquidity, shares held by the Treasury | NEAR testnet | Ref pool 2951 | **not signed** | planned 46.252091 USDC + 4.052965 wNEAR → ≈ 5.164e23 shares (estimate) | — | **prepared** | shares are recorded from Ref after execution, never from this estimate |
| 8 | Treasury LP ownership proof | NEAR testnet | Treasury `verify_liquidity` / Ref `get_pool_shares` | — | — | — | **pending** | — |
| 9 | FUEL `register_position(3)`, season close, claim | NEAR testnet | `fuel.sol2near-dev.testnet` | — | expected 46.252 FUEL in total, 37.0017 to the creator, if registered in time | — | **pending** | each a separate approval; timing rules in `G8_FINAL_EXECUTION.md` §5 |

## 2. Correlation: how step 1 is linked to step 4

| Link | Check | Result |
|---|---|---|
| Solana tx ↔ Tidepool deposit | the Tidepool status of `5gUT7A3Z…` lists `originChainTxHashes` = `bGUicpgy…887R`; the Solana tx pays exactly that address 2000000 | ✅ `solana_tx_in_tidepool_record` |
| Tidepool ↔ NEAR settlement | the Tidepool status lists `nearTxHashes` containing `J58H2uyu…RFqf` | ✅ `near_tx_in_tidepool_record` |
| Tidepool ↔ on-chain intents | its `intentHashes` `4gkmbTHM…sM91` and `6frePNkF…iKjJ7` are **the `intent_hash` values emitted on-chain** by `J58H2uyu…` (dip4 events) | ✅ `intent_hashes_match_onchain_events` |
| NEAR settlement ↔ recipient | quote `recipient` = `lowarena9362.testnet`; `ft_transfer` verifier → `lowarena9362.testnet` 1994800 | ✅ |
| NEAR wallet ↔ Treasury deposit | balance arithmetic only: 86.000000 → **87.994800** after the settlement → 0 after `J7uMjikj…` (87.994800 deposited) | ⚠️ USDC is fungible: deposit #3 *contains* the bridged 1.9948 USDC (2.27 % of it). It is not tagged by an identifier |

## 3. Earlier proofs on the same contracts (all re-verified 2026-11-14)

| ID | What | Transaction |
|---|---|---|
| A8 | Ref `add_simple_pool` → pool 2951 | [BXcJeRyX…7f7B](https://testnet.nearblocks.io/txns/BXcJeRyXUUEwniGP46KJeYRjWHxgHcPK2RCQdpYZ7f7B) |
| A9 | seed 50 USDC + 14.0392 wNEAR | [5MahUPdU…fBRp](https://testnet.nearblocks.io/txns/5MahUPdUvWNSbD14RuijZXGTpHmA66ZpN67yR1EHfBRp) |
| B1 | deploy Treasury (SHA-256 `73b99075…520e` = deployed `code_hash` `8njzxUPU…7F3`, checked byte for byte) | [HJTW4c6u…yUpY](https://testnet.nearblocks.io/txns/HJTW4c6uNaSVmuzNRG84NcCQaRMeunAoiP3omquNyUpY) |
| B2 | Treasury `setup` | [6sMPV5RT…eVgy](https://testnet.nearblocks.io/txns/6sMPV5RToZRd77cjaUa32QgpU9f8poWFawpFAKSEeVgy) |
| B4 | deploy FUEL (SHA-256 `a33678f6…bbac` = deployed `code_hash` `Bz7dZyzX…9inP`) | [JBdFrx2j…rbBP](https://testnet.nearblocks.io/txns/JBdFrx2j7ToEWWY77aKpbpw8B6PivPhowM9ZZWQtrbBP) |
| C1 | deposit #0, 20 USDC | [AsD2o2aV…ZWzw](https://testnet.nearblocks.io/txns/AsD2o2aVxkSmhm4c3TVsLs9aZgKjMTog2KW42pieZWzw) |
| C2 | `execute_lp(0)` | [4F2wXqzm…SSHA](https://testnet.nearblocks.io/txns/4F2wXqzmyBVaPqKa6mE3KMFjFv2S3U3GxXJYJfNsSSHA) |
| C3 | `verify_liquidity` | [8DCCtF7y…MrkA](https://testnet.nearblocks.io/txns/8DCCtF7yafVwXnGhziTAAHvxhS94nZiTPXZk5ry3MrkA) |
| C4–C7 | FUEL register, close (Success), claim, second claim rejected | [CoAgrgQE…Lk6o](https://testnet.nearblocks.io/txns/CoAgrgQEhmktNEK1hvgZpwUHjsaTR6XvS9z1NSNpLk6o), [DUuoq2XZ…haH9](https://testnet.nearblocks.io/txns/DUuoq2XZsmVbwp8zjzhW3gHRqjiDwokwbTMSNufdhaH9), [6g13fiwv…hXxu](https://testnet.nearblocks.io/txns/6g13fiwvEbSoHhYLXGkDcN9tEsPLG2LXic88bmP3hXxu), [J8UEKyZy…AoWHi](https://testnet.nearblocks.io/txns/J8UEKyZyyYpHrzW8HTJiJ1tqtq23GdkX2VA8HdYAoWHi) |
| G6-D / G6-LP | dashboard + Meteor: deposit #1, `execute_lp(1)` | [FaBKjLRU…haHV](https://testnet.nearblocks.io/txns/FaBKjLRUuYMgH4SgVgurTyUinDPvPvdH5Rxc69X1haHV), [CniqxoxZ…bRdN](https://testnet.nearblocks.io/txns/CniqxoxZ5qzJBLZ9RCwJ9nH4evbNwaGV6Y1nE4aDbRdN) |
| G6-D2 / G6-LP2 | deposit #2, `execute_lp(2)` | [DmbsT6ce…g9Gi](https://testnet.nearblocks.io/txns/DmbsT6ce7U9GPqVZYPgv2Kc5hmMn8cNeYKKDq8u1g9Gi), [CundGCKW…pHyD](https://testnet.nearblocks.io/txns/CundGCKWCSnC14tTRkaJ8EiRzDRttQvhQ3SjFgfTpHyD) |
| G6-FUELSTO / REG2 / CLOSE / CLAIM | FUEL storage, `register_position(2)`, `close_season(70)` Success, `claim(2)` 4.4688424 FUEL | [DntEzzYD…PQFg](https://testnet.nearblocks.io/txns/DntEzzYDmLsznGpMEyDcW9Q872Y7azKT6NMqzv3GPQFg), [SrFHSmHC…sghM](https://testnet.nearblocks.io/txns/SrFHSmHCx41j2ytekUvZhV5sX4AHkSsQCrBNLZbsghM), [ELiyFHpW…Ay3s](https://testnet.nearblocks.io/txns/ELiyFHpWnJSMrQamjP1cxYZsRXnUNBg5t32r1nMjAy3s), [8CRvXVJg…A7F8](https://testnet.nearblocks.io/txns/8CRvXVJgk7sEiapJZSYiiFhhMRANPxZL9rGmAsFsA7F8) |
| G6-REJ | `register_position(1)` after its window → `ERR_REGISTRATION_WINDOW_CLOSED` (expected refusal) | [3HsEr7b3…XQRzF](https://testnet.nearblocks.io/txns/3HsEr7b3Mr1zYLmLi3q6ApgcthXarUTwe9tg5xxXQRzF) |

## 4. Evidence kinds (never mixed)

| Kind | In this project |
|---|---|
| 1. Transaction really executed | the rows above with a hash (Solana devnet, NEAR testnet) |
| 2. On-chain state really verified | `verify-testnet.mjs`, `verify-g6-g7.mjs`, `g8-audit.mjs`: Treasury books = token balances (91.394800 USDC = reserves 9.759584 + community 2.439896 + pending 79.195320), Ref shares = recorded shares |
| 3. Sandbox test | V4.1 TreasuryV4 and V4.2A TreasuryDCL (`docs/v4/*-run.log`): real contract code, local state |
| 4. Mock test | crosschain unit tests (mocked Tidepool / Solana), `@offline` e2e (replayed RPC snapshot), Phantom provider mock |
| 5. Browser simulation | Creator Portal simulator, DCL estimator (view calls only) |
| 6. Not deployed | TreasuryV4, TreasuryDCL, S2NMEME; any mainnet execution |
