//! Unit tests (mocked NEAR VM). Treasury / Ref answers are injected into the callback;
//! they prove FUEL's rules, NOT the live Treasury or Ref integration.
#![allow(unused_must_use)]
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const FUEL_ID: &str = "fuel.sol2near-dev.testnet";
const TREASURY: &str = "treasury.sol2near-dev.testnet";
const REF: &str = "ref-finance-101.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const POOL: u64 = 42;
const MIN: u64 = 60 * 1_000_000_000;
const SEASON: u64 = 30 * MIN; // demo season: 30 minutes
const LOCK: u64 = 10 * MIN; // Treasury demo lock: 10 minutes
const GENESIS: u64 = 1_000 * MIN;
const GRACE: u64 = 5 * MIN; // demo registration grace
/// Earliest close of season 0, relative to GENESIS.
const CLOSE: u64 = SEASON + GRACE + SETTLE_NS;
const USDC: u128 = 1_000_000; // 1 USDC atomic

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn set(predecessor: &str, now: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc(FUEL_ID))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(now)
        .block_height(100)
        .prepaid_gas(Gas::from_tgas(300))
        .attached_deposit(NearToken::from_millinear(10))
        .build());
}

fn config() -> ReactorConfig {
    ReactorConfig {
        treasury_id: acc(TREASURY),
        ref_exchange: acc(REF),
        pool_id: POOL,
        ecosystem_id: acc("ecosystem.sol2near-dev.testnet"),
        liquidity_id: acc("liquidity.sol2near-dev.testnet"),
        team_id: acc("team.sol2near-dev.testnet"),
        genesis_ns: U64(GENESIS),
        season_duration_ns: U64(SEASON),
        registration_grace_ns: U64(GRACE),
        season_target_usdc: U128(10 * USDC),
        season_reward_budget: U128(5_000 * ONE_FUEL),
        season_burn: U128(10 * ONE_FUEL),
        min_lock_ns: U64(LOCK),
        vault_cap: U128(2_000 * ONE_FUEL),
        team_cliff_ns: U64(60 * MIN),
        team_vesting_ns: U64(600 * MIN),
    }
}

fn fuel() -> Fuel {
    set(FUEL_ID, GENESIS);
    Fuel::new(config())
}

/// Treasury `get_deposit` answer for a confirmed, verified position whose books reconcile:
/// amount = 2 × usdc_in_lp, 90/8/2 split, swapped = lp_budget − usdc_in_lp, no dust.
fn deposit(id: u64, creator: &str, usdc_in_lp: u128, confirmed_at: u64) -> TreasuryDeposit {
    let amount = 2 * usdc_in_lp;
    let lp_budget = amount * 9_000 / 10_000;
    let reserve = amount * 800 / 10_000;
    TreasuryDeposit {
        id: U64(id),
        creator: acc(creator),
        amount: U128(amount),
        lp_budget: U128(lp_budget),
        reserve: U128(reserve),
        community: U128(amount - lp_budget - reserve),
        usdc_swapped: U128(lp_budget - usdc_in_lp),
        dust_usdc: U128(0),
        status: Value::String("LpConfirmed".into()),
        lp_shares: U128(1_000),
        lp_verified: true,
        usdc_in_lp: U128(usdc_in_lp),
        wnear_in_lp: U128(5),
        unlock_at: Some(U64(confirmed_at + LOCK)),
        pool_id: Some(POOL),
        lp_confirmed_at: Some(U64(confirmed_at)),
        lp_confirmed_block: Some(U64(77)),
    }
}

/// Simulates the Ref + Treasury answers arriving in on_position_proof.
fn admit(f: &mut Fuel, now: u64, d: Option<TreasuryDeposit>, recorded: u128, on_ref: u128) -> bool {
    let id = d.as_ref().map_or(999, |d| d.id.0);
    set(FUEL_ID, now);
    f.on_position_proof(U64(id), U64(now), Ok(d), Ok(TreasuryAccounting { recorded_shares: U128(recorded) }), Ok(U128(on_ref)))
}

fn admit_ok(f: &mut Fuel, d: TreasuryDeposit) -> bool {
    let now = d.lp_confirmed_at.unwrap().0 + MIN;
    admit(f, now, Some(d), 1_000, 1_000)
}

fn bal(f: &Fuel, who: &str) -> u128 {
    f.ft_balance_of(acc(who)).0
}

/// Every FUEL held by the contract is assigned to exactly one bucket, and supply only moves by burns.
fn assert_invariants(f: &Fuel) {
    let b = f.get_buckets();
    let buckets = b.pol_available.0 + b.pol_committed.0 + b.community_reserve.0 + b.burn_reserve.0 + b.team_locked.0;
    assert_eq!(b.contract_balance.0, buckets, "contract balance == sum of buckets");
    assert_eq!(b.total_supply.0 + b.burned_total.0, TOTAL_SUPPLY, "supply only changes by burns");
    assert_eq!(b.pol_available.0 + b.pol_committed.0 + b.pol_distributed.0 + b.community_reserve.0, POL_RESERVE);
}

// ------------------------- supply -------------------------

#[test]
fn initial_mint_is_fixed_and_traceable() {
    let f = fuel();
    assert_eq!(f.ft_total_supply().0, TOTAL_SUPPLY);
    assert_eq!(bal(&f, "ecosystem.sol2near-dev.testnet"), 199_000 * ONE_FUEL);
    assert_eq!(bal(&f, "liquidity.sol2near-dev.testnet"), 150_000 * ONE_FUEL);
    assert_eq!(bal(&f, "team.sol2near-dev.testnet"), 0, "team allocation is vested, not distributed");
    assert_eq!(bal(&f, FUEL_ID), POL_RESERVE + BURN_RESERVE + TEAM);
    let m = f.ft_metadata();
    assert_eq!((m.symbol.as_str(), m.decimals), ("FUEL", 18));
    assert_invariants(&f);
}

#[test]
#[should_panic(expected = "ERR_BURN_GT_10_FUEL")]
fn burn_parameter_is_bounded() {
    set(FUEL_ID, GENESIS);
    Fuel::new(ReactorConfig { season_burn: U128(11 * ONE_FUEL), ..config() });
}

#[test]
#[should_panic(expected = "ERR_VAULT_CAP")]
fn vault_cap_parameter_is_bounded() {
    set(FUEL_ID, GENESIS);
    Fuel::new(ReactorConfig { vault_cap: U128(2_001 * ONE_FUEL), ..config() });
}

// ------------------------- proof of liquidity -------------------------

#[test]
fn verified_position_is_admitted_with_80_20_split() {
    let mut f = fuel();
    assert!(admit_ok(&mut f, deposit(0, ALICE, 9 * USDC, GENESIS + MIN)));
    let v = f.get_position(U64(0)).unwrap();
    assert_eq!(v.reward_status, RewardStatus::Pending);
    assert_eq!(v.position.reward_total.0, 9 * ONE_FUEL, "1 FUEL per USDC actually in the LP");
    assert_eq!(v.position.creator_reward.0, 9 * ONE_FUEL * 8 / 10);
    assert_eq!(v.position.community_reward.0, 9 * ONE_FUEL * 2 / 10);
    assert_eq!((v.position.season_id, v.position.vault_id.as_str()), (0, ALICE));
    assert_eq!(f.get_season(0).unwrap().progress_usdc.0, 9 * USDC);
    assert_invariants(&f);
}

#[test]
fn rejected_positions_write_nothing() {
    let mut f = fuel();
    let now = GENESIS + 2 * MIN;
    let base = || deposit(1, ALICE, 9 * USDC, GENESIS + MIN);
    let pending = TreasuryDeposit { status: json!({"SwapPending": {"usdc": "1"}}), ..base() };
    let failed = TreasuryDeposit { status: json!("BudgetAllocated"), ..base() };
    let withdrawn = TreasuryDeposit { status: json!("LpWithdrawn"), ..base() };
    let unverified = TreasuryDeposit { lp_verified: false, ..base() };
    let wrong_pool = TreasuryDeposit { pool_id: Some(7), ..base() };
    let short_lock = TreasuryDeposit { unlock_at: Some(U64(GENESIS + MIN + LOCK - 1)), ..base() };
    let no_proof = TreasuryDeposit { lp_confirmed_block: None, ..base() };
    let before_genesis = deposit(1, ALICE, 9 * USDC, GENESIS - 1);
    // Books that do not reconcile: inflated usdc_in_lp, or a 90/8/2 split that is off.
    let inflated = TreasuryDeposit { usdc_in_lp: U128(10 * USDC), ..base() };
    let bad_split = TreasuryDeposit { reserve: U128(base().reserve.0 + 1), community: U128(base().community.0 - 1), ..base() };
    for d in [pending, failed, withdrawn, unverified, wrong_pool, short_lock, no_proof, before_genesis, inflated, bad_split] {
        assert!(!admit(&mut f, now, Some(d), 1_000, 1_000));
    }
    assert!(!admit(&mut f, now, None, 0, 0), "non-existent position");
    assert!(!admit(&mut f, now, Some(base()), 1_000, 999), "Ref shows fewer shares than Treasury records");
    set(FUEL_ID, now);
    assert!(!f.on_position_proof(U64(1), U64(now), Err(PromiseError::Failed), Ok(TreasuryAccounting { recorded_shares: U128(0) }), Ok(U128(0))));
    assert!(f.get_position(U64(1)).is_none());
    assert!(f.get_season(0).is_none(), "no season record created by rejections");
    assert_invariants(&f);
}

#[test]
fn a_position_is_rewarded_once() {
    let mut f = fuel();
    assert!(admit_ok(&mut f, deposit(0, ALICE, 9 * USDC, GENESIS + MIN)));
    // Same contribution again (e.g. racing callbacks, or replay in a later season).
    assert!(!admit(&mut f, GENESIS + SEASON + MIN, Some(deposit(0, ALICE, 9 * USDC, GENESIS + MIN)), 1_000, 1_000));
    assert_eq!(f.get_season(0).unwrap().positions, 1);
}

#[test]
#[should_panic(expected = "ERR_ALREADY_REGISTERED")]
fn register_rejects_known_position_before_any_call() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 9 * USDC, GENESIS + MIN));
    set(BOB, GENESIS + 3 * MIN);
    f.register_position(U64(0));
}

#[test]
fn old_capital_cannot_recharge_a_later_season() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 9 * USDC, GENESIS + MIN)); // season 0 touched
    set(BOB, GENESIS + CLOSE);
    f.close_season(0);
    // Confirmed during season 0, requested after its window: refused, and it does not move to season 1.
    assert!(!admit(&mut f, GENESIS + CLOSE + MIN, Some(deposit(1, BOB, 9 * USDC, GENESIS + 2 * MIN)), 1_000, 1_000));
    assert!(f.get_season(1).is_none());
}

#[test]
#[should_panic(expected = "ERR_PRIVATE_CALLBACK")]
fn proof_callback_rejects_other_callers() {
    let mut f = fuel();
    set(BOB, GENESIS + MIN); // attacker calls the callback with fabricated data
    f.on_position_proof(U64(0), U64(GENESIS + MIN), Ok(Some(deposit(0, BOB, 2_000 * USDC, GENESIS))), Ok(TreasuryAccounting { recorded_shares: U128(0) }), Ok(U128(1)));
}

// ------------------------- season boundaries & async policy -------------------------

#[test]
fn registration_window_boundary_is_by_request_time() {
    let mut f = fuel();
    let end = GENESIS + SEASON;
    // Confirmed in the last second of season 0, requested during the grace period: counts for season 0.
    assert!(admit(&mut f, end + GRACE - 1, Some(deposit(0, ALICE, 6 * USDC, end - 1)), 1_000, 1_000));
    assert_eq!(f.get_position(U64(0)).unwrap().position.season_id, 0);
    // Requested exactly at end + grace: window closed, nothing written.
    assert!(!admit(&mut f, end + GRACE, Some(deposit(1, BOB, 6 * USDC, end - 1)), 1_000, 1_000));
    assert!(f.get_position(U64(1)).is_none());
    assert_eq!(f.get_season(0).unwrap().progress_usdc.0, 6 * USDC);
    // Confirmed in season 1, requested during season 0's grace: counts for season 1, not season 0.
    assert!(admit(&mut f, end + MIN, Some(deposit(2, BOB, 3 * USDC, end + 1)), 1_000, 1_000));
    assert_eq!(f.get_position(U64(2)).unwrap().position.season_id, 1);
    assert_eq!(f.get_season(0).unwrap().progress_usdc.0, 6 * USDC, "no double counting across seasons");
}

#[test]
fn close_waits_for_grace_and_settlement() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + MIN));
    set(BOB, GENESIS + CLOSE - 1);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f.close_season(0)));
    assert!(early.is_err(), "cannot close while proofs may still be in flight");
    assert_eq!(f.get_season(0).unwrap().status, SeasonStatus::Open);
    set(BOB, GENESIS + CLOSE);
    assert_eq!(f.close_season(0).status, SeasonStatus::Success);
}

#[test]
fn late_callback_after_close_is_refused_not_retroactive() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + MIN));
    set(BOB, GENESIS + CLOSE);
    f.close_season(0);
    let before = f.get_season(0).unwrap();
    // A proof requested inside the window whose callback lands after the close (> SETTLE_NS late).
    set(FUEL_ID, GENESIS + CLOSE + 1);
    let late = deposit(1, BOB, 5 * USDC, GENESIS + 3 * MIN);
    assert!(!f.on_position_proof(U64(1), U64(GENESIS + SEASON + GRACE - 1), Ok(Some(late)), Ok(TreasuryAccounting { recorded_shares: U128(1_000) }), Ok(U128(1_000))));
    assert_eq!(f.get_season(0).unwrap(), before, "closed season unchanged");
    assert!(f.get_position(U64(1)).is_none());
    assert_invariants(&f);
}

#[test]
fn concurrent_proofs_in_one_block_are_each_counted_once() {
    let mut f = fuel();
    let now = GENESIS + 5 * MIN;
    assert!(admit(&mut f, now, Some(deposit(0, ALICE, 4 * USDC, GENESIS + MIN)), 1_000, 1_000));
    assert!(admit(&mut f, now, Some(deposit(1, BOB, 4 * USDC, GENESIS + 2 * MIN)), 1_000, 1_000));
    assert!(!admit(&mut f, now, Some(deposit(0, ALICE, 4 * USDC, GENESIS + MIN)), 1_000, 1_000), "duplicate callback");
    let s = f.get_season(0).unwrap();
    assert_eq!((s.positions, s.progress_usdc.0), (2, 8 * USDC));
    assert_invariants(&f);
}

// ------------------------- caps and reserves -------------------------

#[test]
fn vault_cap_is_rolling_30_days() {
    let mut f = fuel();
    assert!(admit_ok(&mut f, deposit(0, ALICE, 1_500 * USDC, GENESIS + MIN)));
    assert!(admit_ok(&mut f, deposit(1, ALICE, 1_500 * USDC, GENESIS + 2 * MIN)));
    let second = f.get_position(U64(1)).unwrap().position;
    assert_eq!(second.reward_total.0, 500 * ONE_FUEL, "clipped to the 2 000 FUEL cap");
    assert_eq!(f.get_season(0).unwrap().progress_usdc.0, 3_000 * USDC, "progress still counts the liquidity");
    // Another vault is not affected.
    assert!(admit_ok(&mut f, deposit(2, BOB, 10 * USDC, GENESIS + 3 * MIN)));
    assert_eq!(f.get_position(U64(2)).unwrap().position.reward_total.0, 10 * ONE_FUEL);
    // 30 days after both awards (registered at +2 and +3 minutes) the window has rolled.
    let later = GENESIS + 3 * MIN + CAP_WINDOW_NS;
    set(FUEL_ID, later);
    assert_eq!(f.get_vault_cap_left(acc(ALICE)).0, 2_000 * ONE_FUEL);
    assert_invariants(&f);
}

#[test]
fn reward_never_exceeds_season_budget_or_reserve() {
    set(FUEL_ID, GENESIS);
    let mut f = Fuel::new(ReactorConfig { season_reward_budget: U128(15 * ONE_FUEL), ..config() });
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + MIN));
    admit_ok(&mut f, deposit(1, BOB, 10 * USDC, GENESIS + 2 * MIN));
    assert_eq!(f.get_position(U64(1)).unwrap().position.reward_total.0, 5 * ONE_FUEL, "budget left");
    admit_ok(&mut f, deposit(2, "carol.testnet", 10 * USDC, GENESIS + 3 * MIN));
    let v = f.get_position(U64(2)).unwrap();
    assert_eq!((v.position.reward_total.0, v.reward_status), (0, RewardStatus::NoReward));
    // Reserve exhaustion: shrink the available reserve directly.
    f.pol_available = 3;
    f.pol_committed = POL_RESERVE - 3;
    let d = deposit(3, "dave.testnet", 10 * USDC, GENESIS + SEASON + MIN);
    admit(&mut f, GENESIS + SEASON + 2 * MIN, Some(d), 1_000, 1_000);
    assert_eq!(f.get_position(U64(3)).unwrap().position.reward_total.0, 3, "only what is really available");
}

#[test]
fn rounding_conserves_every_atomic_unit() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 1, GENESIS + MIN)); // 1 atomic USDC -> 1e12 FUEL atomic
    let p = f.get_position(U64(0)).unwrap().position;
    assert_eq!(p.creator_reward.0 + p.community_reward.0, p.reward_total.0);
    assert_invariants(&f);
}

#[test]
fn odd_reward_floors_to_creator_remainder_to_community() {
    set(FUEL_ID, GENESIS);
    let mut g = Fuel::new(ReactorConfig { season_reward_budget: U128(7), ..config() });
    admit_ok(&mut g, deposit(0, ALICE, 9 * USDC, GENESIS + MIN));
    let q = g.get_position(U64(0)).unwrap().position;
    assert_eq!((q.creator_reward.0, q.community_reward.0), (5, 2), "floor to creator, remainder to community");
    assert_invariants(&g);
}

// ------------------------- seasons -------------------------

#[test]
fn successful_season_levels_up_and_enables_claims_after_lock() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 9 * USDC, GENESIS + MIN));
    admit_ok(&mut f, deposit(1, BOB, 2 * USDC, GENESIS + 2 * MIN));
    set(BOB, GENESIS + CLOSE);
    let s = f.close_season(0);
    assert_eq!((s.status, s.level_after, f.get_reactor().level), (SeasonStatus::Success, Some(1), 1));
    assert_eq!(f.get_buckets().community_reserve.0, 11 * ONE_FUEL * 2 / 10);

    // Alice's lock ended at GENESIS + MIN + LOCK (< season end): claimable now.
    assert_eq!(f.get_position(U64(0)).unwrap().reward_status, RewardStatus::Claimable);
    f.token.internal_register_account(&acc(ALICE));
    set(BOB, GENESIS + CLOSE); // anyone can trigger, FUEL goes to the creator
    assert_eq!(f.claim(U64(0)).0, 9 * ONE_FUEL * 8 / 10);
    assert_eq!(bal(&f, ALICE), 9 * ONE_FUEL * 8 / 10);
    assert_eq!(bal(&f, BOB), 0, "the caller gets nothing");
    assert_eq!(f.get_position(U64(0)).unwrap().reward_status, RewardStatus::Claimed);
    assert_invariants(&f);
}

#[test]
#[should_panic(expected = "ERR_ALREADY_CLAIMED")]
fn double_claim_is_rejected() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + MIN));
    set(BOB, GENESIS + CLOSE);
    f.close_season(0);
    f.token.internal_register_account(&acc(ALICE));
    f.claim(U64(0));
    f.claim(U64(0));
}

#[test]
#[should_panic(expected = "ERR_LP_STILL_LOCKED")]
fn claim_waits_for_the_lp_lock() {
    let mut f = fuel();
    // Confirmed 1 minute before the season ends: lock runs past the close.
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + SEASON - MIN));
    set(BOB, GENESIS + CLOSE);
    f.close_season(0);
    f.token.internal_register_account(&acc(ALICE));
    assert_eq!(f.get_position(U64(0)).unwrap().reward_status, RewardStatus::Locked);
    f.claim(U64(0));
}

#[test]
#[should_panic(expected = "ERR_SEASON_NOT_CLOSED")]
fn pending_reward_cannot_be_claimed() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + MIN));
    f.token.internal_register_account(&acc(ALICE));
    set(ALICE, GENESIS + SEASON - 1);
    f.claim(U64(0));
}

#[test]
#[should_panic(expected = "ERR_UNKNOWN_POSITION")]
fn unknown_position_cannot_be_claimed() {
    let mut f = fuel();
    set(ALICE, GENESIS);
    f.claim(U64(5));
}

#[test]
fn failed_transfer_keeps_the_reward_claimable() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + MIN));
    set(BOB, GENESIS + CLOSE);
    f.close_season(0);
    // Creator not registered on FUEL: the claim reverts as a whole (nothing marked paid).
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f.claim(U64(0))));
    assert!(r.is_err(), "claim to an unregistered creator must fail");
    assert_invariants(&f);
    assert_eq!(f.get_position(U64(0)).unwrap().reward_status, RewardStatus::Claimable);
    f.token.internal_register_account(&acc(ALICE));
    set(BOB, GENESIS + CLOSE);
    assert_eq!(f.claim(U64(0)).0, 8 * ONE_FUEL);
}

#[test]
fn failed_season_burns_at_most_10_fuel_once_and_releases_rewards() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 3 * USDC, GENESIS + MIN)); // target is 10 USDC
    let before = f.get_buckets();
    set(BOB, GENESIS + CLOSE);
    let s = f.close_season(0);
    assert_eq!((s.status, s.burned.0), (SeasonStatus::Failed, 10 * ONE_FUEL));
    let after = f.get_buckets();
    assert_eq!(after.total_supply.0, TOTAL_SUPPLY - 10 * ONE_FUEL, "real supply reduction");
    assert_eq!(after.burn_reserve.0, BURN_RESERVE - 10 * ONE_FUEL);
    assert_eq!(after.pol_available.0, before.pol_available.0 + 3 * ONE_FUEL, "commitment released");
    assert_eq!(f.get_position(U64(0)).unwrap().reward_status, RewardStatus::Forfeited);
    assert_eq!(f.get_reactor().level, 0, "level never below zero");
    // Holders and allocations untouched.
    assert_eq!(bal(&f, "ecosystem.sol2near-dev.testnet"), 199_000 * ONE_FUEL);
    assert_invariants(&f);
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f.close_season(0)));
    assert!(again.is_err(), "second close (double burn) rejected");
}

#[test]
fn burn_stops_when_the_burn_reserve_is_empty() {
    let mut f = fuel();
    f.burn_reserve = 4;
    f.token.internal_withdraw(&acc(FUEL_ID), BURN_RESERVE - 4);
    f.burned_total = BURN_RESERVE - 4;
    admit_ok(&mut f, deposit(0, ALICE, 1 * USDC, GENESIS + MIN));
    set(BOB, GENESIS + CLOSE);
    assert_eq!(f.close_season(0).burned.0, 4);
    assert_invariants(&f);
}

#[test]
#[should_panic(expected = "ERR_SEASON_EMPTY")]
fn empty_seasons_cannot_be_closed_or_burned() {
    let mut f = fuel();
    set(BOB, GENESIS + 5 * SEASON);
    f.close_season(3);
}

#[test]
#[should_panic(expected = "ERR_SEASON_NOT_ENDED")]
fn season_cannot_close_early() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + MIN));
    set(BOB, GENESIS + SEASON - 1);
    f.close_season(0);
}

#[test]
fn level_goes_up_then_down() {
    let mut f = fuel();
    admit_ok(&mut f, deposit(0, ALICE, 10 * USDC, GENESIS + MIN));
    set(BOB, GENESIS + CLOSE);
    f.close_season(0);
    admit_ok(&mut f, deposit(1, BOB, 1 * USDC, GENESIS + CLOSE + MIN)); // season 1, after season 0 closed
    set(BOB, GENESIS + SEASON + CLOSE);
    f.close_season(1);
    assert_eq!(f.get_reactor().level, 0);
    assert_eq!(f.get_reactor().seasons_touched, vec![0, 1]);
}

// ------------------------- narrated demo (MOCKED VM, not testnet) -------------------------

/// `cargo test -p sol2near-fuel demo_walkthrough -- --nocapture`
#[test]
fn demo_walkthrough() {
    println!("\n=== SOL2NEAR FUEL Reactor walkthrough — MOCKED NEAR VM (not testnet) ===");
    let mut f = fuel();
    let d = deposit(0, ALICE, 9_500_000, GENESIS + MIN);
    println!("1. Treasury deposit #0 by {ALICE}: status LpConfirmed, lp_verified, {} shares, 9.5 USDC in pool {POOL}", d.lp_shares.0);
    println!("2. Proof: Ref get_pool_shares(Treasury)=1000 >= Treasury recorded_shares=1000, lock 10 min >= min lock");
    assert!(admit(&mut f, GENESIS + 2 * MIN, Some(d), 1_000, 1_000));
    let p = f.get_position(U64(0)).unwrap();
    println!("   -> admitted in season {}: reward {} FUEL ({} creator / {} community), status {:?}",
        p.position.season_id, p.position.reward_total.0 as f64 / 1e18, p.position.creator_reward.0 as f64 / 1e18,
        p.position.community_reward.0 as f64 / 1e18, p.reward_status);
    assert!(!admit(&mut f, GENESIS + 3 * MIN, Some(deposit(1, BOB, 5 * USDC, GENESIS + MIN)), 1_000, 999));
    println!("   -> deposit #1 refused: Ref shows 999 < 1000 recorded shares (ERR_SHARES_NOT_BACKED_ON_REF)");
    admit_ok(&mut f, deposit(2, BOB, 1 * USDC, GENESIS + 4 * MIN));
    let s = f.get_season(0).unwrap();
    println!("3. Reactor season 0 progress: {} / {} USDC, {} positions", s.progress_usdc.0 as f64 / 1e6, s.target_usdc.0 as f64 / 1e6, s.positions);
    set(BOB, GENESIS + CLOSE);
    let closed = f.close_season(0);
    println!("4. close_season(0) by anyone after end: {:?}, level -> {:?}, burned {}", closed.status, closed.level_after, closed.burned.0);
    f.token.internal_register_account(&acc(ALICE));
    let paid = f.claim(U64(0));
    println!("5. claim(#0): {} FUEL paid to {ALICE} (lock over, season SUCCESS)", paid.0 as f64 / 1e18);
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f.claim(U64(0))));
    println!("6. second claim(#0): {}", if again.is_err() { "REJECTED (ERR_ALREADY_CLAIMED)" } else { "accepted?!" });
    assert!(again.is_err());
    assert_invariants(&f);
    println!("   supply {} FUEL, invariants hold\n", f.ft_total_supply().0 / ONE_FUEL);
}

// ------------------------- team vesting & holders -------------------------

#[test]
fn team_vesting_is_enforced() {
    let mut f = fuel();
    set(BOB, GENESIS + 59 * MIN);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f.release_team()));
    assert!(early.is_err(), "nothing before the cliff");
    set(BOB, GENESIS + 60 * MIN);
    assert_eq!(f.release_team().0, TEAM / 10, "60 of 600 minutes vested");
    set(BOB, GENESIS + 10_000 * MIN);
    assert_eq!(f.release_team().0, TEAM - TEAM / 10);
    assert_eq!(bal(&f, "team.sol2near-dev.testnet"), TEAM);
    assert_invariants(&f);
}

#[test]
#[should_panic(expected = "positive balance")]
fn unregister_never_burns_a_holder_balance() {
    let mut f = fuel();
    set("ecosystem.sol2near-dev.testnet", GENESIS);
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc(FUEL_ID))
        .predecessor_account_id(acc("ecosystem.sol2near-dev.testnet"))
        .attached_deposit(NearToken::from_yoctonear(1))
        .build());
    f.storage_unregister(Some(true));
}
