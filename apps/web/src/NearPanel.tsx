// "Your account" on NEAR testnet: wallet, the 5-step pipeline, the Treasury deposit (path A) and the
// follow-up calls (execute_lp, register_position, claim). Every success shown here comes from a final
// on-chain outcome (and, for deposits, from Treasury state), never from the wallet having signed.
import { useEffect, useMemo, useRef, useState } from "react";
import type { TreasuryDeposit } from "../../../packages/shared/src/treasury.ts";
import { webStorageStore, type TransferRecord } from "../../../packages/crosschain/src/store.ts";
import type { FuelPosition, Season } from "./chain.ts";
import { formatUnits, fuel as fmtFuel, toDecimalString, usdc } from "./format.ts";
import {
  analyzeAction, claimCall, closeSeasonCall, executeLpCall, fuelStorageCall, planLp, registerPositionCall, type ActionKind,
} from "./near/actions.ts";
import { FUEL_ACCOUNT_ID, MIN_NEAR_FOR_GAS, TREASURY_ACCOUNT_ID, USDC_TOKEN_ID, explorerTx } from "./near/config.ts";
import {
  analyzeDeposit, checkDeposit, confirmInTreasury, loadDepositContext, type DepositContext, type TxCall,
} from "./near/deposit.ts";
import { applyWalletReturn, isOpen, parseWalletReturn, txHistory, type TxKind, type TxRecord } from "./near/history.ts";
import { fuelWindow, pipeline, type FuelCalendar, type StepState } from "./near/pipeline.ts";
import { nearRpc } from "./near/rpc.ts";
import { WalletError, isRejection } from "./near/errors.ts";
import { isTestnetAccount } from "./near/config.ts";
import type { NearWallet } from "./near/wallet.ts";

const rpc = nearRpc();

/**
 * The real wallet (Wallet Selector, own chunk). Only the e2e build (`vite build --mode e2e`, VITE_E2E=1) may
 * substitute a mocked wallet from the test runner; in the production build this branch is compiled out.
 */
function loadWallet(): Promise<NearWallet> {
  if (import.meta.env.VITE_E2E === "1") {
    const mock = (window as unknown as { __SOL2NEAR_E2E_WALLET__?: NearWallet }).__SOL2NEAR_E2E_WALLET__;
    if (mock) return Promise.resolve(mock);
  }
  return import("./near/wallet.ts").then((m) => m.getNearWallet());
}
const safeStorage = (() => { try { localStorage.setItem("sol2near.probe", "1"); return localStorage; } catch { return null; } })();
const history = txHistory(safeStorage);
/** Exact NEAR display (no float): 5 decimals is enough for the 0.00125 NEAR storage deposit. */
const near = (y: bigint) => formatUnits(y, 24, 5);
const TONE: Record<StepState, string> = { NOT_STARTED: "neutral", READY: "refunded", PENDING: "pending", CONFIRMED: "confirmed", FAILED: "failed", BLOCKED: "failed" };

interface AccountData {
  ctx: DepositContext;
  deposits: TreasuryDeposit[];
  position: FuelPosition | null;
  fuelRegistered: boolean;
  fuelStorageMin: string;
  inFlight: unknown;
  calendar: FuelCalendar;
  positionSeason: Season | null;
}

export function NearPanel({ onAccount, onChanged, tidepoolReachable }: {
  onAccount: (id: string | null) => void;
  onChanged: () => void;
  tidepoolReachable: boolean | null;
}) {
  const [wallet, setWallet] = useState<NearWallet | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [data, setData] = useState<AccountData | null>(null);
  const [records, setRecords] = useState<TxRecord[]>([]);
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<{ kind: TxKind; call: TxCall; lines: string[]; amount?: string; target?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 1 s clock for FUEL deadlines (registration window, season close).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(t); }, []);
  const pollRef = useRef<number | null>(null);

  // Wallet: restore the session, apply a browser-wallet redirect result, follow account changes.
  useEffect(() => {
    let unsub = () => {};
    loadWallet().then((w) => {
      setWallet(w);
      const set = (id: string | null) => {
        if (id && !isTestnetAccount(id)) {
          setWalletError(`${id} is not a NEAR testnet account. SOL2NEAR never uses mainnet: switch your wallet to testnet.`);
          id = null;
        }
        setAccountId(id);
        onAccount(id);
      };
      set(w.accountId);
      if (w.accountId) {
        const ret = parseWalletReturn(location.search);
        if (ret) {
          applyWalletReturn(history, ret, w.accountId);
          window.history.replaceState(null, "", location.pathname + location.hash); // drop wallet params
        }
      }
      unsub = w.subscribe(set);
    }, (e) => setFatal(`Wallet selector failed to load: ${(e as Error).message}`));
    return () => unsub();
  }, []);

  const transfer = useMemo<TransferRecord | null>(() => {
    if (!accountId || !safeStorage) return null;
    const mine = webStorageStore(safeStorage).list().filter((t) => t.quote.nearRecipient === accountId);
    return mine.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }, [accountId, records]);

  async function load() {
    if (!accountId) { setData(null); return; }
    try {
      const ctx = await loadDepositContext(rpc, accountId);
      const [deposits, fuelReg, bounds, inFlight] = await Promise.all([
        rpc.view<TreasuryDeposit[]>(TREASURY_ACCOUNT_ID, "get_creator_deposits", { creator: accountId }),
        rpc.view<unknown>(FUEL_ACCOUNT_ID, "storage_balance_of", { account_id: accountId }),
        rpc.view<{ min: string }>(FUEL_ACCOUNT_ID, "storage_balance_bounds"),
        rpc.view<unknown>(TREASURY_ACCOUNT_ID, "get_in_flight"),
      ]);
      const latest = deposits[deposits.length - 1];
      const [position, reactor] = await Promise.all([
        latest ? rpc.view<FuelPosition | null>(FUEL_ACCOUNT_ID, "get_position", { position_id: latest.id }) : Promise.resolve(null),
        rpc.view<{ config: FuelCalendar }>(FUEL_ACCOUNT_ID, "get_reactor"),
      ]);
      const positionSeason = position ? await rpc.view<Season | null>(FUEL_ACCOUNT_ID, "get_season", { season_id: position.position.season_id }) : null;
      setData({ ctx, deposits, position, fuelRegistered: fuelReg !== null, fuelStorageMin: bounds.min, inFlight, calendar: reactor.config, positionSeason });
      setError(null);
    } catch (e) {
      setError(`Could not read NEAR testnet: ${(e as Error).message}. Nothing was sent.`);
    }
  }

  /** Re-checks every open record against its final outcome. Never re-sends anything. */
  async function verifyOpen() {
    if (!accountId) return;
    let changed = false;
    for (const r of history.list(accountId).filter((x) => x.status === "submitted" && x.txHash)) {
      try {
        const o = await rpc.txStatus(r.txHash!, accountId);
        if (!o) continue; // not final yet: stays "submitted"
        changed = true;
        if (r.kind === "deposit") {
          const v = analyzeDeposit(o, { sender: accountId, amount: BigInt(r.amount!) });
          if (v.kind === "counted") {
            const c = await confirmInTreasury(rpc, v.depositId, accountId, v.used);
            history.update(r.id, c.ok
              ? { status: "confirmed", target: v.depositId, detail: `Deposit #${v.depositId} counted: ${usdc(v.used)} USDC (LP ${usdc(v.lp)} / reserve ${usdc(v.reserve)} / community ${usdc(v.community)})` }
              : { status: "submitted", detail: `Outcome says counted, Treasury state not visible yet: ${c.detail}` });
            if (c.ok) setAmount(""); // a confirmed deposit clears the form: a second deposit must be typed again on purpose
          } else if (v.kind === "refused") history.update(r.id, { status: "refunded", detail: `Treasury refused (${v.reason}); ${usdc(v.refunded)} USDC returned by the token` });
          else if (v.kind === "refunded") history.update(r.id, { status: "refunded", detail: `${usdc(v.refunded)} USDC returned: ${v.detail}` });
          else history.update(r.id, { status: "failed", detail: v.detail });
        } else {
          const v = analyzeAction(r.kind as ActionKind, o, accountId);
          history.update(r.id, { status: v.ok ? "confirmed" : "failed", detail: v.detail });
        }
      } catch (e) {
        history.update(r.id, { detail: `Verification pending: ${(e as Error).message}` });
      }
    }
    setRecords(history.list(accountId));
    if (changed) { await load(); onChanged(); }
  }

  useEffect(() => {
    setRecords(accountId ? history.list(accountId) : []);
    load().then(verifyOpen);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      if (accountId && history.list(accountId).some((r) => r.status === "submitted")) verifyOpen();
    }, 5000);
    // Balances change outside the dashboard (faucet, other wallets): re-read when the tab regains focus.
    const onFocus = () => { if (accountId) load(); };
    window.addEventListener("focus", onFocus);
    return () => { if (pollRef.current) clearInterval(pollRef.current); window.removeEventListener("focus", onFocus); };
  }, [accountId]);

  const latest = data?.deposits[data.deposits.length - 1] ?? null;

  // A register request still waiting for a signature after its window closed can no longer be admitted.
  useEffect(() => {
    if (!accountId || !data) return;
    for (const r of history.list(accountId)) {
      if (r.kind !== "register_position" || r.status !== "awaiting_signature" || !r.target) continue;
      const d = data.deposits.find((x) => x.id === r.target);
      if (!d?.lp_confirmed_at) continue;
      const w = fuelWindow(d.lp_confirmed_at, data.calendar);
      if (BigInt(nowMs) * 1_000_000n > w.registerDeadline + 60_000_000_000n) {
        history.update(r.id, { status: "expired", detail: `No signature reached the chain before the season ${w.seasonId} registration deadline. If you did sign, check your wallet history: FUEL would have rejected it (ERR_REGISTRATION_WINDOW_CLOSED).` });
        setRecords(history.list(accountId));
      }
    }
  }, [accountId, data, Math.floor(nowMs / 15000)]);
  const open = records.filter(isOpen);
  const nowNs = BigInt(nowMs) * 1_000_000n;
  const steps = pipeline({
    accountId, transfer, tidepoolReachable, usdcBalance: data?.ctx.usdcBalance ?? null, deposit: latest,
    openTx: open, treasuryBusy: !!data?.inFlight, position: data?.position ?? null,
    calendar: data?.calendar ?? null, positionSeason: data?.positionSeason ?? null, nowNs,
  });
  const lpWindow = latest?.lp_confirmed_at && data ? fuelWindow(latest.lp_confirmed_at, data.calendar) : null;
  const check = data ? checkDeposit(amount, data.ctx) : null;
  const dashboardDeposit = records.find((r) => r.kind === "deposit" && r.status === "confirmed");

  /** Opens the review step: nothing is signed before the user confirms it. */
  function prepare(kind: TxKind, call: TxCall, lines: string[], extra: { amount?: string; target?: string } = {}) {
    if (!accountId) return;
    const blocking = history.blocking(accountId, kind, extra.target);
    if (blocking) { setError(`A previous ${kind} is not resolved yet (${blocking.status}). Wait for verification, or dismiss it after checking your wallet history.`); return; }
    setError(null);
    setReview({ kind, call, lines, ...extra });
  }

  async function sign() {
    if (!review || !wallet || !accountId || busy) return;
    setBusy(true);
    const rec = history.add({ kind: review.kind, accountId, ...(review.amount && { amount: review.amount }), ...(review.target && { target: review.target }) });
    setRecords(history.list(accountId));
    try {
      const res = await wallet.signAndSend(review.call);
      if ("redirected" in res) return; // the wallet page takes over; the result comes back in the URL
      history.update(rec.id, { status: "submitted", txHash: res.hash });
      setReview(null);
      await verifyOpen();
    } catch (e) {
      const rejected = e instanceof WalletError ? e.rejected : isRejection(e);
      if (rejected) history.update(rec.id, { status: "rejected", detail: "Rejected in the wallet: nothing was sent." });
      else history.update(rec.id, { detail: `Wallet/RPC error: ${(e as Error).message}. It may have been sent: check your wallet history before trying again.` });
      setRecords(history.list(accountId));
      setReview(null);
    } finally {
      setBusy(false);
    }
  }

  function dismiss(r: TxRecord) {
    if (!accountId) return;
    history.update(r.id, { status: "dismissed", detail: `${r.detail ?? ""} · dismissed by user after checking` });
    setRecords(history.list(accountId));
  }

  async function prepareLp(d: TreasuryDeposit) {
    if (!data?.ctx.cfg) return;
    setBusy(true);
    try {
      const { plan, preview } = await planLp(rpc, data.ctx.cfg.config.pool_id, BigInt(d.lp_budget));
      prepare("execute_lp", executeLpCall(d.id, plan), [
        `Treasury.execute_lp(deposit_id ${d.id}) on ${TREASURY_ACCOUNT_ID}, 300 Tgas, no deposit`,
        `Plan from the live Ref pool ${data.ctx.cfg.config.pool_id}: swap ${usdc(preview.swapUsdcIn)} USDC → ≥ ${plan.min_swap_out} wNEAR (atomic), then add ~${usdc(preview.usdcLeftForLp)} USDC as liquidity (1 % slippage guards)`,
        "If the pool moves past the guards, the step fails cleanly and the deposit stays resumable.",
      ], { target: d.id });
    } catch (e) {
      setError(`Could not compute the LP plan: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (fatal) return <div className="card"><h3>Your NEAR testnet account</h3><p className="banner err">{fatal}</p></div>;
  return (
    <section className="card nearpanel">
      <h3>Your NEAR testnet account</h3>
      <div className="walletbar">
        {accountId ? (
          <>
            <span className="badge confirmed">testnet</span> <code>{accountId}</code>
            <button className="ghost" onClick={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} disabled={busy || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
            <button className="ghost" onClick={() => wallet?.disconnect()} disabled={busy}>Disconnect</button>
          </>
        ) : <button onClick={() => wallet?.connect()} disabled={!wallet}>{wallet ? "Connect NEAR wallet" : "Loading wallets…"}</button>}
      </div>
      {walletError && <p className="banner err">{walletError}</p>}
      {accountId && !data && !error && <p className="muted">Reading your balances on NEAR testnet…</p>}
      {accountId && data && (
        <div className="grid4 small">
          <div className="stat"><small>NEAR (gas)</small><b>{data.ctx.nearBalance !== null ? near(data.ctx.nearBalance) : "—"}</b>{data.ctx.nearBalance !== null && data.ctx.nearBalance < MIN_NEAR_FOR_GAS && <span className="badge failed">too low for gas</span>}</div>
          <div className="stat"><small>USDC on NEAR ({USDC_TOKEN_ID})</small><b>{data.ctx.usdcBalance !== null ? usdc(data.ctx.usdcBalance) : "—"}</b><span className={`badge ${data.ctx.cfg?.config.usdc_token === USDC_TOKEN_ID ? "confirmed" : "failed"}`}>{data.ctx.cfg?.config.usdc_token === USDC_TOKEN_ID ? "accepted by Treasury" : "not accepted"}</span></div>
          <div className="stat"><small>Storage</small><b className="tiny">USDC {data.ctx.senderRegistered ? "✓" : "✗"} · Treasury on USDC {data.ctx.treasuryRegistered ? "✓" : "✗"} · FUEL {data.fuelRegistered ? "✓" : "✗"}</b></div>
          <div className="stat"><small>Your deposits in Treasury</small><b>{data.deposits.length}</b></div>
        </div>
      )}

      <ol className="steps" aria-label="Bridge → Receive → Deposit → Liquidity → FUEL">
        {steps.map((s) => (
          <li key={s.name}><b>{s.name}</b> <span className={`badge ${TONE[s.state]}`}>{s.state.replace("_", " ")}</span><div>{s.detail}</div></li>
        ))}
      </ol>
      <p className="muted paths">
        <b>Path A · direct NEAR deposit</b>: wallet → Treasury → Ref → FUEL. Proven on testnet by CLI (G2 C1–C7){dashboardDeposit?.txHash ? <>; from this dashboard: <a href={explorerTx(dashboardDeposit.txHash)} target="_blank" rel="noreferrer">verified deposit</a></> : "; from this dashboard: not executed yet"}.{" "}
        <b>Path B · full cross-chain</b>: Solana → Tidepool → NEAR → Treasury. {transfer?.stage === "near_verified" ? "Bridge verified on NEAR for this account." : tidepoolReachable === false ? "Not demonstrated: Tidepool is unreachable from this network." : "Not demonstrated yet: no live Solana → NEAR transfer has been run."} A direct NEAR deposit never proves a Solana origin.
      </p>

      {accountId && data && !data.fuelRegistered && (
        <p className="muted">
          FUEL storage is not registered for this account: claiming a reward will need it. It is a separate, one-time
          transaction you can do any time before claiming.{" "}
          <button className="ghost" disabled={busy} onClick={() => prepare("fuel_storage", fuelStorageCall(accountId, data.fuelStorageMin), [`FUEL.storage_deposit({"account_id":"${accountId}","registration_only":true}) on ${FUEL_ACCOUNT_ID}`, `Attached: ${near(BigInt(data.fuelStorageMin))} NEAR (storage_balance_bounds.min), 30 Tgas`, "Needed once so the FUEL contract can hold your FUEL balance."])}>Register on FUEL (storage)</button>
        </p>
      )}

      {accountId && data && (
        <div className="deposit">
          <h3>Deposit to Treasury</h3>
          {transfer?.stage === "near_verified" && transfer.nearReceived && (
            <p className="muted">Bridge verified: {usdc(transfer.nearReceived)} USDC arrived on {accountId}. <button className="ghost" onClick={() => setAmount(toDecimalString(transfer.nearReceived!, 6))}>Use this amount</button> (a separate NEAR signature is still required).</p>
          )}
          <div className="watch">
            <input aria-label="USDC amount" placeholder="USDC amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <button className="ghost" onClick={() => data.ctx.usdcBalance !== null && setAmount(toDecimalString(data.ctx.usdcBalance, 6))}>Max</button>
            <button disabled={busy || !check?.ok} onClick={() => check?.ok && prepare("deposit", check.call, [
              `From (signer): ${accountId} — NEAR testnet; this account becomes the deposit's creator`,
              `Token: ${USDC_TOKEN_ID} (Tidepool test USDC, no value), 6 decimals`,
              `Amount: ${usdc(check.amount)} USDC = ${check.amount} atomic`,
              `Call: ft_transfer_call → receiver ${TREASURY_ACCOUNT_ID}, msg {"action":"deposit"}, 1 yoctoNEAR, 100 Tgas (unused gas refunded; testnet fee < 0.01 NEAR)`,
              `Split by the contract rule: LP ${usdc(check.split.lp)} · creator reserve ${usdc(check.split.reserve)} · community ${usdc(check.split.community)}`,
              `Storage: you ✓ and Treasury ✓ on ${USDC_TOKEN_ID}, so no storage transaction is needed before this deposit`,
            ], { amount: check.amount.toString() })}>Deposit to Treasury</button>
          </div>
          {check?.ok && (
            <div className="split" aria-label="split preview">
              <span style={{ flex: 90 }}>LP {usdc(check.split.lp)}</span><span style={{ flex: 8 }}>{usdc(check.split.reserve)}</span><span style={{ flex: 2 }} />
            </div>
          )}
          {amount && check && !check.ok && <ul className="problems">{check.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}

      {accountId && latest && (() => {
        const canLp = steps[3]!.state === "READY" || steps[3]!.state === "FAILED";
        const canRegister = steps[4]!.state === "READY" && !data?.position;
        const canClaim = data?.position?.reward_status === "Claimable";
        const canClose = steps[4]!.state === "READY" && data?.position?.reward_status === "Pending" && !!data.positionSeason;
        const secsLeft = lpWindow ? Math.max(0, Number((lpWindow.registerDeadline - nowNs) / 1_000_000_000n)) : null;
        return (
        <div className="deposit">
          <h3>Deposit #{latest.id}: next actions</h3>
          {!canLp && !canRegister && !canClaim && !canClose && (
            <p className="muted">Nothing to sign for this deposit right now: {steps[4]!.state === "CONFIRMED" ? "LP confirmed and FUEL reward claimed." : steps[4]!.detail}</p>
          )}
          <div className="watch">
            {canLp
              ? <button disabled={busy} onClick={() => prepareLp(latest)}>Deploy liquidity (execute_lp)</button> : null}
            {canRegister
              ? <button disabled={busy || secsLeft === 0} onClick={() => prepare("register_position", registerPositionCall(latest.id), [
                  `FUEL.register_position({"position_id":"${latest.id}"}) on ${FUEL_ACCOUNT_ID}, 100 Tgas, 0 NEAR attached`,
                  "Permissionless: FUEL reads the Treasury record and Ref shares; rewards go to the recorded creator.",
                  lpWindow ? `Deadline: approve in your wallet before ${new Date(Number(lpWindow.registerDeadline / 1_000_000n)).toISOString().slice(11, 19)} UTC (season ${lpWindow.seasonId} end + 5 min grace), or FUEL rejects it with ERR_REGISTRATION_WINDOW_CLOSED.` : "Approve quickly: the registration window is the LP confirmation season + 5 min.",
                ], { target: latest.id })}>Register for FUEL{secsLeft !== null ? ` · ${Math.floor(secsLeft / 60)}m ${String(secsLeft % 60).padStart(2, "0")}s left` : ""}</button> : null}
            {canClose
              ? <button disabled={busy} onClick={() => prepare("close_season", closeSeasonCall(data!.positionSeason!.id), [
                  `FUEL.close_season({"season_id":${data!.positionSeason!.id}}) on ${FUEL_ACCOUNT_ID}, 50 Tgas, 0 NEAR attached (anyone may call it)`,
                  `Progress ${usdc(data!.positionSeason!.progress_usdc)} / ${usdc(data!.positionSeason!.target_usdc)} USDC → ${BigInt(data!.positionSeason!.progress_usdc) >= BigInt(data!.positionSeason!.target_usdc) ? "SUCCESS: level +1, rewards become claimable after the LP lock" : "FAILED: level −1, rewards forfeited, up to 10 FUEL burned from the burn reserve"}`,
                ], { target: `S${data!.positionSeason!.id}` })}>Close season {data!.positionSeason!.id}</button> : null}
            {data?.position?.reward_status === "Claimable" && data.fuelRegistered
              ? <button disabled={busy} onClick={() => prepare("claim", claimCall(latest.id), [`FUEL.claim(${latest.id}), 50 Tgas`, `Pays ${fmtFuel(data.position!.position.creator_reward)} FUEL to ${data.position!.position.creator_id}`], { target: latest.id })}>Claim {fmtFuel(data.position.position.creator_reward)} FUEL</button> : null}
          </div>
          {data?.position && data.position.reward_status !== "Claimed" && data.position.reward_status !== "Claimable" && (
            <p className="muted">FUEL committed (not earned yet): {fmtFuel(data.position.position.creator_reward)} to you · status {data.position.reward_status}.</p>
          )}
        </div>
        );
      })()}

      {review && (
        <div className="review" role="dialog" aria-label="Review before signing">
          <h3>Review before signing ({review.kind})</h3>
          <ul>{review.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="muted">Network: NEAR testnet only. Your wallet shows the same call; nothing is sent until you approve it there.</p>
          <div className="watch">
            <button disabled={busy} onClick={sign}>{busy ? "Waiting for wallet…" : "Confirm & open wallet"}</button>
            <button className="ghost" disabled={busy} onClick={() => setReview(null)}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="banner err">{error}</p>}

      {records.length > 0 && (
        <div className="history">
          <h3>Transactions started from this dashboard (this browser)</h3>
          {records.slice(0, 8).map((r) => (
            <div key={r.id} className="histrow">
              <span className={`badge ${r.status === "confirmed" ? "confirmed" : r.status === "refunded" ? "refunded" : isOpen(r) ? "pending" : r.status === "dismissed" || r.status === "rejected" ? "neutral" : "failed"}`}>{r.status.replace("_", " ")}</span>
              <span>{r.kind}{r.amount ? ` · ${usdc(r.amount)} USDC` : ""}{r.target ? ` · #${r.target}` : ""}</span>
              {r.txHash && <a href={explorerTx(r.txHash)} target="_blank" rel="noreferrer">tx</a>}
              <small className="muted">{r.detail ?? (r.status === "submitted" ? "Verifying the final outcome…" : "")}</small>
              {isOpen(r) && <button className="ghost" onClick={() => dismiss(r)}>I checked it, dismiss</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
