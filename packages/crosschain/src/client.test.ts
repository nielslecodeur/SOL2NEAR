// UNIT TESTS WITH MOCKS. They prove the client's logic, not a real cross-chain transfer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { createTidepoolClient, type TidepoolClientOptions } from "./client.ts";
import { CrosschainFailure } from "./errors.ts";
import { quoteValidity } from "./quote.ts";
import type { BridgeQuote, BridgeResult } from "../../shared/src/crosschain.ts";
import type { FetchLike } from "./http.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const PAYER = Keypair.generate().publicKey.toBase58();
const DEPOSIT = Keypair.generate().publicKey.toBase58();
const REQ = { amountAtomic: "1000000", solanaRefundAddress: PAYER, nearRecipient: "sol2near-dev.testnet" };

type Route = (body: any, url: string) => { status?: number; json?: unknown; text?: string } | Error;

function mockFetch(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: any }[] = [];
  const f: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    if (!route) return new Response("not found", { status: 404 });
    const r = route(body, url);
    if (r instanceof Error) throw r;
    return new Response(r.text ?? JSON.stringify(r.json), { status: r.status ?? 200 });
  };
  return { f, calls };
}

// Shape of the dry quote recorded live on 2026-11-11 (FEASIBILITY T6), plus deposit fields for live.
const quoteResponse = (body: any) => ({
  json: {
    correlationId: "e1b46370-990b-4c9b-ae72-a2223607d2be",
    signature: "ed25519:test",
    timestamp: new Date(NOW).toISOString(),
    quoteRequest: body,
    quote: {
      amountIn: body.amount, amountOut: "997400", minAmountOut: "987426", timeEstimate: 60,
      ...(!body.dry && { depositAddress: DEPOSIT, deadline: body.deadline }),
    },
  },
});

const solanaMock = (balance = "5000000") => ({
  latestBlockhash: async () => "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
  usdcBalance: async () => balance,
});

const client = (routes: Record<string, Route>, extra: Partial<TidepoolClientOptions> = {}) => {
  const m = mockFetch(routes);
  return { c: createTidepoolClient({ fetch: m.f, now: () => NOW, solana: solanaMock(), ...extra }), calls: m.calls };
};

const failsWith = (kind: string) => (e: unknown) => {
  assert.ok(e instanceof CrosschainFailure, String(e));
  assert.equal(e.kind, kind, e.message);
  return true;
};

const noSleep = async () => {};
const statusSeq = (...rs: unknown[]) => {
  let i = 0;
  return () => ({ json: rs[Math.min(i++, rs.length - 1)] });
};

test("valid dry quote: request body matches the live-verified shape", async () => {
  const { c, calls } = client({ "POST /v0/quote": quoteResponse });
  const q = await c.quote(REQ, { dry: true });
  assert.equal(q.amountOut, "997400");
  assert.equal(q.minAmountOut, "987426");
  assert.equal(q.depositAddress, undefined);
  assert.equal(quoteValidity(q, NOW), "dry");
  const b = calls[0]!.body;
  assert.deepEqual(
    { ...b, deadline: undefined },
    {
      dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100,
      originAsset: "nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet", depositType: "ORIGIN_CHAIN",
      destinationAsset: "nep141:usdc.tidepool-sandbox.testnet", amount: "1000000",
      refundTo: PAYER, refundType: "ORIGIN_CHAIN", recipient: "sol2near-dev.testnet", recipientType: "DESTINATION_CHAIN",
      deadline: undefined,
    },
  );
  assert.equal(Date.parse(b.deadline) - NOW, 30 * 60_000);
});

test("valid live quote is fundable and has a deposit address", async () => {
  const { c } = client({ "POST /v0/quote": quoteResponse });
  const q = await c.quote(REQ, { dry: false });
  assert.equal(q.depositAddress, DEPOSIT);
  assert.equal(quoteValidity(q, NOW), "valid");
});

test("expired quote: deposit refused before touching the wallet", async () => {
  const { c } = client({ "POST /v0/quote": quoteResponse });
  const q = await c.quote({ ...REQ, deadlineMinutes: 1 }, { dry: false });
  assert.equal(quoteValidity(q, NOW), "expired"); // 1 min left < 60 s safety margin + confirmation
  let asked = 0;
  await assert.rejects(c.deposit(q, PAYER, { signAndSendTransaction: async () => { asked++; return "sig"; } }), failsWith("quote_expired"));
  assert.equal(asked, 0);
});

test("dry quote can never be funded", async () => {
  const { c } = client({ "POST /v0/quote": quoteResponse });
  const q = await c.quote(REQ, { dry: true });
  await assert.rejects(c.buildDepositTransaction(q, PAYER), failsWith("validation"));
});

test("insufficient amount: zero/float rejected locally, Tidepool 400 passed through verbatim", async () => {
  const { c, calls } = client({ "POST /v0/quote": () => ({ status: 400, json: { message: "Amount is too low for bridge" } }) });
  for (const amountAtomic of ["0", "1.5", "-1", "abc"])
    await assert.rejects(c.quote({ ...REQ, amountAtomic }, { dry: true }), failsWith("validation"));
  assert.equal(calls.length, 0);
  await assert.rejects(c.quote({ ...REQ, amountAtomic: "1" }, { dry: true }), (e) => {
    failsWith("validation")(e);
    assert.match((e as Error).message, /HTTP 400: Amount is too low for bridge/);
    assert.equal((e as CrosschainFailure).httpStatus, 400);
    return true;
  });
});

test("insufficient devnet USDC balance is caught before the wallet", async () => {
  const { c } = client({ "POST /v0/quote": quoteResponse }, { solana: solanaMock("999999") });
  const q = await c.quote(REQ, { dry: false });
  await assert.rejects(c.buildDepositTransaction(q, PAYER), failsWith("validation"));
});

test("unsupported token: route check fails when a leg is not listed", async () => {
  const listed = { assetId: "nep141:usdc.tidepool-sandbox.testnet", decimals: 6 };
  const { c } = client({ "GET /v0/tokens": () => ({ json: [listed] }) });
  await assert.rejects(c.assertRouteSupported(), failsWith("unsupported_route"));
  const ok = client({
    "GET /v0/tokens": () => ({ json: [listed, { assetId: "nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet", decimals: 6 }] }),
  });
  await ok.c.assertRouteSupported();
});

test("invalid addresses are rejected locally", async () => {
  const { c, calls } = client({});
  await assert.rejects(c.quote({ ...REQ, solanaRefundAddress: "0xabc" }, { dry: true }), failsWith("validation"));
  await assert.rejects(c.quote({ ...REQ, nearRecipient: "Bad..Account" }, { dry: true }), failsWith("validation"));
  assert.equal(calls.length, 0);
});

test("network error -> kind network; 5xx -> kind http", async () => {
  const a = client({ "GET /v0/health": () => new TypeError("fetch failed") });
  await assert.rejects(a.c.health(), failsWith("network"));
  const b = client({ "GET /v0/health": () => ({ status: 502, text: "Bad Gateway" }) });
  await assert.rejects(b.c.health(), failsWith("http"));
});

test("health reads ok + Solana route flag (shape verified live 2026-11-11)", async () => {
  const { c } = client({ "GET /v0/health": () => ({ json: { ok: true, network: "testnet", bridges: { chains: { sol: { ok: true } } } } }) });
  assert.deepEqual(await c.health(), { ok: true, solanaRouteOk: true });
});

test("wallet rejection -> wallet_rejected, nothing submitted, retry allowed", async () => {
  const { c, calls } = client({ "POST /v0/quote": quoteResponse, "POST /v0/deposit/submit": () => ({ json: {} }) });
  const q = await c.quote(REQ, { dry: false });
  const rejecting = { signAndSendTransaction: async () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); } };
  await assert.rejects(c.deposit(q, PAYER, rejecting), failsWith("wallet_rejected"));
  assert.equal(calls.filter((x) => x.path === "/v0/deposit/submit").length, 0);
  assert.equal(await c.deposit(q, PAYER, { signAndSendTransaction: async () => "sig-after-retry" }), "sig-after-retry");
});

test("repeated deposit / submit: wallet asked once, submit sent once", async () => {
  const { c, calls } = client({ "POST /v0/quote": quoteResponse, "POST /v0/deposit/submit": () => ({ json: {} }) });
  const q = await c.quote(REQ, { dry: false });
  let asked = 0;
  const wallet = { signAndSendTransaction: async (tx: Uint8Array) => { asked++; assert.ok(tx.length > 0); return "5sig"; } };
  const [s1, s2] = await Promise.all([c.deposit(q, PAYER, wallet), c.deposit(q, PAYER, wallet)]);
  assert.equal(await c.deposit(q, PAYER, wallet), "5sig");
  assert.equal(s1, "5sig");
  assert.equal(s2, "5sig");
  assert.equal(asked, 1);
  await c.submitDeposit("5sig", DEPOSIT);
  const submits = calls.filter((x) => x.path === "/v0/deposit/submit");
  assert.equal(submits.length, 1);
  assert.deepEqual(submits[0]!.body, { txHash: "5sig", depositAddress: DEPOSIT });
});

test("wallet error that may have broadcast is NOT retried automatically", async () => {
  const { c } = client({ "POST /v0/quote": quoteResponse });
  const q = await c.quote(REQ, { dry: false });
  let asked = 0;
  const flaky = { signAndSendTransaction: async () => { asked++; throw new Error("RPC timeout"); } };
  await assert.rejects(c.deposit(q, PAYER, flaky), failsWith("network"));
  await assert.rejects(c.deposit(q, PAYER, flaky), failsWith("network"));
  assert.equal(asked, 1);
});

const st = (status: string, extra: object = {}) => ({ status, updatedAt: "2026-11-13T12:00:00Z", swapDetails: extra });

test("status pending -> processing -> success, with proof hashes", async () => {
  const { c, calls } = client({
    "GET /v0/status": statusSeq(
      st("PENDING_DEPOSIT"),
      st("PENDING_DEPOSIT"),
      st("KNOWN_DEPOSIT_TX", { originChainTxHashes: [{ hash: "solSig", explorerUrl: "" }] }),
      st("PROCESSING", { originChainTxHashes: [{ hash: "solSig" }] }),
      st("SUCCESS", { amountIn: "1000000", amountOut: "997400", originChainTxHashes: [{ hash: "solSig" }], destinationChainTxHashes: [{ hash: "nearTx" }] }),
    ),
  });
  const seen: BridgeResult[] = [];
  const r = await c.watch(DEPOSIT, (u) => seen.push(u), { sleep: noSleep } as never);
  assert.deepEqual(seen.map((s) => s.status), ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"]); // duplicate not re-emitted
  assert.equal(r.status, "SUCCESS");
  assert.deepEqual(r.solanaTxHashes, ["solSig"]);
  assert.deepEqual(r.nearTxHashes, ["nearTx"]);
  assert.equal(r.amountOut, "997400");
  assert.equal(calls.length, 5);
});

test("status failed and refunded are terminal and keep the reason", async () => {
  for (const s of ["FAILED", "REFUNDED"]) {
    const { c } = client({ "GET /v0/status": statusSeq(st("PROCESSING"), st(s, { refundReason: "deadline exceeded", refundedAmount: "1000000" })) });
    const r = await c.watch(DEPOSIT, () => {}, { sleep: noSleep } as never);
    assert.equal(r.status, s);
    assert.equal(r.refundReason, "deadline exceeded");
  }
});

test("unknown status is an error, never mapped to a guess", async () => {
  const { c } = client({ "GET /v0/status": statusSeq(st("DONE_MAYBE")) });
  await assert.rejects(c.watch(DEPOSIT, () => {}, { sleep: noSleep } as never), failsWith("http"));
});

test("polling survives transient errors, gives up after maxConsecutiveErrors", async () => {
  let n = 0;
  const flaky = client({ "GET /v0/status": () => (++n <= 2 ? new TypeError("fetch failed") : { json: st("SUCCESS") }) });
  assert.equal((await flaky.c.watch(DEPOSIT, () => {}, { sleep: noSleep } as never)).status, "SUCCESS");
  const down = client({ "GET /v0/status": () => new TypeError("fetch failed") });
  await assert.rejects(down.c.watch(DEPOSIT, () => {}, { sleep: noSleep, maxConsecutiveErrors: 3 } as never), failsWith("network"));
});

test("watch can be aborted", async () => {
  const { c } = client({ "GET /v0/status": statusSeq(st("PENDING_DEPOSIT")) });
  const ac = new AbortController();
  const p = c.watch(DEPOSIT, () => ac.abort(new Error("user left the page")), { signal: ac.signal, intervalMs: 2000 });
  await assert.rejects(p, /user left the page/);
});

test("inconsistent or incomplete quote responses are rejected", async () => {
  const bad = (q: object) => client({ "POST /v0/quote": () => ({ json: { correlationId: "c", signature: "s", quote: q } }) }).c;
  await assert.rejects(bad({ amountIn: "1000000", amountOut: "10", minAmountOut: "20" }).quote(REQ, { dry: true }), failsWith("http"));
  await assert.rejects(bad({ amountIn: "999", amountOut: "10", minAmountOut: "5" }).quote(REQ, { dry: true }), failsWith("http"));
  await assert.rejects(bad({ amountIn: "1000000", amountOut: "10", minAmountOut: "5" }).quote(REQ, { dry: false }), failsWith("http")); // live without depositAddress
  const q: BridgeQuote = await client({ "POST /v0/quote": quoteResponse }).c.quote(REQ, { dry: true });
  assert.equal(q.timeEstimateSec, 60);
});
