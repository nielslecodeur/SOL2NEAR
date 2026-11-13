/**
 * Bridge → Receive → Deposit → Liquidity → FUEL, each with a state derived ONLY from what was read
 * on-chain (or recorded from a verified outcome). Pure function: no network, fully testable.
 */
import type { DepositStatus, TreasuryDeposit } from "../../../../packages/shared/src/treasury.ts";
import type { TransferRecord } from "../../../../packages/crosschain/src/store.ts";
import type { FuelPosition } from "../chain.ts";
import type { TxRecord } from "./history.ts";

export type StepState = "NOT_STARTED" | "READY" | "PENDING" | "CONFIRMED" | "FAILED" | "BLOCKED";
export interface Step { name: "Bridge" | "Receive" | "Deposit" | "Liquidity" | "FUEL"; state: StepState; detail: string }

export interface PipelineInput {
  accountId: string | null;
  /** Latest cross-chain transfer whose NEAR recipient is this account (path B), if any. */
  transfer: TransferRecord | null;
  tidepoolReachable: boolean | null;
  usdcBalance: bigint | null;
  /** The deposit the pipeline is about (latest of this creator), read from Treasury. */
  deposit: TreasuryDeposit | null;
  /** Unresolved dashboard transactions of this account. */
  openTx: TxRecord[];
  /** Another creator's LP job is running in the Treasury (single job at a time). */
  treasuryBusy: boolean;
  position: FuelPosition | null;
}

const statusName = (s: DepositStatus) => (typeof s === "string" ? s : Object.keys(s)[0]!);
const usdc = (a: bigint | string) => (Number(BigInt(a)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

export function pipeline(i: PipelineInput): Step[] {
  const open = (kind: TxRecord["kind"]) => i.openTx.some((t) => t.kind === kind);
  const t = i.transfer;

  let bridge: Step;
  if (!t) bridge = { name: "Bridge", state: i.tidepoolReachable === false ? "BLOCKED" : "NOT_STARTED", detail: i.tidepoolReachable === false ? "Tidepool unreachable from this network (path B). Path A works without it." : "Optional: only for USDC coming from Solana (path B)." };
  else if (t.stage === "solana_failed" || t.stage === "bridge_failed") bridge = { name: "Bridge", state: "FAILED", detail: t.stage === "solana_failed" ? "Solana deposit failed on-chain: nothing was bridged." : "Tidepool reported FAILED." };
  else if (t.stage === "bridge_refunded") bridge = { name: "Bridge", state: "FAILED", detail: `Refunded to Solana${t.result?.refundedAmount ? `: ${usdc(t.result.refundedAmount)} USDC` : ""}.` };
  else if (t.stage === "bridge_success" || t.stage === "near_verified") bridge = { name: "Bridge", state: "CONFIRMED", detail: `${usdc(t.quote.amountIn)} USDC bridged from Solana devnet.` };
  else bridge = { name: "Bridge", state: "PENDING", detail: t.stage === "signing" ? "Waiting for the Solana wallet (or interrupted)." : "In progress on Tidepool." };

  let receive: Step;
  if (t?.stage === "near_verified") receive = { name: "Receive", state: "CONFIRMED", detail: `${usdc(t.nearReceived!)} USDC verified on ${t.quote.nearRecipient} (balance increase).` };
  else if (t?.stage === "bridge_success") receive = { name: "Receive", state: "PENDING", detail: "Tidepool says SUCCESS; checking the NEAR balance." };
  else if (i.usdcBalance !== null && i.usdcBalance > 0n) receive = { name: "Receive", state: "READY", detail: `${usdc(i.usdcBalance)} USDC on NEAR (path A: origin of these funds is not proven to be Solana).` };
  else receive = { name: "Receive", state: "NOT_STARTED", detail: i.accountId ? "No NEAR testnet USDC on this account." : "Connect a NEAR wallet." };

  const d = i.deposit;
  let deposit: Step;
  if (open("deposit")) deposit = { name: "Deposit", state: "PENDING", detail: "Deposit transaction awaiting signature or verification." };
  else if (d) deposit = { name: "Deposit", state: "CONFIRMED", detail: `Deposit #${d.id}: ${usdc(d.amount)} USDC counted by the Treasury (LP ${usdc(d.lp_budget)} / reserve ${usdc(d.reserve)} / community ${usdc(d.community)}).` };
  else if (receive.state === "READY" || receive.state === "CONFIRMED") deposit = { name: "Deposit", state: "READY", detail: "Deposit your NEAR USDC into the Treasury." };
  else deposit = { name: "Deposit", state: "NOT_STARTED", detail: "Needs USDC on NEAR first." };

  let liquidity: Step;
  if (!d) liquidity = { name: "Liquidity", state: "NOT_STARTED", detail: "Needs a Treasury deposit." };
  else {
    const s = statusName(d.status);
    if (s === "LpConfirmed" || s === "LpWithdrawPending" || s === "LpWithdrawn")
      liquidity = { name: "Liquidity", state: "CONFIRMED", detail: `${usdc(d.usdc_in_lp)} USDC in Ref pool ${d.pool_id}; ${d.lp_verified ? "shares verified on-chain" : "shares NOT verified"}${s === "LpWithdrawn" ? " (withdrawn since)" : ""}.` };
    else if (open("execute_lp")) liquidity = { name: "Liquidity", state: "PENDING", detail: "execute_lp awaiting signature or verification." };
    else if (s.endsWith("Pending")) liquidity = { name: "Liquidity", state: "PENDING", detail: `Treasury step ${s} in flight.` };
    else if (i.treasuryBusy) liquidity = { name: "Liquidity", state: "BLOCKED", detail: "Another LP job is running in the Treasury; retry when it ends." };
    else if (d.last_error) liquidity = { name: "Liquidity", state: "FAILED", detail: `Stopped at ${s}: ${d.last_error}. Resumable with execute_lp.` };
    else liquidity = { name: "Liquidity", state: "READY", detail: s === "BudgetAllocated" ? `Deploy ${usdc(d.lp_budget)} USDC into Ref (execute_lp, you sign).` : `Resume from ${s} (execute_lp).` };
  }

  let fuel: Step;
  const p = i.position;
  if (liquidity.state !== "CONFIRMED") fuel = { name: "FUEL", state: "NOT_STARTED", detail: "Needs confirmed LP." };
  else if (open("register_position") || open("claim")) fuel = { name: "FUEL", state: "PENDING", detail: "FUEL transaction awaiting signature or verification." };
  else if (!p) fuel = { name: "FUEL", state: d!.lp_verified ? "READY" : "BLOCKED", detail: d!.lp_verified ? "Register now (Proof of Liquidity): it only counts if registered before the season of its LP confirmation ends (+5 min grace), else FUEL rejects it (ERR_SEASON_CLOSED)." : "LP not verified: FUEL would reject it." };
  else switch (p.reward_status) {
    case "Pending": fuel = { name: "FUEL", state: "PENDING", detail: `Admitted in season ${p.position.season_id}; reward not earned until the season closes with SUCCESS.` }; break;
    case "Locked": fuel = { name: "FUEL", state: "PENDING", detail: "Season succeeded; LP lock still running." }; break;
    case "Claimable": fuel = { name: "FUEL", state: "READY", detail: "Reward claimable." }; break;
    case "Claimed": fuel = { name: "FUEL", state: "CONFIRMED", detail: "Reward claimed." }; break;
    case "Forfeited": fuel = { name: "FUEL", state: "FAILED", detail: "Season failed: reward forfeited." }; break;
    default: fuel = { name: "FUEL", state: "FAILED", detail: "Admitted, but no reward was left (cap / budget)." };
  }
  return [bridge, receive, deposit, liquidity, fuel];
}
