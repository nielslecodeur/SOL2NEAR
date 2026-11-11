# Testnet bootstrap — gate G2 (manual, NOT executed yet)

> **Authoritative transaction list, amounts and approval batches: `docs/G2_READINESS.md` §6.**
> Amounts there supersede the examples below. Seed the pool with 50 USDC + 13.44 wNEAR, not 10 + 2.688.

> **TESTNET ONLY. Each command signs a transaction: run only after explicit approval from the lead.**
> Keys stay in the Windows keychain of near-cli-rs (`sign-with-keychain`). Never paste a private key here.

Shorthand used below (PowerShell):

```powershell
$DEV="sol2near-dev.testnet"; $T="treasury.sol2near-dev.testnet"
$REF="ref-finance-101.testnet"; $USDC="usdc.tidepool-sandbox.testnet"; $WNEAR="wnear.tidepool-sandbox.testnet"
function call($c,$m,$a,$dep,$gas="100 Tgas",$as=$DEV){ near contract call-function as-transaction $c $m json-args $a prepaid-gas $gas attached-deposit $dep sign-as $as network-config testnet sign-with-keychain send }
function view($c,$m,$a="{}"){ near contract call-function as-read-only $c $m json-args $a network-config testnet now }
```

## 0. Funds (no signature from us)
- Tidepool NEAR faucet (site only, account ≥ 3 h old → from ~23:20 UTC 2026-11-11): https://app.usetidepool.tech/faucet, mode **wallet**, account `sol2near-dev.testnet` → 100 USDC + 40 wNEAR (+ others).
- Check: `view $USDC ft_balance_of "{\"account_id\":\"$DEV\"}"` and same for `$WNEAR`.

## 1. Storage registrations (B3/B4/B5) — ~0.105 NEAR
```powershell
call $USDC  storage_deposit "{\"account_id\":\"$REF\",\"registration_only\":true}" '0.00125 NEAR'
call $WNEAR storage_deposit "{\"account_id\":\"$REF\",\"registration_only\":true}" '0.00125 NEAR'
call $REF   storage_deposit "{\"account_id\":\"$DEV\",\"registration_only\":false}" '0.1 NEAR'
call $REF   register_tokens "{\"token_ids\":[\"$USDC\",\"$WNEAR\"]}" '1 yoctoNEAR'
view $REF storage_balance_of "{\"account_id\":\"$DEV\"}"        # record before/after (H3/H4)
```

## 2. Failure test first (H5): deposit without registration must be refunded
Use a token NOT registered by `$DEV` on Ref (e.g. `usdt.tidepool-sandbox.testnet`, after its own storage for `$REF`):
```powershell
call usdt.tidepool-sandbox.testnet ft_transfer_call "{\"receiver_id\":\"$REF\",\"amount\":\"1000000\",\"msg\":\"\"}" '1 yoctoNEAR' '100 Tgas'
view usdt.tidepool-sandbox.testnet ft_balance_of "{\"account_id\":\"$DEV\"}"   # expected: unchanged (refunded)
```

## 3. Deposit both legs into Ref (D2/D3)
```powershell
call $USDC  ft_transfer_call "{\"receiver_id\":\"$REF\",\"amount\":\"10000000\",\"msg\":\"\"}" '1 yoctoNEAR' '100 Tgas'
call $WNEAR ft_transfer_call "{\"receiver_id\":\"$REF\",\"amount\":\"2688000000000000000000000\",\"msg\":\"\"}" '1 yoctoNEAR' '100 Tgas'
view $REF get_deposits "{\"account_id\":\"$DEV\"}"
```
(10 USDC + 2.688 wNEAR ≈ Tidepool price 3.72 USDC/wNEAR on 2026-11-11 — recompute from `GET /v0/tokens` before running.)

## 4. Create the pool (B7, H3) and add initial liquidity (D4, H4)
```powershell
view $REF get_number_of_pools                                  # N before
call $REF add_simple_pool "{\"tokens\":[\"$USDC\",\"$WNEAR\"],\"fee\":30}" '0.1 NEAR'
view $REF get_number_of_pools                                  # new pool_id = N
view $REF get_pool "{\"pool_id\":<N>}"
call $REF add_liquidity "{\"pool_id\":<N>,\"amounts\":[\"10000000\",\"2688000000000000000000000\"],\"min_amounts\":[\"1\",\"1\"]}" '0.005 NEAR' '100 Tgas'
view $REF get_pool_shares "{\"pool_id\":<N>,\"account_id\":\"$DEV\"}"   # must be > 0
view $REF mft_balance_of "{\"token_id\":\":<N>\",\"account_id\":\"$DEV\"}"
```
Record in `docs/FEASIBILITY.md` (H3/H4/H5) and `packages/shared/src/accounts.ts` (`LP_POOL_ID`): tx hashes, NEAR actually charged (receipt), shares minted.

## 5. Verify the swap guard (H11) with a tiny amount
```powershell
call $USDC ft_transfer_call "{\"receiver_id\":\"$REF\",\"amount\":\"100000\",\"msg\":\"\"}" '1 yoctoNEAR' '100 Tgas'
call $REF swap "{\"actions\":[{\"pool_id\":<N>,\"token_in\":\"$USDC\",\"amount_in\":\"100000\",\"token_out\":\"$WNEAR\",\"min_amount_out\":\"1\"}]}" '1 yoctoNEAR'
```
If Ref rejects the 1-yocto deposit on `swap`, change `launch_swap` in `contracts/treasury/src/lib.rs` accordingly before deploying.

## 6. Treasury deploy + setup (gate G3, separate approval)
```powershell
# build with cargo-near first (docs/ARCHITECTURE.md §7) and check the SHA-256 printed by the build
near contract deploy $T use-file target/near/treasury/sol2near_treasury.wasm with-init-call new json-args "{\"usdc_token\":\"$USDC\",\"wnear_token\":\"$WNEAR\",\"ref_exchange\":\"$REF\",\"pool_id\":<N>,\"min_deposit\":\"1000000\",\"lp_lock_duration_ns\":\"600000000000\"}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
call $T setup '{}' '0.105 NEAR' '150 Tgas'
view $T get_config
```
`lp_lock_duration_ns = 600000000000` = **10 minutes, test value** (spec V3 §5: accelerated lock, declared as such).

## 7. FUEL deploy (gate G3, separate approval) — DEMO config, not production
```powershell
$FUEL="fuel.sol2near-dev.testnet"
near account create-account fund-myself $FUEL '4 NEAR' autogenerate-new-keypair save-to-keychain sign-as $DEV network-config testnet sign-with-keychain send
# genesis = now (ns); season 30 min, grace 5 min, target 5 USDC, burn 10 FUEL, min lock 10 min, team cliff 1 h / vesting 10 h
$G = [string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000000)
$cfg = "{`"config`":{`"treasury_id`":`"$T`",`"ref_exchange`":`"$REF`",`"pool_id`":<N>,`"ecosystem_id`":`"$DEV`",`"liquidity_id`":`"$DEV`",`"team_id`":`"$DEV`",`"genesis_ns`":`"$G`",`"season_duration_ns`":`"1800000000000`",`"registration_grace_ns`":`"300000000000`",`"season_target_usdc`":`"5000000`",`"season_reward_budget`":`"5000000000000000000000`",`"season_burn`":`"10000000000000000000`",`"min_lock_ns`":`"600000000000`",`"vault_cap`":`"2000000000000000000000`",`"team_cliff_ns`":`"3600000000000`",`"team_vesting_ns`":`"36000000000000`"}}"
near contract deploy $FUEL use-file target/near/fuel/sol2near_fuel.wasm with-init-call new json-args $cfg prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
view $FUEL get_reactor
# after a Treasury deposit reaches LpConfirmed:
call $FUEL register_position '{"position_id":"0"}' '0 NEAR' '100 Tgas'
view $FUEL get_position '{"position_id":"0"}'
```
On testnet the ecosystem, liquidity and team allocations go to `$DEV` for simplicity. Dedicated
accounts would be used in production.
