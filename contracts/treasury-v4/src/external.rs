//! External interfaces. Ref methods are the ones already used by the deployed V3 Treasury, plus
//! `get_return` (read by the dashboard since V4.0) and `withdraw` (exercised in the local sandbox run
//! against the real ref-finance-101.testnet wasm, see docs/V4_1_EXECUTION.md).
use crate::types::{PoolInfo, SwapAction};
use near_sdk::json_types::U128;
use near_sdk::serde_json::Value;
use near_sdk::{ext_contract, AccountId};
use std::collections::HashMap;

#[allow(dead_code)]
#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn ft_metadata(&self) -> Value;
}

#[allow(dead_code)]
#[ext_contract(ext_ref)]
pub trait RefExchange {
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn register_tokens(&mut self, token_ids: Vec<AccountId>);
    fn swap(&mut self, actions: Vec<SwapAction>, referral_id: Option<AccountId>) -> U128;
    fn add_liquidity(&mut self, pool_id: u64, amounts: Vec<U128>, min_amounts: Option<Vec<U128>>) -> U128;
    fn mft_transfer(&mut self, token_id: String, receiver_id: AccountId, amount: U128, memo: Option<String>);
    /// Sends `amount` of the caller's internal deposit back to the caller (1 yocto). On a failed
    /// transfer Ref credits the deposit back, so success is judged from get_deposits afterwards.
    fn withdraw(&mut self, token_id: AccountId, amount: U128, unregister: Option<bool>, skip_unwrap_near: Option<bool>);
    fn get_pool(&self, pool_id: u64) -> PoolInfo;
    fn get_return(&self, pool_id: u64, token_in: AccountId, amount_in: U128, token_out: AccountId) -> U128;
    fn get_pool_shares(&self, pool_id: u64, account_id: AccountId) -> U128;
    fn get_deposits(&self, account_id: AccountId) -> HashMap<AccountId, U128>;
}
