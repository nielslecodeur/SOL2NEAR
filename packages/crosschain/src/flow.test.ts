// UNIT TESTS WITH MOCKS (Tidepool HTTP, Solana RPC, NEAR RPC, wallet, browser storage).
// They prove the client's state machine, NOT a real cross-chain transfer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { createTidepoolClient, type TidepoolClientOptions } from "./client.ts";
import { CrosschainFailure, fail } from "./errors.ts";
import { webStorageStore, type TransferStore } from "./store.ts";
import type { FetchLike } from "./http.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const PAYER = Keypair.generate().publicKey.toBase58();
const DEPOSIT = Keypair.generate().publicKey.toBase58();
const NEAR_ACCT = "sol2near-dev.testnet";
const REQ = { amountAtomic: "1000000", solanaRefundAddress: PAYER, nearRecipient: NEAR_ACCT };

const failsWith = (kind: string) => (e: unknown) => {
  assert.ok(e instanceof CrosschainFailure, String(e));
  assert.equal(e.kind, kind, e.message);
  return true;
};

/** Fake Tidepool. `echo` overrides fields of the echoed quoteRequest; `statuses` are served in order. */
function tidepool(o: { echo?: Record<string, unknown>; quoteExtra?: Record<string, unknown>; statuses?: unknown[] } = {}) {
  const calls: string[] = [];
  let i = 0;
  const f: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${pathname}`);
    if (pathname === "/v0/quote") {
      const body = JSON.parse(String(init!.body));
      return Response.json({
        correlationId: "c-1", signature: "ed25519:x", timestamp: new Date(NOW).toISOString(),
        quoteRequest: { ...body, ...o.echo },
        quote: {
          amountIn: body.amount, amountOut: "997400", minAmountOut: "987426", timeEstimate: 60,
          ...(!body.dry && { depositAddress: DEPOSIT, deadline: body.deadline }), ...o.quoteExtra,
        },
      });
    }
    if (pathname === "/v0/deposit/submit") return Response.json({ status: "KNOWN_DEPOSIT_TX" });
    if (pathname === "/v0/status") {
      const s = o.statuses ?? [{ status: "SUCCESS", swapDetails: {} }];
      return Response.json(s[Math.min(i++, s.length - 1)]);
    }
    return new Response("not found", { status: 404 });
  };
  return { f, calls };
}

/** In-memory stand-in for window.localStorage, shared between "page loads". */
const fakeStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

const nearMock = (...balances: string[]) => {
  let i = 0;
  return { usdcBalance: async () => balances[Math.min(i++, balances.length - 1)]! };
};

const solanaMock = (confirm: () => Promise<void> = async () => {}) => ({
  latestBlockhash: async () => "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
  usdcBalance: async () => "5000000",
  confirmSignature: confirm,
});

const make = (tp: ReturnType<typeof tidepool>, extra: Partial<TidepoolClientOptions> = {}) =>
  createTidepoolClient({ fetch: tp.f, now: () => NOW, solana: solanaMock(), near: nearMock("0"), ...extra });

const countingWallet = (sig = "5solSig") => {
  const w = { asked: 0, async signAndSendTransaction() { w.asked++; return sig; } };
  return w;
};
const noSleep = { sleep: async () => {} } as never;

test("wrong asset echoed by Tidepool -> refused before any signature", async () => {
  const c = make(tidepool({ echo: { destinationAsset: "nep141:wnear.tidepool-sandbox.testnet" } }));
  await assert.rejects(c.quote(REQ, { dry: false }), (e) => failsWith("http")(e) && /destinationAsset/.test((e as Error).message));
});

test("wrong recipient or amount echoed -> refused", async () => {
  await assert.rejects(make(tidepool({ echo: { recipient: "attacker.testnet" } })).quote(REQ, { dry: false }), failsWith("http"));
  await assert.rejects(make(tidepool({ echo: { refundTo: Keypair.generate().publicKey.toBase58() } })).quote(REQ, { dry: false }), failsWith("http"));
  await assert.rejects(make(tidepool({ echo: { amount: "2000000" } })).quote(REQ, { dry: false }), failsWith("http"));
});

test("deposit address that needs a memo -> unsupported, never signed", async () => {
  const c = make(tidepool({ quoteExtra: { depositMemo: "12345" } }));
  await assert.rejects(c.quote(REQ, { dry: false }), failsWith("unsupported_route"));
});

test("live quote keeps the recipient for later checks", async () => {
  const q = await make(tidepool()).quote(REQ, { dry: false });
  assert.equal(q.nearRecipient, NEAR_ACCT);
  assert.equal(q.solanaRefundAddress, PAYER);
});

test("Solana transaction failed on-chain -> solana_tx_failed, not submitted, never re-signed", async () => {
  const tp = tidepool();
  const c = make(tp, { solana: solanaMock(async () => { throw fail("solana_tx_failed", "InstructionError [1, Custom(1)]"); }) });
  const q = await c.quote(REQ, { dry: false });
  const w = countingWallet();
  await assert.rejects(c.deposit(q, PAYER, w), failsWith("solana_tx_failed"));
  assert.equal(c.transfers()[0]!.stage, "solana_failed");
  assert.ok(!tp.calls.includes("POST /v0/deposit/submit"));
  assert.equal(await c.deposit(q, PAYER, w), "5solSig"); // known signature returned, wallet NOT asked again
  assert.equal(w.asked, 1);
});

test("Solana confirmation timeout keeps the signature: no second signature", async () => {
  const c = make(tidepool(), { solana: solanaMock(async () => { throw fail("network", "not confirmed after 90s"); }) });
  const q = await c.quote(REQ, { dry: false });
  const w = countingWallet();
  await assert.rejects(c.deposit(q, PAYER, w), failsWith("network"));
  assert.equal(c.transfers()[0]!.stage, "sent");
  assert.equal(await c.deposit(q, PAYER, w), "5solSig");
  assert.equal(w.asked, 1);
});

test("page reload after sending: a new client with the same storage never re-signs", async () => {
  const storage = fakeStorage();
  const store = (): TransferStore => webStorageStore(storage);
  const first = make(tidepool(), { store: store() });
  const q = await first.quote(REQ, { dry: false });
  const w = countingWallet();
  await first.deposit(q, PAYER, w);
  const reloaded = make(tidepool(), { store: store() }); // new page load
  assert.equal(await reloaded.deposit(q, PAYER, w), "5solSig");
  assert.equal(w.asked, 1);
  assert.equal(reloaded.transfers()[0]!.stage, "solana_confirmed");
});

test("page reload while the wallet was open -> interrupted, refuses to sign again", async () => {
  const storage = fakeStorage();
  const first = make(tidepool(), { store: webStorageStore(storage) });
  const q = await first.quote(REQ, { dry: false });
  const hanging = { signAndSendTransaction: () => new Promise<string>(() => {}) }; // user never answers, page reloads
  void first.deposit(q, PAYER, hanging);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(webStorageStore(storage).get(DEPOSIT)!.stage, "signing");
  const reloaded = make(tidepool(), { store: webStorageStore(storage) });
  const w = countingWallet();
  await assert.rejects(reloaded.deposit(q, PAYER, w), failsWith("interrupted"));
  assert.equal(w.asked, 0);
});

test("resume tracking after reload, then verify the USDC really arrived on NEAR", async () => {
  const storage = fakeStorage();
  const first = make(tidepool(), { store: webStorageStore(storage), near: nearMock("5000000") }); // balance before = 5 USDC
  const q = await first.quote(REQ, { dry: false });
  await first.deposit(q, PAYER, countingWallet());

  const statuses = [
    { status: "PROCESSING", swapDetails: { originChainTxHashes: [{ hash: "5solSig", explorerUrl: "" }] } },
    { status: "SUCCESS", quoteResponse: { quote: { depositAddress: DEPOSIT } },
      swapDetails: { amountOut: "997400", originChainTxHashes: [{ hash: "5solSig" }], destinationChainTxHashes: [{ hash: "nearTx" }] } },
  ];
  const reloaded = make(tidepool({ statuses }), { store: webStorageStore(storage), near: nearMock("5997400") });
  const pending = reloaded.transfers().filter((t) => t.stage === "solana_confirmed");
  assert.equal(pending.length, 1);
  const seen: string[] = [];
  const r = await reloaded.track(pending[0]!.depositAddress, (u) => seen.push(u.status), noSleep);
  assert.deepEqual(seen, ["PROCESSING", "SUCCESS"]);
  assert.equal(r.status, "SUCCESS");
  assert.equal(reloaded.transfers()[0]!.stage, "bridge_success"); // Tidepool SUCCESS is not yet NEAR proof
  assert.equal(await reloaded.verifyOnNear(DEPOSIT), "997400");
  assert.equal(reloaded.transfers()[0]!.stage, "near_verified");
});

test("Tidepool SUCCESS but no (or wrong) USDC on NEAR -> settlement_mismatch, stage unchanged", async () => {
  const c = make(tidepool(), { near: nearMock("5000000", "5000000") }); // unchanged balance on usdc.tidepool-sandbox.testnet
  const q = await c.quote(REQ, { dry: false });
  await c.deposit(q, PAYER, countingWallet());
  await c.track(DEPOSIT, () => {}, noSleep);
  await assert.rejects(c.verifyOnNear(DEPOSIT), failsWith("settlement_mismatch"));
  assert.equal(c.transfers()[0]!.stage, "bridge_success");
});

test("refund is recorded with its amount and is never treated as a NEAR receipt", async () => {
  const statuses = [{ status: "REFUNDED", swapDetails: { refundedAmount: "1000000", refundReason: "DEADLINE_EXCEEDED" } }];
  const c = make(tidepool({ statuses }));
  const q = await c.quote(REQ, { dry: false });
  await c.deposit(q, PAYER, countingWallet());
  const r = await c.track(DEPOSIT, () => {}, noSleep);
  assert.equal(r.refundedAmount, "1000000");
  assert.equal(c.transfers()[0]!.stage, "bridge_refunded");
  await assert.rejects(c.verifyOnNear(DEPOSIT), failsWith("validation"));
});

test("status that echoes another deposit address stops tracking immediately", async () => {
  const other = Keypair.generate().publicKey.toBase58();
  const tp = tidepool({ statuses: [{ status: "SUCCESS", quoteResponse: { quote: { depositAddress: other } }, swapDetails: {} }] });
  const c = make(tp);
  await assert.rejects(c.track(DEPOSIT, () => {}, noSleep), failsWith("http"));
  assert.equal(tp.calls.filter((x) => x === "GET /v0/status").length, 1);
});

test("NEAR RPC failure before signing -> nothing signed, retry allowed", async () => {
  const c = make(tidepool(), { near: { usdcBalance: async () => { throw fail("network", "NEAR RPC down"); } } });
  const q = await c.quote(REQ, { dry: false });
  const w = countingWallet();
  await assert.rejects(c.deposit(q, PAYER, w), failsWith("network"));
  assert.equal(w.asked, 0);
  assert.equal(c.transfers().length, 0);
});
