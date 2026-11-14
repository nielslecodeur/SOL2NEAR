#!/usr/bin/env node
// V4.3A release hygiene check. READ-ONLY: reads tracked files and the web build, writes nothing, calls no network.
//   node scripts/check-release.mjs            (after `pnpm --filter @sol2near/web build` for the bundle checks)
// Checks: no secret / key material in tracked files or the bundle, no personal absolute path in code, no test hook
// or eval in the production bundle, every fixture referenced by a test exists, no destructive command in scripts,
// toolchain declared. Exit code 1 on any failure.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
let bad = 0;
const pass = (m) => console.log(`PASS ${m}`);
const fail = (m) => { bad++; console.log(`FAIL ${m}`); };
const text = (f) => { try { return readFileSync(join(root, f), "utf8"); } catch { return ""; } };
const isText = (f) => !/\.(jpg|jpeg|png|gif|ico|wasm|woff2?|lock)$/i.test(f);

// 1. key material (NEAR ed25519 secret keys are 64 bytes → ~87-88 base58 chars; public keys ~43-44)
const SECRET = [
  // a 64-byte ed25519 SIGNATURE (public, e.g. a Tidepool quote) has the same length as a secret key: skip "signature" fields
  [/(?<!"signature"\s*:\s*")ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/, "NEAR secret key"],
  [/"private_key"\s*:/, "private_key field"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
  [/\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/, "64-byte array (Solana keypair file)"],
];
const hits = [];
for (const f of files.filter(isText)) for (const [re, what] of SECRET) if (re.test(text(f))) hits.push(`${f}: ${what}`);
hits.length ? fail(`key material in tracked files: ${hits.join("; ")}`) : pass(`no key material in ${files.length} tracked files`);
const sensitive = files.filter((f) => /(^|\/)(\.env(\..*)?|id\.json|.*-keypair\.json|.*\.pem|.*\.key)$/.test(f) && !f.endsWith(".env.example"));
sensitive.length ? fail(`sensitive file names tracked: ${sensitive.join(", ")}`) : pass("no .env / keypair / pem file tracked");

// 2. personal absolute paths in code (docs may cite the author's working folder; code must not depend on it)
const code = files.filter((f) => isText(f) && !f.startsWith("docs/") && !/\.md$/.test(f));
// the author's own paths only: third-party build paths recorded on-chain (e.g. Nearly's /home/near/code in its
// contract_source_metadata, kept verbatim in an evidence fixture) are not a dependency of this repo
const paths = code.filter((f) => /[A-Z]:\\Users\\|\/home\/niels\/(?!\.cargo|\.near|sol2near-target)|OneDrive/.test(text(f)));
paths.length ? fail(`personal absolute path in code: ${paths.join(", ")}`) : pass(`no personal absolute path in ${code.length} code/config files`);

// 3. production bundle
const dist = join(root, "apps/web/dist/assets");
if (!existsSync(dist)) fail("apps/web/dist missing: run `pnpm --filter @sol2near/web build` first");
else {
  const js = readdirSync(dist).filter((f) => f.endsWith(".js"));
  const all = js.map((f) => readFileSync(join(dist, f), "utf8")).join("\n");
  /\beval\(/.test(all) ? fail("eval( in the production bundle") : pass(`no eval( in ${js.length} bundle files`);
  /__SOL2NEAR_E2E/.test(all) ? fail("e2e hook in the production bundle") : pass("no e2e hook in the production bundle");
  const k = SECRET.filter(([re]) => re.test(all)).map(([, w]) => w);
  k.length ? fail(`key material in the bundle: ${k.join(", ")}`) : pass("no key material in the bundle");
}

// 4. fixtures referenced by tests exist and are tracked
const refs = new Set();
for (const f of files.filter((f) => /\.(test\.ts|spec\.ts|rs|tsx|ts)$/.test(f)))
  for (const m of text(f).matchAll(/fixtures\/([A-Za-z0-9_.\-]+\.json)/g)) refs.add(m[1]);
const missing = [...refs].filter((r) => !files.includes(`packages/near-client/src/fixtures/${r}`) && !files.some((f) => f.endsWith(`/fixtures/${r}`)));
missing.length ? fail(`fixtures referenced but not tracked: ${missing.join(", ")}`) : pass(`${refs.size} referenced fixtures are tracked`);

// 5. no destructive command in scripts / probes
const scripts = files.filter((f) => f.startsWith("scripts/") || f.startsWith("sandbox-tests/run"));
const destructive = scripts.filter((f) => /\brm\s+-rf?\b|\bdelete-account\b|\baccount\s+delete\b|\bnear\s+delete\b|git\s+push|--force\b/.test(text(f)));
destructive.length ? fail(`destructive command in scripts: ${destructive.join(", ")}`) : pass(`no destructive command in ${scripts.length} scripts`);

// 6. toolchain declared
const pkg = JSON.parse(text("package.json"));
pkg.engines?.node ? pass(`node engine declared: ${pkg.engines.node}`) : fail("package.json engines.node missing");
pkg.packageManager ? pass(`package manager pinned: ${pkg.packageManager}`) : fail("packageManager missing");
existsSync(join(root, "pnpm-lock.yaml")) && existsSync(join(root, "Cargo.lock")) ? pass("pnpm-lock.yaml and Cargo.lock present") : fail("lockfile missing");

// 7. sandbox wasm are fetched, never committed (third-party code, reproducible from chain)
const wasm = files.filter((f) => f.endsWith(".wasm"));
wasm.length ? fail(`wasm committed: ${wasm.join(", ")}`) : pass("no wasm committed (sandbox wasm are fetched by scripts/probes/fetch-*.mjs)");

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall release checks passed");
process.exit(bad ? 1 : 0);
