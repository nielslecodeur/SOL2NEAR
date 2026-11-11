import { test } from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "./demo.ts";

// The demo must obey the same accounting the contracts enforce, or it would mislead.
test("demo data respects contract invariants", () => {
  const s = demoSnapshot();
  assert.equal(s.source, "demo");
  for (const d of s.deposits) {
    assert.equal(BigInt(d.lp_budget) + BigInt(d.reserve) + BigInt(d.community), BigInt(d.amount), `90/8/2 conserves deposit ${d.id}`);
    if (d.status !== "LpConfirmed") assert.equal(s.positions[d.id], null, "unconfirmed LP never earns");
  }
  const b = s.reactor!.buckets;
  const n = (x: string) => BigInt(x);
  assert.equal(n(b.pol_available) + n(b.pol_committed) + n(b.pol_distributed) + n(b.community_reserve), 600_000n * 10n ** 18n);
  assert.equal(n(b.contract_balance), n(b.pol_available) + n(b.pol_committed) + n(b.community_reserve) + n(b.burn_reserve) + n(b.team_locked));
  assert.equal(n(b.total_supply) + n(b.burned_total), 1_000_000n * 10n ** 18n);
});
