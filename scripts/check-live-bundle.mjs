#!/usr/bin/env node
// Checks the TESTNET LIVE build (`pnpm --filter @sol2near/web build:live`) deployed since H8. READ-ONLY: reads files only.
//   It CAN sign, but only through the user's own wallet after an in-page review, and only on NEAR testnet / Solana devnet.
//   It must not contain a test hook, eval, the read-only stubs, or any key; it must keep the CSP and the testnet guards.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = join(root, process.argv[2] ?? "apps/web/dist-live");
if (!existsSync(join(dir, "assets"))) { console.log(`FAIL ${dir} missing: run \`pnpm --filter @sol2near/web build:live\``); process.exit(1); }
const files = readdirSync(join(dir, "assets")).filter((f) => f.endsWith(".js"));
const js = files.map((f) => readFileSync(join(dir, "assets", f), "utf8")).join("\n");
const html = readFileSync(join(dir, "index.html"), "utf8");

const MUST = [
  ["NEAR Wallet Selector (MyNearWallet, Meteor)", /my-near-wallet/],
  ["review before signing", /Review before signing/],
  ["send happens in the user's wallet ('Confirm & open wallet')", /Confirm & open wallet/],
  ["testnet-only guard for the connected account", /is not a NEAR testnet account/],
  ["wallet network check before signing", /Wallet network is/],
  ["testnet live banner", /testnet-live-banner/],
];
const MUST_NOT = [
  ["read-only stubs (this build is meant to sign)", /SIGNING_DISABLED: public read-only build|SIGNING_LOCKED: this build/],
  ["e2e test hook", /__SOL2NEAR_E2E|__signCalls/],
  ["eval", /\beval\(/],
  ["key material", /ed25519:[1-9A-HJ-NP-Za-km-z]{40,}|secp256k1:[1-9A-HJ-NP-Za-km-z]{40,}/],
];
let bad = 0;
for (const [n, re] of MUST) re.test(js) ? console.log(`PASS has ${n}`) : (bad++, console.log(`FAIL missing ${n}`));
for (const [n, re] of MUST_NOT) { const m = js.match(re); m ? (bad++, console.log(`FAIL found ${n}: "${m[0].slice(0, 40)}"`)) : console.log(`PASS no ${n}`); }
/Content-Security-Policy/.test(html) && /connect-src/.test(html) && /form-action 'none'/.test(html)
  ? console.log("PASS CSP meta (connect-src restricted)") : (bad++, console.log("FAIL CSP meta missing"));
console.log(bad ? `\n${bad} check(s) FAILED for ${dir}` : `\ntestnet live bundle: signing only in the user's own wallet, after a review (${files.length} JS file(s), ${(js.length / 1024).toFixed(0)} KB)`);
process.exit(bad ? 1 : 0);
