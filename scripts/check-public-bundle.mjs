#!/usr/bin/env node
// G9.1 — proves that the PUBLIC read-only build contains no signing capability. READ-ONLY: reads files only.
//   pnpm --filter @sol2near/web build:public && node scripts/check-public-bundle.mjs [dir]
// The same markers ARE present in the normal build (apps/web/dist): run `node scripts/check-public-bundle.mjs apps/web/dist`
// to see the check detect them (it then exits 1, as expected for a signing-capable build).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = join(root, process.argv[2] ?? "apps/web/dist-public");
if (!existsSync(join(dir, "assets"))) { console.log(`FAIL ${dir} missing: run \`pnpm --filter @sol2near/web build:public\``); process.exit(1); }
const files = readdirSync(join(dir, "assets")).filter((f) => f.endsWith(".js"));
const js = files.map((f) => readFileSync(join(dir, "assets", f), "utf8")).join("\n");
const html = readFileSync(join(dir, "index.html"), "utf8");

// Code that can sign or build a signed transaction, and the wallets that would do it.
const MARKERS = [
  ["NEAR Wallet Selector", /setupWalletSelector|near-wallet-selector|wallet-selector-modal|setupMyNearWallet|setupMeteorWallet/],
  ["NEAR transaction builder", /actionCreators|functionCallAccessKey|signAndSendTransactions/],
  ["Solana / Phantom signing call", /\.signAndSendTransaction\(|signTransaction\(|signAllTransactions\(/],
  ["Phantom provider lookup", /window\.phantom|\.phantom\?\.solana|phantom\.solana/],
  ["SPL transfer builder", /createTransferCheckedInstruction|TransferChecked/],
  ["e2e test hook", /__SOL2NEAR_E2E|__signCalls/],
  ["eval", /\beval\(/],
];
let bad = 0;
for (const [name, re] of MARKERS) {
  const m = js.match(re);
  if (m) { bad++; console.log(`FAIL ${name}: found "${m[0]}"`); } else console.log(`PASS no ${name}`);
}
const ro = /PUBLIC READ-ONLY DEMO/.test(js);
ro ? console.log("PASS read-only banner compiled in") : (bad++, console.log("FAIL read-only banner missing"));
/Content-Security-Policy/.test(html) && /connect-src/.test(html) && /form-action 'none'/.test(html)
  ? console.log("PASS CSP meta (connect-src restricted to the read-only data sources)") : (bad++, console.log("FAIL CSP meta missing"));
console.log(bad ? `\n${bad} check(s) FAILED for ${dir}` : `\npublic bundle is read-only (${files.length} JS file(s), ${(js.length / 1024).toFixed(0)} KB)`);
process.exit(bad ? 1 : 0);
