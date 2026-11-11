//! Pure allocation arithmetic (no NEAR env). Spec V3 §4.2:
//! LP = floor(A*9000/10000), Reserve = floor(A*800/10000), Community = A - LP - Reserve.

pub const BPS_DENOM: u128 = 10_000;
pub const LP_BPS: u128 = 9_000;
pub const RESERVE_BPS: u128 = 800;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Split {
    pub lp: u128,
    pub reserve: u128,
    pub community: u128,
}

/// Deterministic 90/8/2 split in atomic units. Always conserves the total.
pub fn split(amount: u128) -> Split {
    let lp = amount
        .checked_mul(LP_BPS)
        .expect("ERR_AMOUNT_OVERFLOW")
        / BPS_DENOM;
    let reserve = amount * RESERVE_BPS / BPS_DENOM;
    let community = amount - lp - reserve;
    Split { lp, reserve, community }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_example_20_usdc() {
        // 20 USDC with 6 decimals
        let s = split(20_000_000);
        assert_eq!(s.lp, 18_000_000);
        assert_eq!(s.reserve, 1_600_000);
        assert_eq!(s.community, 400_000);
    }

    #[test]
    fn rounding_residue_goes_to_community() {
        assert_eq!(split(1), Split { lp: 0, reserve: 0, community: 1 });
        assert_eq!(split(7), Split { lp: 6, reserve: 0, community: 1 });
        assert_eq!(split(13), Split { lp: 11, reserve: 1, community: 1 });
        assert_eq!(split(0), Split { lp: 0, reserve: 0, community: 0 });
    }

    #[test]
    fn total_is_always_conserved() {
        for a in (0u128..20_000).chain([999_999, 1_000_001, 123_456_789_012, u64::MAX as u128]) {
            let s = split(a);
            assert_eq!(s.lp + s.reserve + s.community, a, "amount {a}");
            assert!(s.community <= a / 50 + 2, "community share too large for {a}");
        }
    }

    #[test]
    #[should_panic(expected = "ERR_AMOUNT_OVERFLOW")]
    fn overflow_is_rejected() {
        split(u128::MAX);
    }
}
