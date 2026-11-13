// READ-ONLY live check against Tidepool: health, route listing, one DRY quote. No key, no signature,
// no deposit address is ever created. Usage: pnpm --filter @sol2near/crosschain live:dry
// Optional env: SOLANA_REFUND_ADDRESS (base58), NEAR_RECIPIENT, AMOUNT_ATOMIC.
import { createTidepoolClient } from "../src/index.ts";

const c = createTidepoolClient();
const refund = process.env.SOLANA_REFUND_ADDRESS ?? "7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr"; // mint as placeholder, dry only
const recipient = process.env.NEAR_RECIPIENT ?? "sol2near-dev.testnet";
const amountAtomic = process.env.AMOUNT_ATOMIC ?? "1000000";

try {
  const h = await c.health();
  console.log(`${h.ok && h.solanaRouteOk ? "PASS" : "FAIL"} health ok=${h.ok} solanaRouteOk=${h.solanaRouteOk}`);
  await c.assertRouteSupported();
  console.log("PASS route listed: Solana devnet USDC (6) -> NEAR testnet USDC (6)");
  const q = await c.quote({ amountAtomic, solanaRefundAddress: refund, nearRecipient: recipient }, { dry: true });
  const cost = BigInt(q.amountIn) - BigInt(q.amountOut);
  console.log(`PASS dry quote ${q.amountIn} -> ${q.amountOut} (min ${q.minAmountOut}), quoted cost ${cost} atomic, ~${q.timeEstimateSec}s, correlationId ${q.correlationId}`);
} catch (e) {
  console.log(`FAIL ${(e as Error).name}: ${(e as Error).message}`);
  process.exitCode = 1;
}
