# CROSSCHAIN HANDOFF — checkpoints B1 + G3

Last update: 2026-11-13 (G3: Tidepool diagnosis and hardening). **Solo project**: the author owns every module.
Tidepool is a **community 1Click-compatible sandbox, not the official NEAR Intents service**. Testnet / devnet only.

**Update 2026-11-13 (G5):** from another network Tidepool is reachable: `live:dry` passed (health, route, live dry quote `434815b1-…`, echo checks OK) and `verify-testnet.mjs` printed all checks passed. A live transfer is now possible with your approval.

~~**Status: BLOCKED — EXTERNAL DEPENDENCY** for the live transfer.~~ The network used for development sinkholes
`usetidepool.tech` (§1). The code is **ready for a first live devnet test** from a network that reaches Tidepool.

## 1. Tidepool diagnosis

`www.usetidepool.tech` resolves to `sinkhole.paloaltonetworks.com` through the development network's DNS, and port-53
queries to 1.1.1.1 and 8.8.8.8 get the same answer (intercepted). Windows, WSL and Chrome all fail the same way. Tidepool's real host
(`k7hxymjg.up.railway.app`) exists and resolves. It is a network security policy, not a code or endpoint problem, and it
is not bypassed. Details: [`FEASIBILITY.md` §4](FEASIBILITY.md).

## 2. U1–U5

> G7 (2026-11-13): U1, U2 and U3 are ✅ **verified on real Tidepool data**, read-only (`docs/G7_CROSSCHAIN_LIVE.md`). The table below is the earlier G3 status.

| # | Status |
|---|---|
| U1 live quote fields | ✅ matches the official 1Click spec · ⏳ Tidepool live |
| U2 SPL deposit to the ATA of `depositAddress` | ⚠️ Solana convention, not in the docs: **check on the first test** |
| U3 status shape | ✅ spec · ⏳ Tidepool live |
| U4 deposit/submit | ✅ spec · ⏳ Tidepool live |
| U5 quote signature | ❌ not verifiable (key unknown). Compensated by echo checks + NEAR balance check |

## 3. Working (unit-tested, mocked network)

- Quote: inputs validated locally. The echoed `quoteRequest` must match (assets, amount, recipient, refund address, types). Memo deposits are refused. Expiry is checked with a 60 s margin.
- Deposit: NEAR baseline read → unsigned SPL tx (ATA create-idempotent + `transferChecked`, classic SPL Token mint verified on devnet) → wallet → **Solana confirmation** → submit.
- One signature per deposit address. The transfer is persisted (localStorage in the web app). A reload resumes tracking and never re-signs, and an interrupted signing is blocked.
- Tracking: Tidepool statuses → `bridge_success` / `bridge_refunded` (with `refundedAmount`) / `bridge_failed`. A status that echoes another deposit address stops the tracking.
- NEAR receipt: the recipient's `usdc.tidepool-sandbox.testnet` balance must rise by ≥ `minAmountOut`, else `settlement_mismatch`.
- Web card: the four steps are shown separately. Step 4 (the Treasury deposit) is the user's own NEAR transaction; the card gives the exact command.

## 4. Not done

- No live Tidepool call from this package, and no real Solana → NEAR transfer.
- Step 4 (the Treasury deposit) is now done in the dashboard with a NEAR wallet (G4, `docs/G4_NEAR_WALLET.md`). After a verified bridge, *Use this amount* pre-fills it, and a separate NEAR signature is required. The CLI command remains a fallback.
- Quote signature verification (U5).

## 5. Token ids and decimals

| Leg | Asset id | Address | Decimals |
|---|---|---|---|
| Solana Devnet USDC (Tidepool mint) | `nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet` | mint `7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr` (SPL Token `Tokenkeg…`) | 6 |
| NEAR testnet USDC | `nep141:usdc.tidepool-sandbox.testnet` | `usdc.tidepool-sandbox.testnet` | 6 |

The Treasury accepts only `usdc.tidepool-sandbox.testnet` (`ft_on_transfer` refunds any other token: `unsupported_token`).

## 6. API, dependencies

API: [`INTERFACE.md`](INTERFACE.md). Integration example: `packages/crosschain/examples/integration.ts`.
Runtime: `@solana/web3.js` 1.98.4, `@solana/spl-token` 0.4.14. Dev: TypeScript 5.6.3, Node ≥ 22.6 test runner.

## 7. Tests actually run (2026-11-13)

| Suite | Result |
|---|---|
| `pnpm --filter @sol2near/crosschain test` | **35 passed, 0 failed** (mocked Tidepool, Solana RPC, NEAR RPC, wallet, storage) |
| `pnpm --filter @sol2near/web test` | 6 passed |
| `pnpm typecheck` | OK (shared, near-client, crosschain, web) |
| `pnpm --filter @sol2near/crosschain live:dry` | `FAIL GET /v0/health: fetch failed (ENOTFOUND)`: network sinkhole (§1) |

The crosschain tests cover:
- quotes: valid, expired, dry, an insufficient amount (local and as a Tidepool 400), an insufficient balance, an unsupported token, a wrong asset / recipient / refund / amount echoed, a memo deposit;
- errors: network and 5xx;
- the wallet: a rejection, and an error after a possible broadcast;
- Solana: a tx failed on-chain, a confirmation timeout;
- double deposit and double submit;
- reload: after sending, and while the wallet was open;
- tracking: resumed after a reload, pending / success / failed / refunded, an unknown status, a status for another address, transient errors, abort;
- NEAR: SUCCESS without USDC on NEAR, the NEAR RPC down before signing;
- the decoded Solana tx.

**None of them is proof of a cross-chain transfer.**

## 8. First live transfer: exact procedure (needs explicit approval, and a network that reaches Tidepool)

All test assets have **no value**: Solana **Devnet** and NEAR **testnet**.

1. **Network**: on a connection that is allowed to reach it (home or phone hotspot), check
   `pnpm --filter @sol2near/crosschain live:dry`. Expect 3 `PASS` lines, then compare the dry quote with U1.
2. **Wallet**: in Phantom, go to Settings → Developer settings → **Testnet mode ON** and select **Solana Devnet**.
   Copy the Solana address.
3. **Funds**:
   - ~0.01 SOL devnet for fees and ~0.002 SOL rent if the deposit ATA does not exist (faucet.solana.com).
   - Test USDC from the Tidepool faucet (website only, 100 USDC SPL, mint `7paf…r4Xr`).
4. **App**: `pnpm --filter @sol2near/web dev`, then open the URL.
   - Mode **Live testnet**, Creator account = **your own NEAR testnet account** (e.g. `sol2near-dev.testnet`). This is the account that receives the USDC.
   - Cross-chain card: Connect Solana wallet, amount `1`, **Preview (dry quote)**.
   - Check: 1.00 USDC → ~0.99 USDC on NEAR, min shown, recipient = your account.
5. **Bridge 1 USDC**: the app requests a live quote (with a deposit address and deadline) and checks its echo. It reads your NEAR USDC balance, builds the tx and opens Phantom.
   - In Phantom, check before approving: network **Devnet**, token USDC mint `7paf…r4Xr`, amount **1**, destination = the deposit address shown by the quote, fee in devnet SOL.
   - Then approve.
6. **Watch the card**: `Solana deposit confirmed` → `Tidepool processing` → `Tidepool SUCCESS · checking USDC on NEAR` → `USDC verified on NEAR`.
   - If it shows `REFUNDED`, the USDC returns to your Solana address.
   - The Solana and NEAR explorer links are shown.
7. **Step 4 (Treasury)**: in *Your NEAR testnet account*, connect the same NEAR account, click *Use this amount*, review, then sign the deposit. The CLI command shown by the card is a fallback. The new deposit appears and its status moves toward `LP CONFIRMED` once `execute_lp` runs.
8. **Record**: Solana signature, Tidepool status, NEAR tx hash, NEAR balance delta. Add them to the README proof table, and close U1–U4 (and U2) here.

If the card shows `interrupted`, do not sign again. Check the wallet history and the Tidepool status first.

## 9. Resume

```
cd C:\Users\niels\OneDrive\fintech\projet\SOL2NEAR
pnpm install
pnpm --filter @sol2near/crosschain test        # 34 mocked tests
pnpm --filter @sol2near/crosschain live:dry    # needs a network that reaches Tidepool
pnpm --filter @sol2near/web dev
node scripts/probes/verify-testnet.mjs         # NEAR side, read-only
```

## 10. Remaining risks

| Level | Risk | Mitigation |
|---|---|---|
| P1 | U2: Tidepool might not watch the ATA of the deposit address | first transfer of **1 USDC** only; check the Tidepool status reaches `KNOWN_DEPOSIT_TX` |
| P1 | Tidepool is custodial, has a single maker and no SLA, and is flagged by a corporate firewall | test tokens only, never real funds |
| P1 | Quote signature not verified (U5) | echo checks + NEAR balance check; production would use the official 1Click SDK |
| P2 | The NEAR balance check counts any incoming USDC in the window | it can only over-count a real receipt, never invent a missing one; the NEAR tx link is shown |
| P2 | Step 4 from the dashboard is built but not yet executed on-chain | `docs/G4_NEAR_WALLET.md` §5 |

## 11. Recommendations

1. Run §8 from an allowed network and record the hashes.
2. If U2 turns out wrong, change only `buildSplDepositTx`'s destination and re-run the 34 tests.
3. Later: add a NEAR wallet (wallet-selector) for step 4, and verify the 1Click signature if Tidepool publishes its key.
