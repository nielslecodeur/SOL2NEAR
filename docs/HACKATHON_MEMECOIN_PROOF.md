# SOL2NEAR — Memecoin liquidity proof (H1–H4)

Date: 2026-11-14. Solo project. Mission: *turn Solana creator capital into verifiable liquidity for NEAR memecoins.*

**Verdict: `READY WITH LIMITATIONS`** (see §8). The NEARLY journey can be demonstrated and its local execution can be
reproduced from a clean clone. No real funds are exposed. **No mainnet contribution exists**, and the public site does
not include this journey until a new deployment is approved.

## 1. The journey that is actually demonstrated

A Solana creator picks **NEARLY**, a real NEAR memecoin, and follows how their USDC would become a verifiable
concentrated-liquidity position. The journey has 8 steps: Creator Portal → *Explore · NEARLY memecoin*, in the local app
and in the read-only public build.

| Step | What the visitor sees | Evidence kind |
|---|---|---|
| 1 Connect | Phantom (local app only). The public build contains no wallet code. No wallet is needed to follow the journey | — |
| 2 Choose NEARLY | `nearly-993927.nearlytrade.near` / `wrap.near` on Rhea DCL `dclv2.ref-labs.near` v2.4.2: pool id, token code hash, launch position (Nearly locker, never touched), route, price, liquidity, pool holdings. The snapshot is labelled with its block; a live re-read is available (6 views) | **MAINNET READ** |
| 3 Amount | USDC input, range width, 90/8/2 split (the Treasury rule) | rule |
| 4 Contribution quote | USDC split between the two legs, swap outputs, minimums, amounts in the position, liquidity units, leftovers, range in prices, NEARLY-leg price impact. Shown as **RECORDED** (block 224 535 331) or **LIVE**. A failed live read shows its real error; an amount without a quote shows "no quote", never an estimate | **MAINNET REFERENCE SIMULATION** (Rhea `quote` + `predict_hotzap`) |
| 5 Conversion steps | Solana → NEAR (testnet bridge only; **no mainnet bridge**), Treasury intake, one Rhea HotZap (atomic in one DCL receipt), the guards, the read-back confirmation | design + sandbox step ids |
| 6 DCL position | Range, in or out of range now, the out-of-range risk (100 % wNEAR above, 100 % NEARLY below, no fee), the creator's rights, what is *not* theirs (launch position, APY), risks, FUEL not eligible | rule + sandbox |
| 7 Sandbox proof | Code provenance, summary, and the 58 recorded steps of the run with the arguments, result and on-chain reads of each | **LOCAL SANDBOX** |
| 8 Fees & exit | Test fees observed (not a forecast), repeated claim = 0, out of range = 0, lock, NFT exit, recovery of leftovers, what a real NEARLY contribution would still need | **LOCAL SANDBOX** + limits |

Every transactional button in this mode is a disabled "not available" button: *Execute on mainnet*, *Fund NEARLY on
mainnet*. The public build has no signing path at all (§5).

## 2. Components used (reused, no new architecture)

| Component | Role in this demo | Changed for H1–H4 |
|---|---|---|
| `contracts/treasury-dcl` (TreasuryDCL, V4.2A) | the contract that creates and holds the DCL position | **no** (41 unit tests unchanged) |
| `sandbox-tests/tests/v42_dcl.rs` | the end-to-end scenario against the real code | **recorder added** (each step logs method, contract, arguments, result and the on-chain reads that prove it). Assertions unchanged |
| `scripts/proofs/export-nearly-proof.mjs` (new) | deterministic export + `--check` against the committed one + code provenance | new |
| `scripts/proofs/nearly-proof.sh` (new) | **one command**: fetch code read-only → build → run → export check | new |
| `scripts/probes/nearly-reference-sim.mjs` (new) | read-only mainnet simulation, every view pinned to one block | new |
| `packages/near-client` `buildDclPlan`, `estimateDcl`, `assessDcl`, `rangeStatus`, `splitV4` | the planner and rules, shared by the dashboard, the probe and the journey | no |
| `apps/web/src/portal/NearlyJourney.tsx` (new), `CreatorPortal.tsx`, `v4/Dcl.tsx` | the 8-step journey. `Dcl.tsx` exports its live reader and simulation for reuse | Explore mode now = NEARLY journey |
| `vite --mode public` + `scripts/check-public-bundle.mjs` (G9.1) | read-only public build | unchanged rules, still PASS |

Treasury V3, FUEL, TreasuryV4, the deployed contracts and the tokenomics were **not modified**.

## 3. On-chain proofs V3 (level A — NEAR testnet / Solana devnet, real transactions)

Unchanged. They are listed with explorer links on the Proofs page (`#/proofs`) and in `docs/G8_PROOF_LEDGER.md`, and
re-verified without keys by `node scripts/probes/verify-testnet.mjs` and `verify-g6-g7.mjs`.
- 90/8/2 deposit (C1 `AsD2o2aV…ZWzw`), LP in Ref pool #2951 held by the Treasury (C2 `4F2wXqzm…SSHA`) with shares verified (C3).
- FUEL admission, season close, claim and a rejected second claim (C4–C7).
- Dashboard + Meteor wallet (G6).
- **Bridge** Solana devnet → Tidepool (community sandbox, not NEAR Intents) → NEAR testnet → Treasury deposit #3
  (G7-SOL `bGUicpgy…887R` → G7-NEAR `J58H2uyu…RFqf` → G7-TREAS `J7uMjikj…Bdhz`).

Pool #2951 is USDC/wNEAR, **not a memecoin**. G8 (LP of deposit #3) is **not completed**: its plan has 29.13 % impact,
and executing it was refused.

## 4. Sandbox DCL proofs (level B — LOCAL SANDBOX)

`bash scripts/proofs/nearly-proof.sh` runs a **fresh local neard sandbox from genesis** (no forked state). The export is
`packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json`, label `LOCAL SANDBOX`, 58 steps.

### Code provenance (exact bytes executed)

| Code | SHA-256 | = mainnet code hash |
|---|---|---|
| Rhea DCL (`view_code` of `dclv2.ref-labs.near`, v2.4.2) | `219169c5…a038` | `3G34Nhjm…oEGo` ✓ |
| NEARLY token (global code that `nearly-993927.nearlytrade.near` runs, Nearly raw v1) | `47d7973b…7fc9` (= Nearly README) | `5qScjXG9…eGQ` ✓ |
| wNEAR (`wrap.near`) | `b72c26d3…8ac0` | `DL2f5xmZ…Tsh1` ✓ |
| USDC stand-in (`usdc.tidepool-sandbox.testnet`) | `bc699a78…9aae` | — (local stand-in) |
| TreasuryDCL (cargo-near 0.22.0) | `66889832…7a83` | not deployed anywhere |

near-workspaces 0.24.0, neard sandbox 2.14.0. "= mainnet code hash" means base58(SHA-256(file)) equals the code hash in
the mainnet read of 2026-11-14 (`fixtures/v42_dcl_mainnet_2026-11-14.json`). The proof script re-fetches the code live
and checks it again.

### What the scenario verifies (each line is an assertion of the run, recorded in the export)

| Required check | Steps | Result in the export |
|---|---|---|
| NEARLY token identity | A0 + provenance | token deployed from NEARLY's exact code. Its local account is `rawmeme.test.near`, with local supply and price |
| DCL and pool identity | A0, B2, C2 | real DCL code; pool `<token>\|wrap\|10000`, fee 1 %, point_delta 200 = the NEARLY mainnet pool type; `setup` checks the target and route pools, decimals and `get_tax` |
| Taxed token refused | C0 | `BLOCKED_TAX` (real Nearly tax v6 code, 3 % / 4 %) |
| 90/8/2 | D1 | 20 USDC → 18 / 1.6 / 0.4 |
| Guards | E1–E4b, F4 | not creator, off-grid range, range out of price, loose slippage, DCL simulation refusal, price impact 3 300 bps > 1 000: **refused, nothing sent** |
| Position creation | F1 | one HotZap, 139 Tgas: `lpt_id …#4`, liquidity 222 745 662 302 570 594 080, range [−20 000, 20 200] |
| Real owner in the sandbox | F1 | DCL `get_liquidity.owner_id` = `nft_token.owner_id` = `treasury-dcl.test.near` |
| Treasury balances | E5, F2, F7, G5, K6, R | **books = real balances** six times (USDC / token / wNEAR wallets and the DCL internal account) |
| USDC accounting | F1 | 17 USDC used + 1 back to the reserve = the 18 USDC budget |
| Test fees | G1, G3 | unclaimed 4 489.556… (token) + 0.005364… wNEAR; the claim books **exactly** the DCL's numbers |
| Repeated claim rejected | G4 | second claim books 0 / 0 |
| Out of range | K2–K5 | narrow position, price at point 21 776 vs [−1 200, 3 000]: single asset, **0 / 0 fees** |
| Lock rules | H1, H2 | `ERR_POSITION_LOCKED`; another account → `ERR_NOT_CREATOR` |
| Authorised exit | H3 | after the lock, NFT owner = `alice.test.near` (the creator) |
| No double exit | H4, H5 | `ERR_NO_CONFIRMED_POSITION` |
| Creator removes liquidity | H6, H7 | 50 % then the rest; position deleted |
| Leftovers recovered | J1, J2 | wallet delta = booked, to the atomic unit |
| No double recovery | J3 | `ERR_NOTHING_TO_WITHDRAW` |
| Gift attack | S1 | a plain transfer moves no book and credits nobody |

**Determinism.** The export replaces block heights, timestamps and deadlines with `<sandbox-time>`. Everything else is a
function of the code and the scenario. A second, independent run (fetch → build → sandbox → export) gave a file
**identical** to the committed one, gas included.

## 5. The NEARLY pool examined

| | Value | Source |
|---|---|---|
| Pool | `nearly-993927.nearlytrade.near\|wrap.near\|10000` on `dclv2.ref-labs.near` | mainnet views |
| Token | Nearly launch #3, 18 decimals, raw v1 code (no `get_tax`, no transfer tax) | global code hash + source rebuilt byte for byte (V4.2A) |
| Price | point 50 236 → 1.519e-4 wNEAR per NEARLY | block 224 535 331 (2026-11-14 15:51 UTC) |
| Liquidity | active 5.63e22, total 2.63e23 DCL units: positions other than the launch position exist | same block |
| Launch position | `#13969`, owner `lock.nearlytrade.near`, range [200, 500 000]: the Nearly creator's fees, never SOL2NEAR's | V4.2A |
| Reference quote (100 USDC, ±20 000 points) | LP budget 90 USDC: 45.253125 → NEARLY, 44.746875 → wNEAR; outputs 91 707.95 NEARLY + 13.9284 wNEAR; **into the position 91 662.10 NEARLY + 13.9192 wNEAR**; leftovers ≈ 0.05 %; range [30 200, 70 400] = 2.05e-5 → 1.14e-3 wNEAR/NEARLY; NEARLY-leg impact **0.11 %** | `nearly-reference-sim.mjs`, every view pinned to block 224 535 331 |
| Fees | 1 % pool fee, of which Rhea keeps 20 % (`protocol_fee_rate` 2000); 0.01 % on USDC/wNEAR. No APY is computed | mainnet metadata |
| Classification | `FEASIBLE_FOR_LOCAL_DCL_TEST`: **not executable** | `assessDcl` |

A live quote in the browser (16:56 UTC) gave 91 669.82 NEARLY + 13.9203 wNEAR for the same input: the price moves, so
the recorded quote always carries its block.

## 6. Tests executed (2026-11-14)

| Check | Result |
|---|---|
| `cargo test --workspace` | Treasury V3 **34**, FUEL **31**, TreasuryV4 **47**, sandbox-meme **3**, TreasuryDCL **41**: all pass |
| `bash scripts/proofs/nearly-proof.sh` (WSL Ubuntu) | sandbox `1 passed` (≈ 65 s), PASS × 3 code = mainnet, **PASS export identical** (58 steps), twice |
| `pnpm typecheck` | OK |
| `pnpm test:ts` | near-client **64** (57 + 7 proof invariants), crosschain **36** |
| `pnpm --filter @sol2near/web test` | **48** |
| `pnpm --filter @sol2near/web e2e:offline` | **18/18**: every external request blocked; covers the public build, the NEARLY journey (recorded data, a real error for a failed live quote, 58 proof rows, 3 × "= mainnet code"), and 390 px on all 8 steps |
| live e2e, Creator Portal group | **10/10**, including a **LIVE** NEARLY quote from mainnet views and every transactional button disabled |
| full live e2e (31 tests, public endpoints, 1 retry) | **29 passed + 2 flaky** (failed once, passed on retry): the known V4.2A DCL card test and the NEARLY live quote, both after mainnet RPC rate limiting (HTTP 429) late in the run. No test failed twice |
| `pnpm check:public` | PASS: no wallet selector, no tx builder, no Phantom lookup, no SPL builder, no eval; CSP; `vercel.json` headers |
| `pnpm check:release` | all release checks passed (no key material, no personal path, fixtures tracked, no destructive script) |
| **Clean clone** of commit `b412948` (fresh `git clone`, Windows + WSL) | `pnpm install --frozen-lockfile`, typecheck, near-client 64, crosschain 36, web 48, web build, `check:release`, `check:public`, **e2e offline 18/18**; `nearly-proof.sh`: fetch + build (TreasuryDCL SHA-256 `66889832…7a83`, identical) + sandbox `1 passed` + **PASS export identical**: third independent identical run |

## 7. Verifiable results (where to look)

- `packages/near-client/src/fixtures/nearly_dcl_sandbox_proof.json`: the proof (LOCAL SANDBOX).
- `packages/near-client/src/fixtures/nearly_reference_sim.json`: the recorded mainnet quote, with block height and hash.
- `docs/v4/h1-nearly-quote.jpg`, `docs/v4/h1-nearly-sandbox-proof.jpg`: screens produced by the offline e2e.
- Creator Portal → Explore → steps 2–8; Proofs page → "The memecoin proof is a different level of evidence".

## 8. Limits (also shown in the UI)

- **Two separate levels of proof, never one transaction.** A = real testnet/devnet transactions (bridge, V3 Treasury,
  Ref pool #2951, FUEL). B = NEARLY DCL position in a LOCAL SANDBOX. No SOL2NEAR contract exists on mainnet, and no
  NEARLY position was funded.
- The sandbox runs NEARLY's **code**, not NEARLY's **state**. Its pool price, liquidity and the test trades are local, so
  the test fees say nothing about real NEARLY fees.
- The USDC in the sandbox is a local stand-in (Tidepool USDC code). The real route would use mainnet native USDC.
- TreasuryDCL is unaudited. The DCL is upgradeable by Rhea's DAO. A Treasury holds at most 40 positions. Taxed Nearly
  tokens are refused.
- FUEL does not reward DCL positions (`FUEL_NOT_ELIGIBLE`).
- G8 is incomplete. The V3 contract accounts keep a developer full-access key (documented).
- The deployed public site (`ce3dff1`) predates this journey.

## 9. What a mainnet execution would still require (none of it is done or authorised)

1. Leave the project's testnet-only rule. That is the lead's decision.
2. A mainnet USDC route from Solana (the official NEAR Intents 1Click API, not the Tidepool sandbox).
3. An external audit of TreasuryDCL, and a choice about the deployer's full-access key (locking the account).
4. Deploy TreasuryDCL on mainnet for the NEARLY pool, with guards set for real liquidity. Run `setup`: 0.5 NEAR DCL
   storage + 0.1 NEAR registration.
5. A first small contribution, with every tx hash recorded and books checked against real balances (the sandbox `R`
   check, on chain).
6. Re-measure the DCL after any Rhea upgrade (v2.4.2 today).

## 10. Repository and public demo state

| Item | State |
|---|---|
| G9 fixes `62dfc04`, `9033645`, `9b96f76`; G9.1 `3368d8a`; Vercel config `ce3dff1` | **published** on `origin/main` (checked with `git branch -r --contains`) |
| `445ec68` (Vercel deployment record) and the H1–H4 commit(s) | **local only, not pushed** |
| Public demo https://sol2near-demo.vercel.app | live, read-only, built from `ce3dff1`: **without** the NEARLY journey |
| H1–H4 public build | built and tested locally (`dist-public`, `check:public` PASS); **not deployed** |
| Clean clone of `b412948` | reproduces everything above (§6) |
