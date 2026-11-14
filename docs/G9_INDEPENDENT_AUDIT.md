# G9 — Independent audit simulation of the public release

Date: 2026-11-14 (~14:35–15:20 UTC). Public commit audited: `712ce844a20707893efdad6cc6cf54e59d1841f8` on `https://github.com/nielslecodeur/SOL2NEAR` (`main`).

This is a **simulated internal review** by the development assistant, written as an outside technical judge would read the repo. It is **not** an official jury score and **not** an independent smart-contract security audit. No transaction was signed or sent; nothing was deployed or pushed.

**Verdict: `READY WITH DOCUMENTED LIMITATIONS`.**
- No blocking issue remains once the local corrections of §8 are pushed.
- One real reproducibility blocker (sandbox step) and two accuracy issues (admin key, "why NEAR") were found and fixed **locally**.

## 1. Initial state

| Check | Result |
|---|---|
| Branch / commits | `main`; local = remote = `712ce84`; no divergence; working tree clean before the audit |
| Public access | GitHub API: `visibility: public`, `private: false`, default branch `main`, pushed 2026-11-14T14:31Z |
| Secrets | `pnpm check:release`: no key material (the only `ed25519:` hits are public signatures recorded from public transactions), no `.env` / keypair / pem, no wasm, no build directory |
| Required files | README, G2–G8 reports, V4.0–V4.3A docs, contracts, probes and fixtures present at `712ce84` (raw.githubusercontent 200) |

## 2. Phase A — a first-time reviewer with only the public repo

| # | Can the reviewer… | Assessment |
|---|---|---|
| 1 | understand the concept in < 2 min | **yes**: README tagline + "What it is" (4 steps) + the status section by evidence kind |
| 2 | understand why NEAR | **was no**: nothing explained it. **Fixed locally**: a short "Why NEAR" section, limited to what the code really uses (cross-contract proof reads, the 1Click-compatible route, Ref/Rhea/Nearly markets) |
| 3 | identify what is executable | **yes**: status §1–§2 (testnet tx, bridge) with hashes |
| 4 | identify what is experimental | **yes**: §3 sandbox, §4 mainnet read-only, §5 not available |
| 5 | install | **yes**: `pnpm install --frozen-lockfile` in 6.8 s. Node ≥ 22.18 is stated (Node 20 would fail on `.ts` tests) |
| 6 | run the tests | **yes**: from a fresh public clone, all suites green (§6) |
| 7 | open the Creator Portal | **locally only**: `pnpm --filter @sol2near/web dev` → `#/`. **`NO PUBLIC FRONTEND CONFIRMED`** |
| 8 | examine on-chain proofs | **yes with a caveat**: NearBlocks answers bots with a Cloudflare challenge (HTTP 403, also in headless Chrome); a human browser passes. The read-only scripts (`verify-testnet.mjs`, `verify-g6-g7.mjs`, `g8-audit.mjs`) verify everything through RPC. The Solana explorer renders "Success" in Chrome |
| 9 | understand the original contribution | **mostly**: the Treasury rules, Proof of Liquidity and FUEL are clear. The memecoin part is clearly marked as sandbox |
| 10 | reproduce the important results without funds | **yes**: tests, sandbox runs on real contract wasm (after the §8 fix), read-only proofs. No key needed |

## 3. Phase B — public application

**`NO PUBLIC FRONTEND CONFIRMED`.**
- There is no hosting configuration (Vercel, Netlify, Pages), no `homepage` on the GitHub repo, and no URL in the docs.
- The hackathon checklist itself lists a hosted demo as optional.

The frontend was tested **locally** only:
- deterministic `e2e:offline` 12/12 in real Chrome from the public clone;
- the live smoke projects of earlier checkpoints;
- the landing test re-run after the §8 text fix.

Nothing was deployed.

## 4. Phase C — claims vs code and proofs

| Claim | Verdict | Evidence |
|---|---|---|
| Solana devnet → Tidepool → NEAR testnet | **proven once**, with each stage separated | quote (Tidepool record, correlationId `d0112628…`); source tx `bGUicpgy…887R` (`transferChecked` 2 000 000, finalized); settlement `J58H2uyu…RFqf` (1 994 800 to `lowarena9362.testnet`); receipt on NEAR (balance 86 → 87.9948); Treasury deposit `J7uMjikj…Bdhz`. The Tidepool intent hashes equal the on-chain `intent_hash` events |
| 90/8/2 | **proven** | code (`ledger::split`, unit tests) + events C1, G6-D, G6-D2, G7-TREAS |
| LP held by the Treasury on Ref #2951 | **proven** | C2, G6-LP, G6-LP2; Ref `get_pool_shares(Treasury)` = recorded shares (`verify-testnet.mjs` PASS) |
| FUEL rewards and eligibility | **proven on testnet**, with eligibility rules visible | C4–C7, G6-REG2/CLOSE/CLAIM, and a rejected late registration (G6-REJ). Only V3 / pool 2951 positions are eligible (code) |
| "Rules fixed at deployment, nobody holds an admin key" | **inaccurate as written** — **fixed locally** | the contracts have no admin method and no setter, but `view_access_key_list` shows a **full-access key** on `treasury.sol2near-dev.testnet` and `fuel.sol2near-dev.testnet`: the developer could redeploy. README and portal text now say so |
| G8 | **not completed**, stated correctly | deposit #3 `BudgetAllocated`, 79.195320 USDC, `lp_shares` 0, no job; its LP plan (29.13 % impact) **was not authorised**. Status `READY FOR USER SIGNATURE — NOT COMPLETED` |
| V4 memecoin catalogue | **read-only, live** | registry + live checks; mainnet entries never executable |
| TreasuryV4 Classic + S2NMEME | **local sandbox only** (real Ref + Tidepool USDC wasm) | 47 unit + sandbox 1/1 (re-run from the public clone); not deployed (`UNKNOWN_ACCOUNT` on testnet) |
| Rhea DCL adapter: positions, fees, exit, reconciliation | **local sandbox only** (real Rhea DCL v2.4.2 + Nearly wasm) | 41 unit + sandbox 1/1 incl. S1 (re-run from the public clone); not deployed |
| NEARLY / NEARKAT | **mainnet reads only** | no mainnet transaction exists |
| FUEL V4 | `FUEL_NOT_ELIGIBLE` | FUEL config is fixed to V3 / 2951 |

No simulation or mainnet read is presented as an execution in the README after the §8 fixes.

## 5. Phase D — value proposition

- **Problem addressed:** a Solana creator who wants to put capital into NEAR liquidity faces four things: a bridge, a second wallet, DEX mechanics, and no verifiable record of who owns the LP. SOL2NEAR bundles a programmable treasury (90/8/2), DEX execution and on-chain Proof of Liquidity behind one guided journey.
- **Cross-chain integration:** real but thin. One devnet transfer through a community sandbox; production would need the official 1Click API on mainnet.
- **Originality:**
  - the Treasury that verifies its own LP from the DEX;
  - FUEL, rewards gated by DEX-confirmed LP and a seasonal reactor instead of price action;
  - the honest evidence ledger.
- **vs RHEA:** SOL2NEAR does not replace the DEX. It adds the funding route, the split, custody bookkeeping and a proof trail.
- **vs Nearly:** it adds third-party liquidity to existing launches without touching the launch position or its creator fees. This is **not** demonstrated on mainnet.
- **vs cross-chain routers (LI.FI, 1Click Earn):** the added value is curation, LP ownership records and memecoin-specific guards, not routing itself.
- **Gap between vision and MVP:**
  - the vision is "fund NEAR memecoin liquidity from Solana";
  - the operational MVP funds a **USDC/wNEAR test pool** on testnet;
  - memecoin funding is proven only in a local sandbox;
  - creator fees are not captured automatically;
  - no yield is promised.
- **Phantom path:** Phantom signs only the Solana leg. A NEAR wallet and account are required.

## 6. Phase E — security and evidence (not a production audit)

| Area | Finding |
|---|---|
| Custody | funds and LP held by contracts with no admin method. **But the contract accounts keep full-access keys** (redeployable by the developer) — the main trust assumption, now disclosed |
| Authorisation | creator-only `execute_lp` and withdrawals; `#[private]` callbacks (V3, V4, DCL) |
| LP ownership | Classic: Ref `get_pool_shares` = recorded. DCL: `get_liquidity.owner_id` checked at confirmation and exit |
| Locks / exits | 600 s lock enforced in code. **V3 has no exercised exit and no `abort`**: an LP budget can only become LP (deposit #3 is stuck by design until an LP is accepted) |
| Async callbacks | one job at a time, persisted stages, stage-checked callbacks, `reconcile` with timeout |
| Reconciliation bugs fixed | **V4.1B**: a lost leftover callback could block TreasuryV4 forever → regression tests `lost_leftover_callback_is_reconciled_from_ref_balances`, `leftover_reconcile_when_ref_did_not_move…`, `leftover_reconcile_waits_for_the_timeout`. **V4.2A**: the zap reconcile trusted an inflatable USDC balance → `reconcile_lost_zap_decided_by_the_dcl_not_by_the_usdc_balance` + sandbox S1 (a gift moves no book). Both exist and pass |
| Double spend | replayed callbacks ignored; `lpt_index`; second claim / second exit refused (sandbox) |
| Fake balances | S1 on real code: an inflated balance is unattributed, never credited |
| Atomic precision | u128 atomic units everywhere; 90/8/2 conserves the total (unit) |
| Slippage | V4 / DCL: on-chain bounds against fresh DEX views. **V3: only "> 0" checks on `min_swap_out` / `min_amounts`** — only the creator can call, so a loose plan can only hurt the creator; the dashboard computes 1 % |
| Testnet / mainnet | V4 contracts refuse non-testnet accounts at init; mainnet reads use a separate read-only client; no signing path to mainnet |
| Taxed tokens | refused on-chain (DCL `setup`); measured −4 % / −3 % on the real tax token |
| Ambiguous states | documented receipt by receipt (V4.2A §3.1). A failed read concludes nothing (fixed in G8) |
| Public RPC dependence | live smoke tests and the dashboard depend on providers without SLA; offline tests isolate it |

## 7. Phase G — UX for a Solana creator new to NEAR

| Question | Answer |
|---|---|
| A NEAR wallet is needed? | yes, step 1 says why ("two chains, two keys") |
| How Tidepool works? | yes, the route strip and labels; marked community sandbox |
| Bridge vs liquidity? | yes, separate steps and signatures (step 4 lists five) |
| 90/8/2? | yes, hero + simulator rows 4–5 |
| LP fees? | yes: "variable, can be zero", Classic fees inside the shares, DCL fees separate |
| Loss risks? | yes (hero, simulator row 14, DCL out-of-range text) |
| Lock? | yes, 600 s shown on positions |
| Available vs not? | yes, the evidence-tagged status table |
| Follow funds after an interruption? | yes: bridge card resumes; positions are read from chain |
| Who holds the LP? | yes: "Held on-chain by" vs "Economic owner" on each position |

**Top three remaining frictions:**
1. Two wallets, a NEAR account with testnet NEAR, and five or six approvals.
2. The only executable pool is a shallow test USDC/wNEAR pool: any deposit above ~20 USDC hits the 20 % impact guard. The simulator warns before depositing, but V3 cannot refund a budget once it is deposited.
3. No hosted demo: a reviewer must run the app locally.

## 8. Phase H — local corrections (not pushed)

| Correction | Why it was blocking | Files |
|---|---|---|
| The wasm fetch scripts now create `sandbox-tests/res/` | README step 9 failed with `ENOENT` in any fresh clone (the folder is git-ignored). Found by running the sandbox from the public clone; it passes after the fix (both runs 1/1, S1 included) | `scripts/probes/fetch-sandbox-wasm.mjs`, `scripts/probes/fetch-dcl-wasm.mjs` |
| The admin-key claim corrected | it overstated immutability: the contract accounts keep full-access keys | `README.md` (intro + risks), `apps/web/src/portal/CreatorPortal.tsx` (hero text), `docs/FINAL_RELEASE_AUDIT.md` (diagram) |
| V3 budget lock-in stated | a reviewer could not tell that a deposited LP budget cannot be refunded | `README.md` (risks) |
| "Why NEAR" section | a missing explanation of the project's core choice | `README.md` |
| G9 docs | deliverables | this file, `G9_PUBLIC_REVIEW_CHECKLIST.md` |

No contract, economic parameter or deployed state was changed.

## 9. Phase F — external reproducibility (fresh clone of the **public** repo)

| Step | Result |
|---|---|
| `git clone https://github.com/nielslecodeur/SOL2NEAR` | HEAD `712ce844…` |
| Toolchain | node 24.12.0, pnpm 10.34.9, rustc 1.98.0 |
| `pnpm install --frozen-lockfile` | done in 6.8 s |
| `pnpm typecheck` | 4 packages Done |
| `pnpm test:ts` / web test | near-client 57, crosschain 36, web 48 — 0 fail |
| web build, `pnpm check:release` | OK, all passed |
| `e2e:offline` (real Chrome, no network) | **12 passed** |
| `cargo test --workspace` (fresh target dir) | 34 / 31 / 47 / 3 / 41 — all pass |
| `verify-testnet.mjs`, `verify-g6-g7.mjs` | all checks passed; all G6/G7 proofs re-verified |
| `build-wasm.sh treasury-v4 sandbox-meme treasury-dcl` (WSL) | SHA-256 `66479af1…00ed`, `7265aa4e…283c`, `66889832…7a83` = the documented values |
| Sandbox step 9 | **FAILED as published** (`ENOENT sandbox-tests/res/…`) → **fixed** (§8) → `v4_pilot` 1/1, `v42_dcl` 1/1 |

## 10. Scores (simulated, out of 10)

| Area | Score | Justification |
|---|---|---|
| Technical | **7.5** | real deployed contracts with 20+ re-verified tx; 156 Rust + 141 TS unit tests; sandbox runs on real third-party wasm; careful async design. Minus: the product's memecoin goal runs only in a sandbox, and G8 is incomplete |
| Security | **6.0** | good callback / reconcile discipline, regression tests for both reconcile bugs, gift-proof accounting, taxed tokens refused. Minus: unaudited; **full-access keys on the deployed contract accounts**; no V3 exit or refund; V3 plan guards minimal; reliance on a community bridge sandbox |
| Architecture | **7.5** | clean split (crosschain / near-client / contracts / web); isolated contract versions; on-chain proofs instead of a backend. Minus: three Treasury generations to understand; FUEL hard-wired to one pool |
| UX | **6.5** | guided portal; every fact labelled by evidence kind; honest blocking reasons. Minus: two wallets, many approvals, the executable pool is not a memecoin, no hosted demo |
| Originality | **7.0** | a creator-focused cross-chain LP router with on-chain Proof of Liquidity and LP-gated FUEL is a fresh combination. The building blocks (bridge, DEX, zap) are existing ones |
| Reproducibility | **8.0** | a fresh public clone passes everything without keys; offline deterministic e2e; fetched and hash-checked wasm. Minus: the sandbox step was broken until §8; WSL and Windows path caveats; the live tests depend on public RPC |
| Evidence quality | **8.5** | every claim tagged; tx re-verified by scripts; cross-chain correlation via on-chain intent hashes; G8 left honestly incomplete. Minus: NearBlocks blocks bots; one bridge sample; mixed funds in deposit #3 |
| **Overall** | **7.0** | a credible, honestly documented testnet MVP of the treasury / proof / reward mechanics, with a well-prepared but not yet live memecoin layer |

## 11. Final verdict

**`READY WITH DOCUMENTED LIMITATIONS`.**

**Strengths:**
1. On-chain Proof of Liquidity verified by contracts (Treasury ↔ Ref ↔ FUEL), with 20+ public transactions re-verifiable by scripts.
2. Rigorous evidence discipline: testnet / bridge / sandbox / mock / simulation never mixed; G8 left incomplete instead of forced.
3. Reproducible from a fresh public clone, including sandbox runs on the real Rhea DCL and Nearly contract code.

**Weaknesses:**
1. Memecoin funding, the core mission, exists only in a local sandbox; the live pool is a USDC/wNEAR test pool.
2. Custody trust: the deployed contract accounts keep full-access keys; there is no V3 exit or refund; contracts unaudited.
3. Heavy onboarding (two wallets, many approvals) and no hosted demo.

**Blocking issues:** none **after** pushing the local corrections. Until then, README step 9 fails in a fresh clone, and the README overstates immutability.

**Local corrections:** see §8. Separate local commits, **not pushed**.

**Git:** `origin/main` = `712ce84`; local `main` ahead by the G9 correction commits (see `git log origin/main..HEAD`). Nothing pushed.

**Public app:** `NO PUBLIC FRONTEND CONFIRMED`.

**Priority recommendations before a submission:**
1. Approve the push of the G9 commits (the sandbox step and the README accuracy).
2. Decide on the full-access keys of the two contract accounts. Either keep them and the disclosure, or delete them to lock the contracts (an irreversible transaction that needs your approval). Do not claim immutability until then.
3. Optionally host the static dashboard (read-only; deploying needs your approval) so reviewers can open the portal without installing anything.
4. Keep G8 as `READY FOR USER SIGNATURE — NOT COMPLETED`.
