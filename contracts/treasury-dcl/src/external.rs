//! External interfaces. Every Rhea DCL method and argument name below was exercised against the REAL
//! dclv2.ref-labs.near v2.4.2 wasm in the local sandbox (sandbox-tests/tests/v42_dcl_explore.rs); the DCL
//! source is not public, so nothing here is taken from documentation alone.
use crate::types::{DclLiquidityRow, DclLiquidityView, DclPoolView, DclQuote};
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
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
    /// Nearly tax tokens only (absent elsewhere: the promise fails, which means "no Nearly tax").
    fn get_tax(&self) -> Value;
}

#[allow(dead_code)]
#[ext_contract(ext_dcl)]
pub trait RheaDcl {
    /// ≥ 0.5 NEAR (storage_balance_bounds.min on v2.4.2).
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    /// v2.4.2: a user must register each token (paid storage) or its deposits are refunded.
    fn register_tokens(&mut self, token_ids: Vec<AccountId>);
    fn get_pool(&self, pool_id: String) -> DclPoolView;
    fn quote(&self, pool_ids: Vec<String>, input_token: AccountId, output_token: AccountId, input_amount: U128, tag: Option<String>) -> DclQuote;
    /// Simulates a HotZap: `[[{need_x, need_y, liquidity_amount}], {token: left}]`.
    fn predict_hotzap(&self, token_in: AccountId, amount_in: U128, swap_infos: Value, add_liquidity_infos: Value) -> Value;
    fn list_liquidities(&self, account_id: AccountId, from_index: Option<u64>, limit: Option<u64>) -> Vec<DclLiquidityRow>;
    fn get_liquidity(&self, lpt_id: String) -> Option<DclLiquidityRow>;
    fn get_liquidity_view(&self, lpt_id: String) -> Option<DclLiquidityView>;
    fn list_user_assets(&self, account_id: AccountId) -> HashMap<AccountId, U128>;
    fn get_user_asset(&self, account_id: AccountId, token_id: AccountId) -> Option<U128>;
    /// amount 0 = claim the position's fees into the caller's DCL account (returns [fee_x, fee_y]).
    fn remove_liquidity(&mut self, lpt_id: String, amount: U128, min_amount_x: U128, min_amount_y: U128, skip_refund_transfer: Option<bool>) -> Vec<U128>;
    /// No attached deposit (v2.4.2 refuses one). Returns true.
    fn withdraw_asset(&mut self, token_id: AccountId, amount: Option<U128>, skip_unwrap_near: Option<bool>) -> bool;
    /// NEP-171, exactly 1 yocto. The previous owner can no longer remove liquidity (E215).
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>);
}
