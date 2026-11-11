//! External interfaces. Ref method names/guards were probed on the deployed
//! ref-finance-101.testnet v1.9.19 wasm (see docs/FEASIBILITY.md §4.1).
use crate::types::{PoolInfo, SwapAction};
use near_sdk::json_types::U128;
use near_sdk::{ext_contract, AccountId};
use std::collections::HashMap;

#[allow(dead_code)]
#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> U128;
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[allow(dead_code)]
#[ext_contract(ext_ref)]
pub trait RefExchange {
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    /// Requires exactly 1 yocto (verified).
    fn register_tokens(&mut self, token_ids: Vec<AccountId>);
    fn swap(&mut self, actions: Vec<SwapAction>, referral_id: Option<AccountId>) -> U128;
    /// Requires >= 1 yocto (E35, verified). Returns minted shares.
    fn add_liquidity(&mut self, pool_id: u64, amounts: Vec<U128>, min_amounts: Option<Vec<U128>>) -> U128;
    /// Requires exactly 1 yocto (verified). Pool shares token id is ":<pool_id>".
    fn mft_transfer(&mut self, token_id: String, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn get_pool(&self, pool_id: u64) -> PoolInfo;
    fn get_pool_shares(&self, pool_id: u64, account_id: AccountId) -> U128;
    fn get_deposits(&self, account_id: AccountId) -> HashMap<AccountId, U128>;
}
