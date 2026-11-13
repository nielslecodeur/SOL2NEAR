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

## 3. Unverified points U1–U5 — status on 2026-11-13

Sources: the official NEAR Intents 1Click API reference read on 2026-11-13 (`docs.near-intents.org/api-reference/oneclick/*`,
OpenAPI 0.1.10 at `1click.chaindefuser.com/docs/v0/openapi.yaml`), which Tidepool says it is compatible with.
**Matching the 1Click spec is not proof that Tidepool behaves the same.** Only a live call to Tidepool closes a U-item.

| # | Point | 1Click spec says | Status | How the code protects itself |
|---|---|---|---|---|
| U1 | Live quote has `quote.depositAddress` and `quote.deadline` | `deadline` and `depositAddress` are inside `quote`. A dry response has neither (nor `timeWhenInactive`). `depositMemo` exists for memo deposit modes | ✅ spec · ⏳ Tidepool live | missing `depositAddress` → error; missing deadline → not fundable; **any `depositMemo` → refused** (memo not supported); the echoed `quoteRequest` must match our assets / amount / recipient / refund address |
| U2 | SPL deposit goes to the ATA of `depositAddress` | only says "transfer to depositAddress"; ATAs are not mentioned | ⚠️ standard Solana convention, unverified | tx creates the ATA idempotently. ⚠️ If Tidepool expected a token-account address instead, the funds would land on an ATA it does not watch: **verify on the first 1 USDC test** |
| U3 | `GET /v0/status?depositAddress=` shape | `{correlationId, quoteResponse, status, updatedAt, swapDetails}`; `swapDetails.originChainTxHashes / destinationChainTxHashes` = `[{hash, explorerUrl}]`, plus `refundedAmount`, `refundReason`; 404 if the address is unknown | ✅ spec · ⏳ Tidepool live | unknown status → error; `quoteResponse.quote.depositAddress` must equal ours; `refundedAmount` recorded |
| U4 | `POST /v0/deposit/submit {txHash, depositAddress}` | same fields (+ optional `nearSenderAccount`, `memo`); optional; returns the status shape | ✅ spec · ⏳ Tidepool live | sent once per pair; its failure never fails the deposit |
| U5 | quote signature | SHA-256 of a stable-stringified JSON, checked with the 1Click SDK `verifyQuoteSignature`; no key published in the docs | ❌ not verifiable (Tidepool key unknown) | signature kept, not verified. Safety comes from the echo checks and the NEAR balance check instead |

New guarantees added on 2026-11-13 (unit-tested with mocks):
- The Solana deposit is confirmed on-chain before anything else. A failed tx gives `solana_tx_failed`.
- Tidepool `SUCCESS` is not trusted alone: the recipient's balance on `usdc.tidepool-sandbox.testnet` must rise by at least `minAmountOut`, otherwise `settlement_mismatch`.
- Every transfer is persisted. A reload never re-signs, and an interrupted signing is blocked (`interrupted`).

## 4. Why Tidepool is unreachable here (diagnosed 2026-11-13)

| Check | Result |
|---|---|
| Windows DNS servers | `10.5.30.11`, `10.0.30.11` (Wi-Fi, search domain `atlas.local`) |
| `www.usetidepool.tech` / `usetidepool.tech` via system DNS | **CNAME `sinkhole.paloaltonetworks.com`**, no A record |
| Same names asked directly to `1.1.1.1` and `8.8.8.8` | **same sinkhole answer**: port-53 traffic is intercepted by the network |
| `k7hxymjg.up.railway.app` (Tidepool's real host) via system DNS | resolves (`153.52.255.37`); Railway itself is not blocked |
| WSL | uses the Windows resolver (`10.255.255.254`) → no address |
| Chrome | same failure (error page) |
| Public DoH from another vantage point (Cloudflare, 2026-11-13 morning) | `www.usetidepool.tech` → CNAME `k7hxymjg.up.railway.app` → `153.52.255.37`: the service exists |

**Conclusion: not a code problem, not an obsolete endpoint.** The network's Palo Alto firewall deliberately sinkholes the
`usetidepool.tech` domain. This is a security policy of that network. It must not be bypassed (no hosts-file
override, DoH, IP pinning or VPN on that network). The options are another network the user is entitled to use (home
connection, phone hotspot), or asking the network administrator. A firewall category that sinkholes a domain is also a
reason to send **test tokens only**, which is the plan anyway.
