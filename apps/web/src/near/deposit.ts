/**
 * Direct NEAR deposit into the Treasury (path A). Contract facts (contracts/treasury/src):
 * - entry point: usdc.ft_transfer_call(receiver_id = Treasury, amount, msg = '{"action":"deposit"}'), 1 yocto;
 * - Treasury.ft_on_transfer refuses (and the token refunds 100 %) on: wrong token, not ready, bad msg,
 *   amount < min_deposit; otherwise records a deposit for sender_id and emits `deposit_allocated`;
 * - split (ledger.rs): lp = floor(A*lp_bps/10000), reserve = floor(A*reserve_bps/10000), community = rest.
 */
import { parseUnits } from "../format.ts";
import { GAS, MIN_NEAR_FOR_GAS, ONE_YOCTO, TREASURY_ACCOUNT_ID, USDC_DECIMALS, USDC_TOKEN_ID, isTestnetAccount } from "./config.ts";
import { eventsFrom, parseOutcome, type TxOutcome } from "./outcome.ts";
import type { NearRpc } from "./rpc.ts";

export const DEPOSIT_MSG = JSON.stringify({ action: "deposit" });

/** A function call, independent of any wallet library. */
export interface TxCall {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: bigint;
  deposit: bigint;
}

export interface TreasuryConfigView {
  config: { usdc_token: string; min_deposit: string; pool_id: number; lp_lock_duration_ns: string };
  lp_bps: number;
  reserve_bps: number;
  community_bps: number;
  ready: boolean;
}

export interface Split { lp: bigint; reserve: bigint; community: bigint }

/** Same arithmetic as ledger::split, with the bps read from the deployed contract's get_config. */
export function previewSplit(amount: bigint, cfg: Pick<TreasuryConfigView, "lp_bps" | "reserve_bps">): Split {
  const lp = (amount * BigInt(cfg.lp_bps)) / 10_000n;
  const reserve = (amount * BigInt(cfg.reserve_bps)) / 10_000n;
  return { lp, reserve, community: amount - lp - reserve };
}

/** Everything read before allowing a deposit. */
export interface DepositContext {
  accountId: string | null;
  nearBalance: bigint | null;
  usdcBalance: bigint | null;
  /** storage_balance_of(sender) on the USDC contract (null = not registered). */
  senderRegistered: boolean;
  /** storage_balance_of(Treasury) on the USDC contract. */
  treasuryRegistered: boolean;
  cfg: TreasuryConfigView | null;
  /** Token the user picked (the UI offers only USDC, but the check is explicit). */
  tokenId: string;
  treasuryId: string;
}

export async function loadDepositContext(rpc: NearRpc, accountId: string | null): Promise<DepositContext> {
  const cfg = await rpc.view<TreasuryConfigView>(TREASURY_ACCOUNT_ID, "get_config");
  const treasuryRegistered = (await rpc.view<unknown>(USDC_TOKEN_ID, "storage_balance_of", { account_id: TREASURY_ACCOUNT_ID })) !== null;
  if (!accountId) return { accountId, nearBalance: null, usdcBalance: null, senderRegistered: false, treasuryRegistered, cfg, tokenId: USDC_TOKEN_ID, treasuryId: TREASURY_ACCOUNT_ID };
  const [nearBalance, usdc, reg] = await Promise.all([
    rpc.nearBalance(accountId),
    rpc.view<string>(USDC_TOKEN_ID, "ft_balance_of", { account_id: accountId }),
    rpc.view<unknown>(USDC_TOKEN_ID, "storage_balance_of", { account_id: accountId }),
  ]);
  return { accountId, nearBalance, usdcBalance: BigInt(usdc), senderRegistered: reg !== null, treasuryRegistered, cfg, tokenId: USDC_TOKEN_ID, treasuryId: TREASURY_ACCOUNT_ID };
}

export type DepositCheck = { ok: true; amount: bigint; split: Split; call: TxCall } | { ok: false; problems: string[] };

/** Pure: validates the user input against the live context and builds the exact call, or says why not. */
export function checkDeposit(input: string, ctx: DepositContext): DepositCheck {
  const problems: string[] = [];
  const parsed = parseUnits(input, USDC_DECIMALS);
  const atomic = parsed === null ? null : BigInt(parsed);
  if (!ctx.accountId) problems.push("Connect a NEAR testnet wallet first.");
  else if (!isTestnetAccount(ctx.accountId)) problems.push(`${ctx.accountId} is not a testnet account: mainnet is never used here.`);
  if (ctx.tokenId !== USDC_TOKEN_ID || (ctx.cfg && ctx.cfg.config.usdc_token !== ctx.tokenId))
    problems.push(`The Treasury accepts only ${ctx.cfg?.config.usdc_token ?? USDC_TOKEN_ID}, not ${ctx.tokenId}.`);
  if (ctx.treasuryId !== TREASURY_ACCOUNT_ID) problems.push(`Unexpected recipient ${ctx.treasuryId}: deposits go only to ${TREASURY_ACCOUNT_ID}.`);
  if (!ctx.cfg) problems.push("Treasury config could not be read.");
  else if (!ctx.cfg.ready) problems.push("The Treasury is not ready (setup not done): it would refund the deposit.");
  if (!ctx.treasuryRegistered) problems.push("The Treasury has no storage on the USDC contract: the transfer would fail.");
  if (ctx.accountId && !ctx.senderRegistered) problems.push("Your account is not registered on the USDC contract, so it cannot hold USDC yet.");
  if (atomic === null) problems.push("Enter a positive amount with at most 6 decimals (e.g. 10 or 2.5).");
  if (atomic !== null && ctx.cfg && atomic < BigInt(ctx.cfg.config.min_deposit))
    problems.push(`Minimum deposit is ${Number(BigInt(ctx.cfg.config.min_deposit)) / 1e6} USDC: below it the Treasury refunds.`);
  if (atomic !== null && ctx.usdcBalance !== null && atomic > ctx.usdcBalance) problems.push("Amount exceeds your USDC balance.");
  if (ctx.nearBalance !== null && ctx.nearBalance < MIN_NEAR_FOR_GAS) problems.push("Not enough NEAR for gas (keep at least 0.02 NEAR).");
  if (problems.length || atomic === null || !ctx.cfg) return { ok: false, problems };
  return { ok: true, amount: atomic, split: previewSplit(atomic, ctx.cfg), call: depositCall(atomic) };
}

export function depositCall(amount: bigint): TxCall {
  return {
    receiverId: USDC_TOKEN_ID,
    methodName: "ft_transfer_call",
    args: { receiver_id: TREASURY_ACCOUNT_ID, amount: amount.toString(), msg: DEPOSIT_MSG },
    gas: GAS.ft_transfer_call,
    deposit: ONE_YOCTO,
  };
}

export type DepositVerdict =
  | { kind: "counted"; depositId: string; used: string; refunded: string; lp: string; reserve: string; community: string }
  | { kind: "refused"; reason: string; refunded: string }
  | { kind: "refunded"; refunded: string; detail: string }
  | { kind: "failed"; detail: string }
  | { kind: "mismatch"; detail: string };

/**
 * Reads the final outcome of a deposit tx. Only events emitted by the Treasury itself count; the amount
 * actually taken is the ft_transfer_call return value (`used`), the rest was refunded by the token.
 */
export function analyzeDeposit(o: TxOutcome, expected: { sender: string; amount: bigint }): DepositVerdict {
  const p = parseOutcome(o);
  if (p.signer !== expected.sender) return { kind: "mismatch", detail: `signed by ${p.signer}, expected ${expected.sender}` };
  if (p.receiver !== USDC_TOKEN_ID) return { kind: "mismatch", detail: `sent to ${p.receiver}, expected ${USDC_TOKEN_ID}` };
  if (!p.ok) return { kind: "failed", detail: p.failures[0]?.message ?? "transaction failed" };
  const used = typeof p.returnValue === "string" && /^\d+$/.test(p.returnValue) ? BigInt(p.returnValue) : null;
  if (used === null) return { kind: "mismatch", detail: "ft_transfer_call returned no amount" };
  const refunded = (expected.amount - used).toString();
  const allocated = eventsFrom(p, TREASURY_ACCOUNT_ID, "deposit_allocated");
  const refused = eventsFrom(p, TREASURY_ACCOUNT_ID, "deposit_refused");
  if (refused.length) return { kind: "refused", reason: String(refused[0]!.reason), refunded };
  if (allocated.length === 1 && used === expected.amount) {
    const d = allocated[0]!;
    if (d.creator !== expected.sender || d.amount !== expected.amount.toString())
      return { kind: "mismatch", detail: `Treasury recorded ${String(d.amount)} for ${String(d.creator)}` };
    return { kind: "counted", depositId: String(d.deposit_id), used: used.toString(), refunded, lp: String(d.lp_budget), reserve: String(d.reserve), community: String(d.community) };
  }
  if (used === 0n) return { kind: "refunded", refunded, detail: p.failures[0]?.message ?? "Treasury did not accept the transfer" };
  return { kind: "mismatch", detail: `token used ${used} of ${expected.amount} without a matching Treasury event` };
}

/** Second, independent check: the deposit exists in Treasury state with the same creator and amount. */
export async function confirmInTreasury(rpc: NearRpc, depositId: string, sender: string, used: string) {
  const d = await rpc.view<{ creator: string; amount: string; status: unknown } | null>(TREASURY_ACCOUNT_ID, "get_deposit", { deposit_id: depositId });
  if (!d) return { ok: false as const, detail: `Treasury has no deposit #${depositId}` };
  if (d.creator !== sender || d.amount !== used) return { ok: false as const, detail: `deposit #${depositId} is ${d.amount} for ${d.creator}` };
  return { ok: true as const, status: d.status };
}

/**
 * A bridge is only useful for path B if what is GUARANTEED to arrive on NEAR (the quote's minAmountOut) can be
 * deposited: the Treasury refunds anything below `min_deposit` (G7: 1 USDC sent from Solana yields ~0.9974).
 */
export function bridgeCoversTreasuryMin(minAmountOut: string, minDeposit: string): boolean {
  return BigInt(minAmountOut) >= BigInt(minDeposit);
}
