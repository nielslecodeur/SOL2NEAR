/**
 * V4.1B — position manager logic for TreasuryV4 (contracts/treasury-v4). PURE: no network, no wallet.
 *
 * Every state shown to the user is DERIVED from contract views (get_position, get_in_flight) and Ref views
 * (get_pool_shares, mft_has_registered, predict_remove_liquidity), never from a frontend confirmation.
 * The shapes below are the contract's real JSON, checked against views captured from the real wasm in the local
 * sandbox (src/fixtures/v4_sandbox_views.json).
 *
 * Signing is DISABLED in V4.1B (`V4_SIGNING_ENABLED = false`): every gate below can be satisfied and the
 * action still stays locked. The contract remains the authority: these gates only avoid sending doomed calls.
 */
import { planV4, checkPlanGuards, v4Calls, type GuardCheck, type V4Call, type V4Calls, type V4Guards, type V4PlanPreview } from "./treasuryV4.ts";
import type { PoolSnapshot } from "./lpPlan.ts";

/** Hard switch for this checkpoint. Turning it on is a separate, reviewed change after a validated deployment. */
export const V4_SIGNING_ENABLED = false as const;
export const SIGNING_LOCKED_REASON = "Signing is disabled in V4.1B: TreasuryV4 is not deployed and validated on testnet.";
/** contracts/treasury-v4 RECONCILE_TIMEOUT_NS. */
export const RECONCILE_TIMEOUT_NS = 600n * 10n ** 9n;
const BPS = 10_000n;

// ---------- contract JSON ----------

export type V4Status =
  | "BudgetAllocated" | "AmmDepositPending" | "LpConfirmed" | "LpWithdrawPending" | "LpWithdrawn" | "Aborted"
  | { InRef: { usdc: string } } | { PreSwapCheckPending: { usdc: string } } | { SwapPending: { usdc: string } }
  | { Swapped: { usdc: string; base: string } } | { AddLiquidityPending: { usdc: string; base: string } }
  | { VerifyPending: { usdc: string; base: string; shares: string } };

export const statusName = (s: V4Status): string => (typeof s === "string" ? s : Object.keys(s)[0]!);
const statusData = (s: V4Status): Record<string, string> => (typeof s === "string" ? {} : (Object.values(s)[0] as Record<string, string>));

export interface V4Deposit {
  id: string; creator: string; amount: string; lp_budget: string; reserve: string; community: string; status: V4Status;
  plan: { swap_amount_in: string; min_swap_out: string; min_amounts: [string, string]; deadline_ns: string } | null;
  lp_shares: string; lp_verified: boolean; usdc_swapped: string; usdc_in_lp: string; base_in_lp: string;
  dust_usdc: string; dust_base: string; usdc_returned_to_reserve: string; usdc_recovered: string; base_recovered: string;
  unlock_at: string | null; dex: string; pool_id: number | null; base_token: string;
  lp_confirmed_at: string | null; lp_confirmed_block: string | null; last_error: string | null;
  marks: { stage: string; block: string; at: string }[]; created_at: string; updated_at: string;
}
export interface V4PositionView { deposit: V4Deposit; locked: boolean; lp_withdrawable: boolean; leftovers_recoverable: boolean; fuel_status: string; fuel_reason: string }
export interface V4InFlight { deposit_id: string; since: string; job: "Lp" | { Leftover: { token: string; amount: string } } }

/**
 * USDC side of a deposit, same identity as the contract tests: what is accounted for (swapped, in LP, leftovers,
 * returned to the reserve, recovered) plus what is still parked in a stage equals the LP budget.
 */
export function usdcReconciles(d: V4Deposit): boolean {
  const name = statusName(d.status);
  const accounted = BigInt(d.usdc_swapped) + BigInt(d.usdc_in_lp) + BigInt(d.dust_usdc) + BigInt(d.usdc_returned_to_reserve) + BigInt(d.usdc_recovered);
  const parked = name === "BudgetAllocated" || name === "AmmDepositPending" ? BigInt(d.lp_budget) : BigInt(statusData(d.status).usdc ?? "0");
  return accounted + parked === BigInt(d.lp_budget);
}

// ---------- UI state ----------

export type V4UiState =
  | "NOT_DEPLOYED" | "READY" | "DEPOSIT_PENDING" | "DEPOSIT_CONFIRMED" | "SWAP_PENDING" | "LP_PENDING" | "LP_CONFIRMED"
  | "LOCKED" | "WITHDRAWABLE" | "WITHDRAW_PENDING" | "WITHDRAWN" | "ABORTED" | "RECOVERY_REQUIRED" | "FAILED";

export interface DerivedState { state: V4UiState; detail: string; contractStatus: string }

const jobOf = (f: V4InFlight | null, id: string) => (f && f.deposit_id === id ? f : null);
const stuck = (f: V4InFlight, nowNs: bigint) => nowNs >= BigInt(f.since) + RECONCILE_TIMEOUT_NS;

/** State of one position, from the contract views only. */
export function positionState(v: V4PositionView, inFlight: V4InFlight | null, nowNs: bigint): DerivedState {
  const d = v.deposit;
  const name = statusName(d.status);
  const job = jobOf(inFlight, d.id);
  const err = d.last_error ? ` Last error: ${d.last_error}.` : "";
  const pendingOr = (state: V4UiState, detail: string): DerivedState =>
    job && stuck(job, nowNs)
      ? { state: "RECOVERY_REQUIRED", detail: `${detail} No callback for ${RECONCILE_TIMEOUT_NS / 1_000_000_000n} s: reconcile from Ref balances (do not resend).`, contractStatus: name }
      : { state, detail: `${detail} In flight: wait, do not resend.`, contractStatus: name };
  switch (name) {
    case "BudgetAllocated":
      return d.last_error
        ? { state: "RECOVERY_REQUIRED", detail: `LP budget still held by TreasuryV4 (never sent to Ref).${err}`, contractStatus: name }
        : { state: "DEPOSIT_CONFIRMED", detail: "Deposit counted on-chain; LP budget held by TreasuryV4.", contractStatus: name };
    case "AmmDepositPending":
    case "PreSwapCheckPending":
    case "SwapPending":
      return pendingOr("SWAP_PENDING", `${name}.`);
    case "InRef":
      return { state: "RECOVERY_REQUIRED", detail: `LP budget parked in TreasuryV4's Ref deposit, nothing swapped.${err}`, contractStatus: name };
    case "Swapped":
      return { state: "RECOVERY_REQUIRED", detail: `Both legs parked in TreasuryV4's Ref deposit, no LP added.${err}`, contractStatus: name };
    case "AddLiquidityPending":
    case "VerifyPending":
      return pendingOr("LP_PENDING", `${name}.`);
    case "LpConfirmed": {
      const unlock = d.unlock_at ? BigInt(d.unlock_at) : null;
      const verified = d.lp_verified ? "" : " UNVERIFIED: Ref views did not confirm the shares or the consumed amounts.";
      if (unlock !== null && nowNs < unlock) return { state: "LOCKED", detail: `LP confirmed, locked until ${iso(unlock)}.${verified}`, contractStatus: name };
      return { state: "WITHDRAWABLE", detail: `LP confirmed, lock over since ${unlock ? iso(unlock) : "?"}.${verified}`, contractStatus: name };
    }
    case "LpWithdrawPending":
      return { state: "WITHDRAW_PENDING", detail: "mft_transfer of the shares to the creator in flight. On failure the contract rolls back to LpConfirmed.", contractStatus: name };
    case "LpWithdrawn":
      return { state: "WITHDRAWN", detail: "Shares transferred to the creator on Ref.", contractStatus: name };
    case "Aborted":
      return { state: "ABORTED", detail: "Creator stopped the LP before it was added; funds became reserve or leftovers.", contractStatus: name };
    default:
      return { state: "FAILED", detail: `Unknown contract status ${name}.`, contractStatus: name };
  }
}

/** Journey state for the pilot card: deployment first, then the creator's last pending tx, then the chain. */
export function journeyState(i: {
  deploymentReady: boolean;
  latest: V4PositionView | null;
  inFlight: V4InFlight | null;
  nowNs: bigint;
  /** Local tx record of the last signature (none can exist in V4.1B). */
  pendingTx?: { kind: "deposit" | "execute_lp" | "withdraw_lp"; status: "submitted" | "failed" | "rejected"; detail?: string; afterDepositCount?: number };
  depositCount?: number;
}): DerivedState {
  if (!i.deploymentReady) return { state: "NOT_DEPLOYED", detail: "TreasuryV4 is not deployed and validated on testnet.", contractStatus: "-" };
  const p = i.pendingTx;
  if (p?.status === "failed") return { state: "FAILED", detail: `Last ${p.kind} failed: ${p.detail ?? "see the transaction"}. The chain state below is authoritative.`, contractStatus: "-" };
  if (p?.kind === "deposit" && p.status === "submitted" && (i.depositCount ?? 0) <= (p.afterDepositCount ?? 0))
    return { state: "DEPOSIT_PENDING", detail: "Deposit signed; waiting for the contract to count it (read from get_creator_deposits).", contractStatus: "-" };
  if (!i.latest) return { state: "READY", detail: "Deployed and validated; no position for this account yet.", contractStatus: "-" };
  return positionState(i.latest, i.inFlight, i.nowNs);
}

// ---------- withdraw_lp gate ----------

export interface WithdrawGateInput {
  network: string;
  wallet: string | null;
  view: V4PositionView;
  inFlight: V4InFlight | null;
  nowNs: bigint;
  creatorMftRegistered: boolean;
  refTreasuryShares: bigint;
  recordedShares?: bigint;
  /** Calls for the accounts of the current source (default: the planned testnet pilot). */
  calls?: V4Calls;
}
export interface Gate { ok: boolean; reasons: string[]; prerequisites: string[]; call: V4Call | null }

const isTestnetId = (id: string) => /^(([a-z\d]+[-_])*[a-z\d]+\.)+testnet$/.test(id) || /^[0-9a-f]{64}$/.test(id);

/** Mirrors withdraw_lp: creator only, LpConfirmed, lock over, no job in flight, 1 yocto; plus what makes Ref's mft_transfer fail. */
export function withdrawGate(g: WithdrawGateInput): Gate {
  const d = g.view.deposit;
  const reasons: string[] = [];
  const prerequisites: string[] = [];
  if (g.network !== "testnet") reasons.push(`Wrong network (${g.network}): TreasuryV4 withdrawals are testnet only.`);
  if (!g.wallet) reasons.push("Connect the creator's NEAR wallet.");
  else if (!isTestnetId(g.wallet)) reasons.push(`${g.wallet} is not a NEAR testnet account.`);
  else if (g.wallet !== d.creator) reasons.push(`Only the creator ${d.creator} can withdraw this LP (connected: ${g.wallet}).`);
  const name = statusName(d.status);
  if (name === "LpWithdrawPending") reasons.push("A withdrawal is already in progress.");
  else if (name === "LpWithdrawn") reasons.push("The shares were already withdrawn.");
  else if (name !== "LpConfirmed") reasons.push(`No confirmed LP (contract status ${name}).`);
  if (BigInt(d.lp_shares) === 0n) reasons.push("This position holds no LP shares.");
  if (name === "LpConfirmed" && d.unlock_at && g.nowNs < BigInt(d.unlock_at)) reasons.push(`Locked until ${iso(BigInt(d.unlock_at))}.`);
  if (g.inFlight) reasons.push(`TreasuryV4 runs another job (deposit #${g.inFlight.deposit_id}); the contract refuses withdraw_lp until it ends.`);
  if (name === "LpConfirmed" && g.refTreasuryShares < BigInt(d.lp_shares)) reasons.push("Ref reports fewer shares for TreasuryV4 than this position: the transfer would fail. Do not sign; investigate.");
  if (!g.creatorMftRegistered) prerequisites.push(`Register for the pool shares first: ${d.dex}.mft_register(":${d.pool_id}") (one transaction, ~0.01 NEAR storage).`);
  return { ok: reasons.length === 0, reasons, prerequisites, call: reasons.length === 0 ? (g.calls ?? v4Calls).withdrawLp(d.id) : null };
}

// ---------- recovery (only actions the contract really supports) ----------

export type RecoveryId = "resume_lp" | "abort_lp" | "reconcile" | "withdraw_leftover_usdc" | "withdraw_leftover_base" | "withdraw_reserve" | "withdraw_base";
export interface RecoveryAction {
  id: RecoveryId;
  title: string;
  objective: string;
  funds: string;
  preconditions: string[];
  recipient: string;
  risks: string;
  blockedBy: string[];
  call: V4Call | null;
}

export function recoveryActions(i: { view: V4PositionView; inFlight: V4InFlight | null; nowNs: bigint; wallet: string | null; reserve: bigint; baseBalance: bigint; usdcToken: string; baseToken: string; calls?: V4Calls }): RecoveryAction[] {
  const d = i.view.deposit;
  const calls = i.calls ?? v4Calls;
  const name = statusName(d.status);
  const data = statusData(d.status);
  const out: RecoveryAction[] = [];
  const common: string[] = [];
  if (i.wallet !== d.creator) common.push(`Only the creator ${d.creator} can sign this.`);
  const busy = i.inFlight ? [`TreasuryV4 runs a job (deposit #${i.inFlight.deposit_id}); the contract refuses this until it ends.`] : [];
  const add = (a: Omit<RecoveryAction, "blockedBy">, extra: string[] = []) => out.push({ ...a, blockedBy: [...common, ...busy, ...extra] });

  if (["BudgetAllocated", "InRef", "Swapped"].includes(name) && !jobOf(i.inFlight, d.id)) {
    const where = name === "BudgetAllocated" ? `${d.lp_budget} USDC-atomic held by TreasuryV4` : name === "InRef" ? `${data.usdc} USDC-atomic in TreasuryV4's Ref deposit` : `${data.usdc} USDC-atomic + ${data.base} base-atomic in TreasuryV4's Ref deposit`;
    add({
      id: "resume_lp", title: "Resume the LP with a fresh plan (execute_lp)",
      objective: "Finish this deposit's LP from its current stage. The contract re-runs its price-impact / slippage / deadline guards against Ref first.",
      funds: where, preconditions: ["A fresh quote and plan (deadline ≤ 600 s)", "≥ 200 Tgas attached (300 recommended)", "The reason it stopped is gone (e.g. impact back under 10 %)"],
      recipient: "TreasuryV4 (LP held for the creator)", risks: "If the pool still violates a guard, the funds are parked again (no loss). Never resend while a job is in flight.", call: calls.executeLp(d.id, null),
    });
    add({
      id: "abort_lp", title: "Stop this LP (abort_lp)",
      objective: name === "BudgetAllocated" ? "Return the LP budget to the creator's USDC reserve." : "Turn the parked funds into this deposit's leftovers, recoverable with withdraw_leftover.",
      funds: where, preconditions: ["No LP has been added for this deposit", "No job in flight"],
      recipient: name === "BudgetAllocated" ? "creator's reserve in TreasuryV4 (then withdraw_reserve)" : "this deposit's leftovers (then withdraw_leftover)",
      risks: "Final: the deposit becomes Aborted and cannot be resumed.", call: calls.abortLp(d.id),
    });
  }
  const job = jobOf(i.inFlight, d.id);
  if (job) {
    const due = BigInt(job.since) + RECONCILE_TIMEOUT_NS;
    const leftover = job.job !== "Lp" ? job.job.Leftover : null;
    out.push({
      id: "reconcile", title: "Reconcile a stuck job (reconcile)",
      objective: leftover
        ? "Settle a leftover withdrawal whose callback never arrived: credited only if Ref's balance really dropped, then the contract is free again."
        : "Re-derive this deposit's stage from TreasuryV4's real Ref balances when a callback never arrived.",
      funds: leftover ? `${leftover.amount} atomic of ${leftover.token} (leftover of deposit #${d.id})` : `whatever deposit #${d.id} has in flight (${name})`, preconditions: [`${RECONCILE_TIMEOUT_NS / 1_000_000_000n} s without progress (from ${iso(due)})`],
      recipient: "no transfer: only the contract's books are corrected", risks: "Permissionless and read-based; a late callback after reconcile is ignored by the contract.",
      blockedBy: i.nowNs < due ? [`Too early: allowed from ${iso(due)}. Wait; do not resend.`] : [],
      call: calls.reconcile(),
    });
  }
  const leftoverOk = ["LpConfirmed", "LpWithdrawn", "Aborted"].includes(name);
  for (const [tok, amount, id, sym] of [[i.usdcToken, d.dust_usdc, "withdraw_leftover_usdc", "USDC"], [i.baseToken, d.dust_base, "withdraw_leftover_base", "base token"]] as const) {
    if (BigInt(amount) === 0n) continue;
    add({
      id, title: `Recover the ${sym} leftover (withdraw_leftover)`,
      objective: `Move this deposit's ${sym} leftover out of TreasuryV4's Ref deposit. Counted only if Ref's balance really drops.`,
      funds: `${amount} ${sym}-atomic of deposit #${d.id}`, preconditions: ["Deposit is LpConfirmed, LpWithdrawn or Aborted", "No job in flight", "1 yocto attached"],
      recipient: sym === "USDC" ? "creator's USDC reserve in TreasuryV4 (then withdraw_reserve)" : "creator's base balance in TreasuryV4 (then withdraw_base)",
      risks: "If Ref's transfer fails, Ref re-credits it and nothing changes: retry later.", call: calls.withdrawLeftover(d.id, tok),
    }, leftoverOk ? [] : [`Not yet: contract status ${name}.`]);
  }
  if (i.reserve > 0n) add({
    id: "withdraw_reserve", title: "Withdraw the USDC reserve (withdraw_reserve)",
    objective: "Send the creator's USDC reserve (8 % of every deposit + returned budgets + recovered USDC leftovers) to the creator's wallet.",
    funds: `${i.reserve} USDC-atomic (all deposits of this creator)`, preconditions: ["Creator registered on the USDC token", "1 yocto attached"],
    recipient: "creator's wallet", risks: "On a failed transfer the contract re-credits the reserve.", call: calls.withdrawReserve(i.reserve),
  });
  if (i.baseBalance > 0n) add({
    id: "withdraw_base", title: "Withdraw recovered base token (withdraw_base)",
    objective: "Send the base token recovered from leftovers to the creator's wallet.",
    funds: `${i.baseBalance} base-atomic`, preconditions: ["Creator registered on the base token (storage_deposit)", "1 yocto attached"],
    recipient: "creator's wallet", risks: "On a failed transfer (e.g. no storage) the contract re-credits the balance.", call: calls.withdrawBase(i.baseBalance),
  });
  return out;
}

// ---------- deposit estimator ----------

export interface EstimateInput {
  amountAtomic: bigint | null;
  minDeposit: bigint;
  usdcBalance: bigint | null;
  creatorUsdcRegistered: boolean | null;
  pool: (PoolSnapshot & { shares_total_supply?: string }) | null;
  usdcToken: string;
  /** Ref get_return for the planned swap, read live. Null when no live pool exists. */
  quotedOut: bigint | null;
  adminFeeBps: number | null;
  guards: V4Guards;
  nowNs: bigint;
  slippageBps: number;
}
export interface Estimate {
  problems: string[];
  split: { lp: bigint; reserve: bigint; community: bigint } | null;
  plan: V4PlanPreview | null;
  guards: GuardCheck[];
  quoteMatches: boolean | null;
  estimatedShares: bigint | null;
  estimatedLeftovers: [bigint, bigint] | null;
  lpFeeShareBps: number | null;
}

/** Same arithmetic as ledger::split (9000 / 800 / rest). */
export const splitV4 = (a: bigint) => ({ lp: (a * 9000n) / BPS, reserve: (a * 800n) / BPS, community: a - (a * 9000n) / BPS - (a * 800n) / BPS });

export function estimateDeposit(i: EstimateInput): Estimate {
  const problems: string[] = [];
  const empty: Estimate = { problems, split: null, plan: null, guards: [], quoteMatches: null, estimatedShares: null, estimatedLeftovers: null, lpFeeShareBps: null };
  if (i.amountAtomic === null || i.amountAtomic <= 0n) { problems.push("Enter a positive USDC amount (max 6 decimals)."); return empty; }
  if (i.amountAtomic < i.minDeposit) problems.push(`Below the TreasuryV4 minimum deposit (${i.minDeposit} atomic): the contract would refund it.`);
  if (i.creatorUsdcRegistered === false) problems.push("The wallet is not registered on the USDC token (storage missing): it cannot hold or send USDC.");
  if (i.usdcBalance !== null && i.amountAtomic > i.usdcBalance) problems.push("Amount exceeds the wallet's USDC balance.");
  const split = splitV4(i.amountAtomic);
  if (!i.pool) { problems.push("No live pool to quote: TreasuryV4 and its pool are not deployed."); return { ...empty, split }; }
  let plan: V4PlanPreview;
  try {
    plan = planV4(i.pool, i.usdcToken, split.lp, i.nowNs, { slippageBps: i.slippageBps, ttlNs: i.guards.maxPlanTtlNs / 2n });
  } catch (e) {
    problems.push(`No valid plan for this pool: ${(e as Error).message}`);
    return { ...empty, split };
  }
  const quoted = i.quotedOut ?? plan.expectedBaseOut;
  const guards = checkPlanGuards(plan, quoted, i.nowNs, i.guards);
  for (const g of guards) if (!g.ok) problems.push(`Contract guard would refuse: ${g.detail}.`);
  // Ref simple pool: shares = min_i(amount_i * total_supply / reserve_i) on the reserves after our swap. Estimate only.
  let estimatedShares: bigint | null = null;
  let estimatedLeftovers: [bigint, bigint] | null = null;
  if (i.pool.shares_total_supply) {
    const iu = i.pool.token_account_ids.indexOf(i.usdcToken);
    const r = [BigInt(i.pool.amounts[0]), BigInt(i.pool.amounts[1])];
    r[iu] = r[iu]! + plan.swapUsdcIn;
    r[1 - iu] = r[1 - iu]! - plan.expectedBaseOut;
    const total = BigInt(i.pool.shares_total_supply);
    const s0 = (plan.provided[0] * total) / r[0]!;
    const s1 = (plan.provided[1] * total) / r[1]!;
    estimatedShares = s0 < s1 ? s0 : s1;
    estimatedLeftovers = [plan.provided[0] - (estimatedShares * r[0]!) / total, plan.provided[1] - (estimatedShares * r[1]!) / total];
  }
  return {
    problems, split, plan, guards,
    quoteMatches: i.quotedOut === null ? null : i.quotedOut === plan.expectedBaseOut,
    estimatedShares, estimatedLeftovers,
    lpFeeShareBps: i.adminFeeBps === null ? null : Math.round((i.pool.total_fee * (10_000 - i.adminFeeBps)) / 10_000),
  };
}

// ---------- value of a Classic position ----------

/**
 * Classic LP fees are not a separate claimable balance: they stay inside the pool and raise what each share
 * redeems. `predict_remove_liquidity(shares)` gives what the shares redeem NOW; the difference with what entered
 * the pool mixes fees AND price moves (impermanent loss). It is never a profit figure.
 */
export function valueChange(d: V4Deposit, predictRemove: [string, string] | null, usdcIndex: number): { now: [bigint, bigint]; entered: [bigint, bigint]; delta: [bigint, bigint] } | null {
  if (!predictRemove) return null;
  const now: [bigint, bigint] = [BigInt(predictRemove[0]), BigInt(predictRemove[1])];
  const entered: [bigint, bigint] = usdcIndex === 0 ? [BigInt(d.usdc_in_lp), BigInt(d.base_in_lp)] : [BigInt(d.base_in_lp), BigInt(d.usdc_in_lp)];
  return { now, entered, delta: [now[0] - entered[0], now[1] - entered[1]] };
}

/** Signing gate for any V4 action. Locked by construction in V4.1B. */
export function signingGate(i: { deploymentReady: boolean; network: string; wallet: string | null }): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!V4_SIGNING_ENABLED) reasons.push(SIGNING_LOCKED_REASON);
  if (!i.deploymentReady) reasons.push("TreasuryV4 is not deployed and validated on testnet.");
  if (i.network !== "testnet") reasons.push(`Wrong network: ${i.network}.`);
  if (!i.wallet) reasons.push("No NEAR wallet connected.");
  return { allowed: reasons.length === 0, reasons };
}

export const iso = (ns: bigint) => new Date(Number(ns / 1_000_000n)).toISOString().replace(".000Z", "Z");
