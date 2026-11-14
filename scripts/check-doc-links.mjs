// Checks every relative link in the repository's Markdown files: the target file (or folder) must exist.
// Read-only. Usage: node scripts/check-doc-links.mjs   → exit 1 if a link is broken.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
/** Paths that a planning document asks to CREATE (never delivered under that name): not links to check. */
const PLANNED = new Set(["docs/V4_FEASIBILITY.md"]); // delivered as docs/V4_2A_DCL_FEASIBILITY.md
const SKIP = new Set(["node_modules", "target", ".git", "dist", "dist-e2e", "dist-public", "test-results", "out", "res", ".vercel"]);

export function markdownFiles(dir = root, acc = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) markdownFiles(p, acc);
    else if (e.endsWith(".md")) acc.push(p);
  }
  return acc;
}

/** Relative link targets of a Markdown text: [text](target) and ![alt](target), without anchors or titles. */
export function relativeLinks(text) {
  const out = [];
  const prose = text.replace(/```[\s\S]*?```/g, (c) => " ".repeat(c.length)).replace(/`[^`\n]*`/g, (c) => " ".repeat(c.length)); // code is not a link
  for (const m of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const t = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("#") || t.startsWith("/")) continue;
    out.push({ raw: t, path: decodeURI(t.split("#")[0]), index: m.index });
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  let bad = 0, total = 0;
  for (const f of markdownFiles()) {
    for (const l of relativeLinks(readFileSync(f, "utf8"))) {
      if (!l.path) continue;
      total++;
      if (!existsSync(resolve(dirname(f), l.path))) { bad++; console.log(`BROKEN ${relative(root, f)} → ${l.raw}`); }
    }
    // repo-root paths quoted in code spans, e.g. `docs/G8_PROOF_LEDGER.md`, must exist too
    for (const m of readFileSync(f, "utf8").matchAll(/`(docs\/[\w./-]+\.md)`/g)) {
      if (PLANNED.has(m[1])) continue;
      total++;
      if (!existsSync(join(root, m[1]))) { bad++; console.log(`MISSING ${relative(root, f)} → ${m[1]}`); }
    }
  }
  console.log(bad ? `\n${bad} broken link(s) of ${total}` : `all ${total} relative Markdown links resolve`);
  process.exit(bad ? 1 : 0);
}
