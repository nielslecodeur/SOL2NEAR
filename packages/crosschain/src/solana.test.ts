import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { buildSplDepositTx } from "./solana.ts";
import { CrosschainFailure } from "./errors.ts";

const MINT = new PublicKey("7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr");
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

test("unsigned deposit tx: create dest ATA (idempotent) + transferChecked of the exact amount", () => {
  const payer = Keypair.generate();
  const deposit = Keypair.generate().publicKey;
  const bytes = buildSplDepositTx({
    payer: payer.publicKey.toBase58(), depositAddress: deposit.toBase58(), amountAtomic: "1000000", recentBlockhash: BLOCKHASH,
  });
  const tx = Transaction.from(bytes);
  assert.equal(tx.feePayer?.toBase58(), payer.publicKey.toBase58());
  assert.equal(tx.recentBlockhash, BLOCKHASH);
  assert.equal(tx.signatures.length, 1);
  assert.equal(tx.signatures[0]!.signature, null, "must be unsigned");
  assert.equal(tx.instructions.length, 2);

  const [create, transfer] = tx.instructions as [typeof tx.instructions[0], typeof tx.instructions[0]];
  const destAta = getAssociatedTokenAddressSync(MINT, deposit, true);
  assert.ok(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.deepEqual([...create.data], [1], "CreateIdempotent");
  assert.ok(create.keys[1]!.pubkey.equals(destAta));
  assert.ok(create.keys[2]!.pubkey.equals(deposit));

  assert.ok(transfer.programId.equals(TOKEN_PROGRAM_ID));
  const d = decodeTransferCheckedInstruction(transfer);
  assert.equal(d.data.amount, 1_000_000n);
  assert.equal(d.data.decimals, 6);
  assert.ok(d.keys.mint.pubkey.equals(MINT));
  assert.ok(d.keys.destination.pubkey.equals(destAta));
  assert.ok(d.keys.source.pubkey.equals(getAssociatedTokenAddressSync(MINT, payer.publicKey)));
  assert.ok(d.keys.owner.pubkey.equals(payer.publicKey));

  // A wallet can sign it as-is.
  tx.sign(payer);
  assert.ok(tx.verifySignatures());
});

test("bad inputs are validation errors", () => {
  const ok = Keypair.generate().publicKey.toBase58();
  for (const p of [
    { payer: "nope", depositAddress: ok, amountAtomic: "1" },
    { payer: ok, depositAddress: ok, amountAtomic: "0" },
    { payer: ok, depositAddress: ok, amountAtomic: "1.5" },
  ])
    assert.throws(() => buildSplDepositTx({ ...p, recentBlockhash: BLOCKHASH }), (e) => e instanceof CrosschainFailure && e.kind === "validation");
});
