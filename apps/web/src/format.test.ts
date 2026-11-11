import { test } from "node:test";
import assert from "node:assert/strict";
import { bridgeTone, depositStatus, duration, formatUnits, fuel, pct, usdc } from "./format.ts";

test("formatUnits is exact on large atomic values", () => {
  assert.equal(usdc("18000000"), "18");
  assert.equal(usdc("1600001"), "1.6");
  assert.equal(fuel("600000000000000000000000"), "600,000");
  assert.equal(formatUnits("123456789012345678901234567", 24, 6), "123.456789");
  assert.equal(formatUnits("0", 6), "0");
  assert.equal(formatUnits(-1500000n, 6), "-1.5");
});

test("pct clamps and handles zero", () => {
  assert.equal(pct("5", "10"), 50);
  assert.equal(pct("15", "10"), 100);
  assert.equal(pct("1", "0"), 0);
});

test("duration", () => {
  assert.equal(duration(90n * 1_000_000_000n), "1m 30s");
  assert.equal(duration(0n), "0s");
  assert.equal(duration(BigInt(2 * 86400 + 3600) * 1_000_000_000n), "2d 1h");
});

test("statuses never show unconfirmed LP as confirmed", () => {
  assert.equal(depositStatus("LpConfirmed", null).tone, "confirmed");
  assert.equal(depositStatus({ SwapPending: { usdc: "1" } }, null).tone, "pending");
  assert.equal(depositStatus({ InRef: { usdc: "1" } }, "swap_failed").tone, "failed");
  assert.equal(depositStatus("BudgetAllocated", null).tone, "neutral");
  assert.equal(bridgeTone("REFUNDED"), "refunded");
  assert.equal(bridgeTone("PROCESSING"), "pending");
});
