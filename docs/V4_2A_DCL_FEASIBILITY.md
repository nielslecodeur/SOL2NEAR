# V4.2A — Rhea DCL / Nearly: feasibility of funding real memecoin liquidity

Date: 2026-11-14. Solo project. Builds on V4.0 (`V4_0_EXECUTION.md`), V4.1 (`V4_1_ARCHITECTURE.md`) and V4.1B (`V4_1B_EXECUTION.md`). Results and evidence of the code: [`V4_2A_EXECUTION.md`](archive/V4_2A_EXECUTION.md).

**Verdict: `READY WITH LIMITATIONS`** (details in §11).

| | |
|---|---|
| **GO** | An **additional DCL position**, separate from the Nearly launch position, can be created, held by a Treasury contract, read back on-chain, made to earn and claim its own fees, and handed to the creator after a lock. All of this ran against the **real Rhea DCL v2.4.2 code** and the **real Nearly token code**, in a local sandbox. |
| **BLOCKED** | Funding a **real** Nearly pool from SOL2NEAR. The pools are on mainnet, SOL2NEAR is testnet-only (Tidepool USDC), and no testnet DCL pool holds a Tidepool token. |
| **BLOCKED_TAX** | Every Nearly **tax** token. The tax applies to every transfer into and out of the DCL: LP deposit, withdrawal and fee collection. |

Nothing was signed, sent or deployed. Every mainnet and testnet fact comes from public `view` calls, reproducible with `node scripts/probes/v42-dcl-audit.mjs`.

## 1. Method: what was verified, and how

The Rhea DCL **source is not public**:
- the `ref-finance` GitHub organisation has no DCL repository (checked 2026-11-14);
- `rhea-sdk` and `ref-sdk` only cover swaps and limit orders.

So nothing below is taken from documentation alone.

| Evidence | How | Reproduce |
|---|---|---|
| Deployed code | `view_code` / `view_global_contract_code`, SHA-256 | `node scripts/probes/fetch-dcl-wasm.mjs` |
| Interfaces (method list) | wasm export section of the deployed bytes | same wasm, `WebAssembly.Module.exports` |
| Argument names, return values, errors | the **real wasm** executed in a local neard sandbox. Argument names were read from its own deserialisation errors | `sandbox-tests/tests/v42_dcl_probe.rs`, `v42_dcl_probe_hotzap.rs`, `v42_dcl_explore.rs` → `docs/v4/v42-dcl-explore.log` |
| Nearly rules | source at the deployed commit (`contract_source_metadata` of `nearlytrade.near` → github.com/sam3dsol/Nearlytrade `e82bfa0`). The token generations rebuild **byte for byte** to the global code hashes | `fetch-dcl-wasm.mjs` prints `= Nearly README` for raw v1 and tax v6 |
| Live pool state | mainnet / testnet view calls | `node scripts/probes/v42-dcl-audit.mjs` → `packages/near-client/src/fixtures/v42_dcl_mainnet_2026-11-14.json` |

## 2. Contracts

| Contract | Network | Code | Version / state | Admin |
|---|---|---|---|---|
| `dclv2.ref-labs.near` (Rhea DCL) | mainnet | `3G34Nhjm…oEGo`, SHA-256 `219169c5…a038`, 1 166 649 B | `get_metadata`: v2.4.2, `Running`, `protocol_fee_rate` 2000 (20 % of swap fees to the protocol), 6 657 pools | 0 access keys. Owner `ref-finance.sputnik-dao.near`, 2 operators. **Upgradeable** (`upgrade` method) through the DAO |
| `dclv2.ref-dev.testnet` | testnet | `CCzPD7sT…gEinA` | v2.3.14, 11 708 pools | 1 full-access key |
| `nearlytrade.near` (Nearly factory) | mainnet | `9mwfrbtB…o4G5` (= Nearly README) | 3 787 launches | owner `nearlytrade.sputnik-dao.near` (3 of 4 council). 2 function-call keys (fee/tax cranks) |
| `wrap.near` | mainnet | `DL2f5xmZ…Tsh1` | — | 0 keys |
| `17208628…133a1` (native USDC) | mainnet | `DVJx7F3d…NX8q` | — | 1 full-access key (issuer) |

**Testnet differs from mainnet.** v2.3.14 lacks 27 methods of v2.4.2, among them:
- `register_tokens`, `create_pool_with_tax`, `set_pool_tax`;
- the token whitelist, the blacklist and the lost-and-found methods.

So the testnet DCL is **not** a faithful copy of the mainnet DCL. The local sandbox therefore ran the **mainnet** wasm.

## 3. A.1 — How a DCL position works (measured on the real v2.4.2 wasm)

| Question | Answer | Evidence |
|---|---|---|
| Storage | `storage_deposit` ≥ **0.5 NEAR** (`storage_balance_bounds.min`). It covers 0.1 NEAR of assets and **40 slots** at 0.01 NEAR; one position uses one slot | explore B1, `get_user_storage_detail` |
| Token registration (v2.4.2) | each user must call `register_tokens` with paid storage (1 yocto → `E104 insufficient deposit`). **Without it, every deposit is silently refunded** | explore run 1 vs run 2 |
| Deposit | `ft_transfer_call(dcl, amount, "\"Deposit\"")` credits the **sender's** internal DCL balance (`list_user_assets`) | explore D1 |
| Creation | `add_liquidity(pool_id, left_point, right_point, amount_x, amount_y, min_amount_x, min_amount_y)` from the internal balance. **Returns the `lpt_id`** `"<pool>#<n>"` (a global sequence). Event `add_liquidity` with `paid_token_x/y`. The unused part stays in the internal balance | explore D2, F1 |
| Creation with one call (several receipts, see §3.1) | `ft_transfer_call` with `{"HotZap":{"swap_infos":[…],"add_liquidity_infos":[…]}}`: swaps along given pool paths, then add. Swaps and add run **inside one DCL receipt**, so either all of them apply or none does (a refused zap returns `used = 0` and the token refunds everything). It does **not** return the `lpt_id`: it is read back with `list_liquidities` (as Nearly's locker does) | explore E4/E5, sandbox F1 |
| Simulation | `predict_hotzap(token_in, amount_in, swap_infos, add_liquidity_infos)` → `[[{need_x, need_y, liquidity_amount}], {token: left}]`. **out = left + need.** It simulates the swaps **in sequence** (independent `quote`s overestimate a second leg that shares a pool: −1.3 % measured). It panics where the zap would fail | probe_hotzap, sandbox E4b |
| Owner | the predecessor of `add_liquidity` / the zap sender. `get_liquidity(lpt_id).owner_id`. A **contract** can own positions (TreasuryDCL in the sandbox, `lock*.nearlytrade.near` on mainnet) | sandbox F1 |
| Standard | full **NEP-171**: `nft_token`, `nft_transfer` (exactly 1 yocto), `nft_transfer_call`, approvals, `nft_tokens_for_owner`, metadata "REF DCL LIQUIDITY NFT" / RDL. After a transfer, the old owner gets `E215: not liquidity owner` | explore I0–I2, sandbox H3 |
| Range | points with price = 1.0001^point (atomic units). Both bounds must be multiples of the pool's `point_delta` (`E200 invalid endpoint`), `left < right` (`E202 illegal point`), within ±800 000. Fee tier 1 % → `point_delta` 200 | explore F2/F3 |
| Range vs price | above the price: X only; below: Y only. When the price leaves the range the position is entirely one asset and **earns no fee** (measured: 0 / 0 while trades continued) | explore F6, sandbox K3–K5 |
| Add more | `append_liquidity(lpt_id, amount_x, amount_y, min_x, min_y)` (not used in V4.2A) | export list |
| Withdraw | `remove_liquidity(lpt_id, amount, min_x, min_y, skip_refund_transfer?)`: partial or total. A full removal deletes the position (`get_liquidity` → null). With `skip_refund_transfer = true` the assets stay in the DCL account; `withdraw_asset(token_id, amount?, skip_unwrap_near?)` then transfers them (**no attached deposit**, returns `true`) | explore I3–I6, sandbox H6–H7 |
| Slippage | `min_amount_*` not met → `E204: slippage error` (whole call reverts) | explore F7 |
| Amounts held | `get_liquidity_view(lpt_id)` → `token_x`, `token_y`, `fee_x`, `fee_y`; `predict_remove_liquidity(lpt_id, amount)` | explore F1 |
| Fees | `get_liquidity.unclaimed_fee_x/y`. **Claim = `remove_liquidity(lpt_id, "0", "0", "0", skip_refund_transfer)`**: it returns `[fee_x, fee_y]` and credits them to the owner's DCL account. A second claim returns `[0, 0]` | explore H1/H2, sandbox G3/G4 |
| Errors / callbacks | panics with `E…` codes (≈ 80 codes in the wasm strings). Promise results: `add_liquidity` → `String`, `remove_liquidity` → `[U128, U128]`, `withdraw_asset` → `bool`, `ft_transfer_call` → used amount | sandbox logs |
| Views quirks | `list_liquidities(account_id, from_index: u64, limit: u64)`: raw JSON numbers, `"0"` is refused. Multi-hop `quote` needs more than 5 Tgas | sandbox runs 6–9 |

### 3.1 What "atomic" means for the HotZap (corrected in V4.3A)

The V4.2A text called the HotZap "atomic" without saying at which level. Precisely:

| Receipt | Contract | What is committed when it ends |
|---|---|---|
| R1 `execute_dcl_lp` | TreasuryDCL | plan stored, status `PreflightPending`, job lock taken. Nothing has moved |
| R2 views (`get_pool`, `predict_hotzap`, 2 `quote`s) | DCL | nothing (views) |
| R3 `on_preflight` | TreasuryDCL | guards passed → status `ZapPending{sent}`, `pending_budget_total -= sent`, `zap_outstanding += sent`. Guards failed → back to `BudgetAllocated`, nothing sent |
| R4 `ft_transfer_call` | USDC token | USDC moved Treasury → DCL (NEP-141 first half) |
| R5 `ft_on_transfer` (the HotZap) | DCL | **all swaps + the add_liquidity, or nothing**: they run in this single receipt, so a failing step (slippage E204, range, storage) reverts every one of them. Leftovers stay in Treasury's DCL account |
| R6 `ft_resolve_transfer` | USDC token | refund of what R5 did not use (everything if R5 failed) back to Treasury |
| R7 `on_zap` → `list_liquidities` → `on_lookup` → views → `on_confirm` | TreasuryDCL / DCL | the position is recorded only after it is read back from the DCL |

So **atomicity holds only inside R5**. The flow as a whole is asynchronous:
- the price can move between R2 and R5: bounded by the plan's min outs and minimum amounts, or R5 reverts;
- R4 and R5 can succeed while R7 is lost (gas): the position exists but is not recorded → `reconcile` finds it on the DCL;
- R5 can fail with R6 refunding while R7 is lost → `reconcile` finds no position → refunded;
- leftovers are not returned by the zap: recovering them is a separate, later job (`withdraw_dex_balance`).

`reconcile` assumes the observed behaviour "a successful zap uses the whole amount". If a future DCL version returned a partial refund in R6 while R7 is lost, the refunded part would sit in Treasury's USDC balance **unattributed**: credited to nobody, never re-spent. That is the safe direction; it would need manual attribution. An inflated USDC balance is never read as proof of anything (sandbox step S1).

**A DCL position is not a Classic LP share.**
- **Classic:** fungible shares; fees are inside the share value; no range.
- **DCL:** an NFT with a range; fees are a separate, claimable balance; out of range, it earns nothing.

TreasuryDCL therefore uses its own proof model (`lpt_id`, range, liquidity units, `position_x/y`, fees claimed per asset), and **never reuses `lp_shares`**.

## 4. A.2 — Nearly

Source: `SPEC.md` and `contracts/*` of the Nearly repository at the deployed commit, plus mainnet reads.

| Rule | Fact |
|---|---|
| Pool creation | Each launch creates `<token>|wrap.near|10000` (or an FT quote) on `dclv2.ref-labs.near`. **1 % tier only** (`set_config` validation). The launch fails if someone pre-created the pool at another price |
| Launch position | The **whole supply on one side**, range `[200, 500000]` (seen on all 3 pools), sent by a HotZap from a **locker** contract (`lock`, `lock2`, … `lock_8.nearlytrade.near`, 0 access keys). The locker **cannot remove the liquidity**; it can only claim that position's fees (`remove_liquidity` with amount 0) |
| Locker fees | `claim_fees(id)` on the factory: the locker claims **its own `lpt_id`** and splits the fees: 60 creator / 20 protocol / 10 referral pot / 10 holders pot for new launches. These are the **Nearly creator's** revenue |
| Third-party positions | Nothing in the DCL or in Nearly prevents them: the pool's `whitelist` is `null`. **On NEARLY, ~80 % of `total_liquidity` (2.63e23) is outside the launch position** (5.05e22), so other independent positions exist. On NEARKAT and DRAGON, total = launch position only |
| Fee separation | The DCL keeps fees **per position**. A SOL2NEAR position (its own `lpt_id`, owner TreasuryDCL) earns only its share of swaps inside its own range. It can never claim the locker's position (`E215: not liquidity owner`, measured), and the locker can never claim ours. **Revenue of the Nearly creator ≠ revenue of the SOL2NEAR position.** Pool-wide counters (`total_fee_*_charged`) describe the pool, not our position |
| Protocol share | `protocol_fee_rate` 2000 on mainnet: 20 % of every swap fee goes to Rhea, so 80 % goes to positions in range |
| Restrictions | The DCL has a blacklist and frozen tokens (both empty on 2026-11-14) and pausable pools. Tax tokens may set `max_wallet_bps` during a launch window. The DCL is upgradeable by its DAO: re-measure after any upgrade (Nearly's SPEC says the same) |

### A.3 — Taxes

Nearly tax tokens (`contracts/token-tax`, fixed at `new`): `buy_bps` / `sell_bps` ≤ 400, `pairs = [DCL]`, `exempt = [locker…]`.

The rule in `tax_for` (source):
- a transfer **out of** a pair to a non-exempt receiver is a **buy**, taxed `buy_bps`;
- a transfer **into** a pair from a non-exempt sender is a **sell**, taxed `sell_bps`;
- a wallet-to-wallet transfer is never taxed.

`get_tax` returns `{tax:{buy_bps, sell_bps, pairs, admin, exempt}, pending}`. Raw tokens have **no `get_tax`** (MethodNotFound).

Measured on the real tax v6 wasm (buy 3 % / sell 4 %), with a non-exempt LP:

| Operation | Effect |
|---|---|
| LP deposit `ft_transfer_call(dcl, 10 000)` | the DCL credits **9 600** (sell tax at deposit) |
| `withdraw_asset` of 9 424.675 | **9 141.94** arrive (buy tax at withdrawal) |
| fee collection | fees are paid in the token from the DCL account → **buy tax on withdrawal** |
| entry by HotZap | the token never leaves the DCL until exit, so no buy tax at entry. **Every exit is still taxed**, and the treasury would have to account net amounts per transfer |

**Decision:**
- any token with a readable tax > 0, or whose code is not a known untaxed generation → **`BLOCKED_TAX`**. This is enforced on-chain in `setup` (proven against the real tax v6 wasm: `setup_failed … BLOCKED_TAX`) and in the client;
- a DCL **pool-level** tax (`create_pool_with_tax`) is also refused.

## 5. Phase B — Pools examined (mainnet, read 2026-11-14)

Selection:
- NEARLY first;
- then, among the 3 076 Nearly/wNEAR pools ranked by wNEAR held: the deepest **untaxed** launch (NEARKAT) and the deepest **taxed** launch (DRAGON).

| | **NEARLY** | **NEARKAT** | **DRAGON** |
|---|---|---|---|
| 1 Pool id | `nearly-993927.nearlytrade.near\|wrap.near\|10000` | `nearkat-630f25.nearlytrade.near\|wrap.near\|10000` | `dragon-3.nearlytrade.near\|wrap.near\|10000` |
| 2 DEX | `dclv2.ref-labs.near` v2.4.2 | same | same |
| 3 Memecoin | `nearly-993927.nearlytrade.near` | `nearkat-630f25.nearlytrade.near` | `dragon-3.nearlytrade.near` |
| 4 Second asset | `wrap.near` | `wrap.near` | `wrap.near` |
| 5 Decimals | 18 / 24 | 18 / 24 | 18 / 24 |
| 6 Fee tier | 1 % (point_delta 200) | 1 % | 1 % |
| 7 Current point | 50 286 → 1.527e-4 wNEAR per NEARLY | 15 163 → 4.555e-6 | 14 189 → 4.132e-6 |
| 8 Liquidity | active 5.63e22; total 2.63e23 (**other positions exist**) | active = total = launch position only | active = total = launch position only |
| 9 Volume data | cumulative counters only (`volume_*`, `total_fee_*_charged`). **No period volume** from the contract: not used as a yield figure | same | same |
| 10 Token tax | **raw v1, no `get_tax`** (code `5qScjXG9…`, byte-checked source) | raw v1, none | **tax v2: buy 1 % / sell 1 %**, pairs `[dclv2.ref-labs.near]` |
| 11 Storage | 0.5 NEAR DCL + 0.1 NEAR registration + 0.00125 NEAR per token | same | same |
| 12 Route from USDC | native USDC → wNEAR via `…\|wrap.near\|100` (deepest USDC/wNEAR DCL pool) → NEARLY. 100 USDC quotes 194 218 NEARLY, **impact 0.22 %** (1 000 USDC: 2.2 %) | same route; 100 USDC impact **1.36 %** (1 000 USDC: 12 %) | same route; 1.42 % |
| 13 Additional position | yes (DCL rule, plus observed on this pool) | yes (DCL rule) | possible but taxed |
| 14 Fee claim | `remove_liquidity(0)` on our own `lpt_id` | same | taxed at withdrawal |
| 15 Withdrawal | `remove_liquidity` + `withdraw_asset`, or NFT transfer | same | taxed |
| 16 Risks | memecoin price; one-sided launch position dominating the curve above the price; DCL upgradeable by its DAO | thin: only the launch liquidity, impact grows fast with size | tax on every LP transfer, admin = factory |
| **Classification** | **`FEASIBLE_FOR_LOCAL_DCL_TEST`** | **`FEASIBLE_FOR_LOCAL_DCL_TEST`** | **`BLOCKED_TAX`** |

None of them is executable in the dashboard: they are mainnet, observe only by construction (`executable: false` in `assessDcl`). The local sandbox reproduces the NEARLY situation with the **same token code** (raw v1), the **same DCL code** (v2.4.2) and the **same pool type** (`|wrap|10000`, point_delta 200), with local state.

## 6. Comparison Classic (V4.1) / DCL (V4.2A)

| | Ref Classic (TreasuryV4) | Rhea DCL (TreasuryDCL) |
|---|---|---|
| Position | fungible shares (`get_pool_shares`) | NEP-171 NFT `lpt_id` with a range |
| Price exposure | whole curve | only inside `[left, right]`; one-sided outside |
| Fees | inside the share value, inseparable from price moves | separate, claimable per position (`remove_liquidity(0)`), exact amounts |
| Entry | Ref deposit → swap → add (3 calls) | one USDC `ft_transfer_call` with HotZap (2 swaps + add inside one DCL receipt; the whole flow is still asynchronous, §3.1) |
| Position id | none (shares) | read back with `list_liquidities` (HotZap does not return it) |
| Exit | `mft_transfer` of shares | `nft_transfer` of the position |
| Storage | 0.1 NEAR on Ref | 0.5 NEAR + 0.1 NEAR registration; 40 slots |
| Real memecoin today | no testnet route | real Nearly pools exist, but on mainnet only |

## 7. Phase E — Acquiring the two assets

| | Mainnet (real Nearly) | Testnet (SOL2NEAR funds) |
|---|---|---|
| USDC | native `17208628…133a1` (Circle) | `usdc.tidepool-sandbox.testnet`: a **different token on another network**. Tidepool is a community sandbox, not NEAR Intents |
| USDC → wNEAR | DCL `…\|wrap.near\|100`: liquidity 3.8e16, 162k USDC / 112.7k wNEAR | **no DCL pool holds a Tidepool token** (0 of 11 708) |
| wNEAR → memecoin | the Nearly pool itself (2nd hop of `route_x`) | testnet DCL has 26 "nearly"-named pools, none of them a Nearly launch; meme-cooking pools have 0 liquidity |
| Multi-hop | `route_x = [usdc\|wrap\|100, meme\|wrap\|10000]`, `route_y = [usdc\|wrap\|100]` inside one HotZap | — |
| Slippage | per leg `min_output_amount` (plan) + on-chain check against `predict_hotzap` | — |
| Atomic units | USDC 6, memecoin 18, wNEAR 24 | same decimals in the sandbox |
| Taxes | raw tokens: none | — |

**Never routed:** testnet funds to mainnet routes. The mainnet quotes and `predict_hotzap` in the dashboard are **reference simulations** (view calls), labelled not executable.

**Not proven:** a funded route on any public network. It is proven only in the local sandbox, where the exact same route shape (USDC → wNEAR 0.2 % pool → meme 1 % pool) ran with real code.

## 8. Phase C — Architecture: Option A vs Option B

| Criterion | **A: DCL module inside a new isolated Treasury version (`contracts/treasury-dcl`)** | B: separate DCL adapter contract fed by a Treasury |
|---|---|---|
| Ownership | the NFT is owned by the contract that books the creator's rights | the adapter owns the NFT, while the Treasury books the rights. Two sources of truth |
| Custody | funds and position in one account | funds cross a contract boundary twice. The adapter needs allowlisted callers |
| Security | one trust boundary (TreasuryDCL ↔ DCL) | extra authorisation (Treasury → adapter), so a compromised or upgraded adapter moves positions |
| Operations | 1 HotZap per position | 1 transfer to the adapter, then the HotZap, then a report back |
| Gas | 139 Tgas per position (measured) | more: two more cross-contract hops |
| Storage | one DCL account (0.6 NEAR) | the same, plus adapter state |
| Callbacks | stage-checked, one job at a time | the same, on two contracts, with cross-contract replay surfaces |
| Reconciliation | DCL state vs own books (proven in the sandbox) | three-way reconciliation |
| Upgradeability | none (no owner, no setter) | an adapter registry would be needed |
| Frontend | one view surface (`get_position`) | two |
| Withdrawal | `nft_transfer` straight to the creator | adapter → creator, authorised by the Treasury |

**Decision: Option A.** It adds the fewest new trust assumptions, and it is the same pattern as V4.1 (spec §5.2). The V4.1 TreasuryV4 (Classic) is **unchanged**; TreasuryDCL is a separate crate and would be a separate account.

## 9. Phase D — Concentrated liquidity policy

- **One position per deposit**, range fixed in the signed plan:
  - no rebalancing;
  - no leverage;
  - no algorithm on-chain.
- **Range:** the dashboard proposes ±5 000 / ±20 000 / ±50 000 points around the live price, on the `point_delta` grid (≈ ×÷1.65 / ×÷7.4 / ×÷148 in price).
- **Contract checks** (`check_plan`, `check_entry`):
  - grid alignment, `left < right`, bounds;
  - width within `[min_range_width, max_range_width]` (sandbox: 4 000 to 200 000);
  - the price strictly **inside** the range right before the zap (position active at entry).
- **Amounts:**
  - not 50/50;
  - the dashboard bisects the USDC split between the two legs until both swap outputs are used in the same proportion by the range. This uses the DCL's own `predict_hotzap`, because the X leg moves the target pool;
  - min outs = predicted − ½ slippage;
  - liquidity minimums = amounts − 2 × slippage.
- **Measured leftovers:** ~0.5 % of each side in the sandbox; 0.00 % / 0.01 % on the NEARLY mainnet reference simulation. They stay recoverable in the DCL account.
- **Unused capital:**
  - LP budget − USDC sent goes back to the creator's USDC reserve (1 USDC of 18 in F1);
  - the zap leftovers are booked per deposit.
- **Out of range** (shown by the client's `rangeStatus`, measured in sandbox K3–K5):
  - above → 100 % wNEAR;
  - below → 100 % memecoin;
  - **no fees** while outside;
  - the position stays in the pool and earns again if the price returns.
  - Risk for the creator: they end up holding the asset that lost value relative to the other (impermanent loss, concentrated). No yield is promised anywhere; no APR is computed.

## 10. Phase I — FUEL

The deployed FUEL reads only `treasury.sol2near-dev.testnet` / Ref Classic pool 2951 (`contracts/fuel/src/lib.rs:554`, no setter).

DCL positions are **`FUEL_NOT_ELIGIBLE`** in:
- the contract (`get_position.fuel_status`);
- the client;
- the UI.

The FUEL contract was **not modified**. A future, separately approved FUEL version would need (`DCL_FUEL_REQUIREMENTS`):

1. read the position from TreasuryDCL `get_position` **and** DCL `get_liquidity`: owner = TreasuryDCL, same `lpt_id`, pool allowlisted;
2. measure the liquidity actually deployed (DCL liquidity units at confirmation and now), not the quote or the budget;
3. measure the holding time from `position_confirmed` until `position_withdrawn`;
4. one reward key per `lpt_id` and per funding deposit (no double reward by re-registration or splitting);
5. refuse closed or transferred positions (`get_liquidity` null or owner ≠ TreasuryDCL);
6. track capital already rewarded per creator across withdraw → re-deposit, so the same USDC cannot multiply FUEL.

No new emission or economics was created.

## 11. Phase J — Targeted security audit

The author's own review, **not an independent audit**.

| # | Topic | Finding / control |
|---|---|---|
| 1 | Trust boundaries | Frontend → contract: the plan is untrusted. Every guard is re-checked on-chain against the DCL's own views (`get_pool`, `predict_hotzap`, 2 small `quote`s). Contract → DCL: trusted for pool math and custody of the position; upgradeable by Rhea's DAO (re-measure after an upgrade) |
| 2 | Owner checks | Creator-only: `execute_dcl_lp`, `claim_fees`, `withdraw_position`, `withdraw_dex_balance`, `abort`. `withdraw_token` acts on the caller's own balance. No admin, no setter. The position's owner is verified on the DCL at confirmation and at exit |
| 3 | Price conversions | All on-chain checks are in atomic units (no float). Floats are only used off-chain to choose a split; a bad split is refused by the DCL simulation (E4b) |
| 4 | Rounding | `bps_of` splits the multiplication to avoid overflow; 90/8/2 is the unchanged `ledger::split`; USDC side: `usdc_used + usdc_unused_to_reserve = lp_budget` (unit + sandbox) |
| 5 | Hidden taxes | `setup` reads `get_tax` of both tokens and refuses any non-zero tax; the pool-level tax is refused at setup and before every zap. **Limit:** a token with a tax mechanism that exposes no `get_tax` would pass `setup`. Mitigation: the client also requires a known untaxed code generation (global hash). A contract cannot read code hashes |
| 6 | Slippage | Per-leg min outs, at most 1 % from the DCL simulation; liquidity minimums at most 2 %; ceilings hard-coded (≤ 5 % slippage, ≤ 20 % impact) |
| 7 | Price manipulation | The preflight and the zap run in different blocks, so a sandwich between them is possible. It is bounded by the min outs and liquidity minimums (the zap reverts entirely, E204, and is refunded). The pool's current price is **not** treated as a fair price: impact is bounded per leg (10 % in the sandbox config, refused at 33 %, F4) |
| 8 | Out of range | The zap requires the price strictly inside the range at entry; afterwards out-of-range is reported, never "fixed" automatically |
| 9 | Async calls | One job at a time (`in_flight`); every stage persisted; `#[private]` callbacks check the stage (replays ignored, unit-tested); the gas budget covers the chain (139 Tgas burnt in the sandbox; the call requires ≥ 235 Tgas attached, 300 recommended) |
| 10 | Double execution | A replayed callback is a no-op; `lpt_index` prevents recording a position twice; a second claim books 0; a second exit is refused (H4); a second `withdraw_dex_balance` is refused (J3) |
| 11 | Storage | 0.5 NEAR covers 40 slots. A 41st position fails inside the DCL → the zap is refunded (no fund loss), but the Treasury is capped at 40 live positions (lookup page ≤ 50) |
| 12 | Withdrawals | The NFT goes only to the creator, after the lock; the owner is checked after transfer, with rollback on failure (unit). Leftovers are credited only if the DCL balance really dropped (unit) |
| 13 | Reconciliation | **Bug found and fixed during this audit:** the first `reconcile` decided "zap refunded vs used" from Treasury's USDC balance, which anyone can inflate with a plain `ft_transfer`. That would have allowed re-spending a budget whose USDC was already in a position. It now decides from the DCL (does Treasury own a matching new position?). Others' positions in the same range never count (unit) |
| 14 | Incompatible rewards | FUEL not touched; DCL positions `FUEL_NOT_ELIGIBLE` |
| 15 | Mainnet / testnet separation | `new` refuses any non-`*.testnet` / non-sandbox account (DEX, tokens, self); mainnet reads use a separate read-only client never given to the wallet code; the dashboard never offers an action on a mainnet card |

**Economic attacks considered:**
- **sandwich of the zap:** bounded by the guards, see item 7;
- **pool pre-positioning / thin liquidity:** a large deposit into a thin pool is refused by the impact guard;
- **tax token swap-in:** refused at setup;
- **dust griefing of the DCL account:** gifts are only booked to the in-flight deposit. They cannot be stolen, only mis-attributed to the depositor in flight; documented;
- **USDC gift to fake a refund:** fixed (item 13);
- **FUEL farming by recycling:** impossible today (not eligible).

## 12. Decision

| Success criterion (checkpoint §16) | Status |
|---|---|
| 1. DCL methods really verified | ✅ on the deployed v2.4.2 bytes: exports, real execution, argument names from the contract itself |
| 2. Ownership model understood | ✅ NEP-171, owner per position, E215 for others, a contract can own positions |
| 3. Nearly taxes identified | ✅ source + byte-identical wasm; measured 4 % in / 3 % out; NEARLY untaxed; DRAGON `BLOCKED_TAX` |
| 4. Acquisition of both assets feasible | ✅ in the local sandbox (2-hop HotZap); mainnet route quoted (reference); ❌ no public testnet route |
| 5. A separate DCL position represented and verified | ✅ TreasuryDCL proof model; DCL owner = Treasury; recorded liquidity = DCL row |
| 6. Safe design for withdrawal and fee collection | ✅ fees from DCL return values, no double count; exit by NFT after the lock; leftovers verified |
| 7. Local adapter works on the feasible scenarios | ✅ sandbox 1/1, 41 unit tests, 49 TS tests, 4 new e2e |
| 8. No Classic V3/V4.1 regression | ✅ Rust 34 + 31 + 47 + 3, V4.1 sandbox 1/1, near-client 39 → 49, crosschain 36, web 48, e2e 29 → 33 |

**`READY WITH LIMITATIONS`.** The limitations block V4.2B **public** execution, not local work:
1. no testnet DCL pool reachable from Tidepool USDC;
2. the real Nearly pools are mainnet, which is out of scope;
3. taxed tokens are refused;
4. the contract is not audited and not deployed.

V4.2B local E2E (dashboard signing against a local or testnet DCL pool that we would create) needs your decision first, see `V4_2A_EXECUTION.md` §8.
