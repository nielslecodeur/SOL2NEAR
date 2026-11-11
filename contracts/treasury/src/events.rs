//! NEP-297 style events: `EVENT_JSON:{"standard":"sol2near",...}`.
//! "sol2near" is our own namespace, not an external standard.
use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "sol2near",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}
