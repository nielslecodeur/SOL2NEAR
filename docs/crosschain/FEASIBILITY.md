# Cross-chain feasibility — Tidepool (Solana Devnet → NEAR testnet)

Tidepool is a **community-built, 1Click-compatible sandbox, not the official NEAR Intents service**.
NEAR Intents has no testnet. Test tokens have no value.

Legend: ✅ verified live (date) · 📄 read in the Tidepool docs · ⚠️ assumed (1Click convention), not yet verified on Tidepool.

## 1. Verified facts

Facts T1–T14 were verified on 2026-11-11 and are recorded in [`docs/FEASIBILITY.md` §2.1](../FEASIBILITY.md). In short:

| # | Fact | Status |
|---|---|---|
| T1–T3 | Base `https://www.usetidepool.tech/v0/…`, no API key. `GET /v0/health` → `ok`, `network: "testnet"`, `bridges.chains.sol.ok` (Solana devnet route) | ✅ 2026-11-11 |
| T4 | Solana devnet USDC: asset `nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet`, mint `7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr`, 6 decimals | ✅ 2026-11-11 |
| T5 | NEAR USDC: `usdc.tidepool-sandbox.testnet`, NEP-141, 6 decimals, storage 0.00125 NEAR | ✅ 2026-11-11 |
| T6 | `POST /v0/quote` dry, body in §2 → `quote.amountIn/amountOut/minAmountOut/timeEstimate`, top-level `correlationId` + ed25519 `signature`. 1 USDC → 0.9974 USDC, min 0.987426 at 100 bps, ~60 s | ✅ 2026-11-11 |
| T8 | A dry quote does not check that the NEAR recipient exists | ✅ 2026-11-11 |
| T9 | Settlement on NEAR is a plain `ft_transfer` to the recipient (not `ft_transfer_call`). **The recipient must be the user's own NEAR account**; the user then deposits into the Treasury | ✅ 2026-11-11 (tx `2bDGk6Pu…S92Am`) |
| T11 | Faucet is site-only (100 USDC SPL on Solana devnet); direct API → 403 `site_only` | 📄 + ✅ 403 |
| T12 | Deposit addresses are custodial, a single maker, no SLA | 📄 |
| T14 | Statuses `PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED`; poll every 2–5 s; live deadline between 60 s and 24 h | 📄 |

New on 2026-11-13 (Solana devnet RPC `getAccountInfo`, read-only):

| # | Fact | Status |
|---|---|---|
| S1 | Mint `7paf…r4Xr` is owned by the **classic SPL Token program** `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (not Token-2022), 6 decimals, mint authority `BEijzwSQpWxbgQQ5NfBePxUzHgLoc2vrApPe8G4St55Q` (= Tidepool Solana relayer, T3), freeze authority none, supply 201 200 USDC | ✅ 2026-11-13 |

## 2. Quote request (exact body sent)

```json
{ "dry": true, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
  "originAsset": "nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet", "depositType": "ORIGIN_CHAIN",
  "destinationAsset": "nep141:usdc.tidepool-sandbox.testnet", "amount": "1000000",
  "refundTo": "<user Solana address>", "refundType": "ORIGIN_CHAIN",
  "recipient": "<user NEAR account>", "recipientType": "DESTINATION_CHAIN",
  "deadline": "<ISO, now + 30 min>" }
```

## 3. Not verified yet (assumptions coded defensively)

| # | Assumption | Why we think so | How the code protects itself |
|---|---|---|---|
| U1 | Live quote returns `quote.depositAddress` (Solana wallet address) and `quote.deadline` | 1Click convention | missing `depositAddress` → error; missing deadline → quote treated as not fundable |
| U2 | The SPL deposit goes to the **associated token account** of `depositAddress` | 1Click convention for SPL | the tx creates that ATA idempotently (payer pays ~0.002 SOL rent if absent) |
| U3 | `GET /v0/status?depositAddress=…` → `{status, updatedAt, swapDetails:{amountIn, amountOut, originChainTxHashes[{hash}], destinationChainTxHashes[{hash}], refundReason}}` | 1Click convention + status names 📄 T14 | unknown status → error, missing fields left empty, never guessed |
| U4 | `POST /v0/deposit/submit {txHash, depositAddress}` is optional and idempotent | 1Click convention, 📄 "optional speed-up" | sent once per (address, tx); its failure does not fail the deposit |
| U5 | Tidepool's ed25519 quote signature key | not published | signature is kept, not verified |

## 4. Blocker on 2026-11-13

`www.usetidepool.tech` (CNAME `k7hxymjg.up.railway.app`) does not resolve on the development machine's DNS
resolver, and the web-fetch tool hit the same `ENOTFOUND`. Public DNS (Cloudflare DoH) does resolve it. U1–U4
can be checked as soon as the host is reachable: `pnpm --filter @sol2near/crosschain live:dry` (read-only), then a
live transfer, which needs the user's approval, a Devnet Phantom wallet, faucet USDC and ~0.01 SOL.
