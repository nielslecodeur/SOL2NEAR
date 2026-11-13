//! SOL2NEAR SANDBOX MEME — test token for the V4.1 Classic pilot. NOT DEPLOYED. NO VALUE.
//!
//! Plain NEP-141 + NEP-145 (near-contract-standards), so the pilot exercises a real token contract:
//! - the whole fixed supply is minted ONCE in `new` to `owner_id`;
//! - there is no mint, no burn, no admin, no pause, no blacklist and NO TRANSFER TAX
//!   (every transfer moves exactly `amount`, tested below and in the sandbox run);
//! - its name says what it is, so it can never be mistaken for a real memecoin.
//!
//! It proves the Treasury adapter with a token of 18 decimals; it proves nothing about a live memecoin.

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

pub const DECIMALS: u8 = 18;
pub const NAME: &str = "SOL2NEAR Sandbox Meme (TEST TOKEN, NO VALUE)";
pub const SYMBOL: &str = "S2NMEME";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SandboxMeme {
    token: FungibleToken,
}

#[near]
impl SandboxMeme {
    /// Mints `total_supply` once to `owner_id`. Refuses to run on an account that is not a testnet
    /// (`*.testnet`) or local sandbox (`*.test.near`) account, so it cannot be deployed on mainnet as is.
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        let me = env::current_account_id();
        require!(me.as_str().ends_with(".testnet") || me.as_str().ends_with(".test.near"), "ERR_TESTNET_OR_SANDBOX_ONLY");
        require!(total_supply.0 > 0, "ERR_ZERO_SUPPLY");
        let mut token = FungibleToken::new(StorageKey::Token);
        token.internal_register_account(&owner_id);
        token.internal_deposit(&owner_id, total_supply.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("sandbox supply, minted once"),
        }
        .emit();
        Self { token }
    }
}

#[near]
impl FungibleTokenCore for SandboxMeme {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for SandboxMeme {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for SandboxMeme {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// `force` is ignored: unregistering never burns a balance.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let _ = force;
        self.token.internal_storage_unregister(Some(false)).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for SandboxMeme {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: NAME.to_string(),
            symbol: SYMBOL.to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE: u128 = 10u128.pow(18);
    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(current: &str, pred: &str, yocto: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc(current))
            .predecessor_account_id(acc(pred))
            .signer_account_id(acc(pred))
            .attached_deposit(NearToken::from_yoctonear(yocto))
            .build());
    }

    #[test]
    fn supply_is_minted_once_to_the_owner_and_metadata_says_test_token() {
        ctx("s2nmeme.sol2near-dev.testnet", "sol2near-dev.testnet", 0);
        let t = SandboxMeme::new(acc("sol2near-dev.testnet"), U128(1_000_000_000 * ONE));
        assert_eq!(t.ft_total_supply().0, 1_000_000_000 * ONE);
        assert_eq!(t.ft_balance_of(acc("sol2near-dev.testnet")).0, 1_000_000_000 * ONE);
        let m = t.ft_metadata();
        assert_eq!((m.decimals, m.symbol.as_str()), (18, "S2NMEME"));
        assert!(m.name.contains("NO VALUE"));
    }

    #[test]
    #[should_panic(expected = "ERR_TESTNET_OR_SANDBOX_ONLY")]
    fn refuses_a_mainnet_account() {
        ctx("s2nmeme.near", "owner.near", 0);
        SandboxMeme::new(acc("owner.near"), U128(1));
    }

    #[test]
    fn transfer_moves_exactly_the_amount_no_tax() {
        ctx("s2nmeme.test.near", "owner.test.near", 0);
        let mut t = SandboxMeme::new(acc("owner.test.near"), U128(1_000 * ONE));
        let bounds = t.storage_balance_bounds().min.as_yoctonear();
        ctx("s2nmeme.test.near", "bob.test.near", bounds);
        t.storage_deposit(None, Some(true));
        ctx("s2nmeme.test.near", "owner.test.near", 1);
        t.ft_transfer(acc("bob.test.near"), U128(123 * ONE + 7), None);
        assert_eq!(t.ft_balance_of(acc("bob.test.near")).0, 123 * ONE + 7);
        assert_eq!(t.ft_balance_of(acc("owner.test.near")).0, 1_000 * ONE - 123 * ONE - 7);
        assert_eq!(t.ft_total_supply().0, 1_000 * ONE, "supply unchanged: no burn, no fee");
    }
}
