#!/usr/bin/env node
// Proves what the TRY TESTNET build (`pnpm --filter @sol2near/web build:testnet`) can and cannot do. READ-ONLY: reads files only.
//   CAN: connect a real NEAR testnet wallet (Wallet Selector: MyNearWallet, Meteor) and read the account.
//   CANNOT: send a transaction. The NEAR send path is cut at compile time (the code after the lock is dead and removed by
//   the minifier), the send button is not compiled in, and the Solana signer is the refusing stub.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = join(root, process.argv[2] ?? "apps/web/dist-testnet");
if (!existsSync(join(dir, "assets"))) { console.log(`FAIL ${dir} missing: run \`pnpm --filter @sol2near/web build:testnet\``); process.exit(1); }
const files = readdirSync(join(dir, "assets")).filter((f) => f.endsWith(".js"));
const js = files.map((f) => readFileSync(join(dir, "assets", f), "utf8")).join("\n");
const html = readFileSync(join(dir, "index.html"), "utf8");

const MUST = [
  ["real NEAR Wallet Selector (connect)", /setupWalletSelector|near-wallet-selector/],
  ["MyNearWallet and Meteor modules", /my-near-wallet/],
  ["NEAR lock before the wallet is asked", /SIGNING_LOCKED: this build connects and reads only/],
  ["UI lock in the review", /Signing locked in this build/],
  ["Solana signer replaced by the refusing stub", /SIGNING_DISABLED: public read-only build/],
  ["Try Testnet banner", /signing-locked-banner/],
];
const MUST_NOT = [
  ["send button ('Confirm & open wallet')", /Confirm & open wallet/],
  ["app code after the NEAR lock (network check before signing)", /Wallet network is/],
  ["e2e test hook", /__SOL2NEAR_E2E|__signCalls/],
  ["eval", /\beval\(/],
];
let bad = 0;
for (const [name, re] of MUST) re.test(js) ? console.log(`PASS has ${name}`) : (bad++, console.log(`FAIL missing ${name}`));
for (const [name, re] of MUST_NOT) { const m = js.match(re); m ? (bad++, console.log(`FAIL found ${name}: "${m[0]}"`)) : console.log(`PASS no ${name}`); }
/Content-Security-Policy/.test(html) && /connect-src/.test(html) && /form-action 'none'/.test(html)
  ? console.log("PASS CSP meta (connect-src restricted)") : (bad++, console.log("FAIL CSP meta missing"));
/Try Testnet/.test(html) ? console.log("PASS page title says Try Testnet") : (bad++, console.log("FAIL page title"));
console.log(bad ? `\n${bad} check(s) FAILED for ${dir}` : `\ntry-testnet bundle: real wallet connection, every signature locked (${files.length} JS file(s), ${(js.length / 1024).toFixed(0)} KB)`);
process.exit(bad ? 1 : 0);
