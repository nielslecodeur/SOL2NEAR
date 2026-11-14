import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = (p: string) => resolve(fileURLToPath(new URL(".", import.meta.url)), p);

/**
 * PUBLIC READ-ONLY build (`vite build --mode public`): the modules able to sign are REPLACED at module resolution, so
 * their code is not in the bundle at all (checked by scripts/check-public-bundle.mjs):
 * - src/NearPanel.tsx          → src/public/NearPanelReadOnly.tsx  (no NEAR Wallet Selector, no @near-js/transactions)
 * - src/BridgeLive.tsx         → src/public/BridgeReadOnly.tsx     (no Phantom detection, no Tidepool deposit)
 * - src/near/wallet.ts, packages/crosschain/src/wallet.ts → src/public/noSigning.ts (any signing call throws)
 * - packages/crosschain/src/solana.ts → src/public/noSolanaTx.ts   (no Solana transaction can even be built)
 */
function publicReadOnly(): Plugin {
  const swap: [RegExp, string][] = [
    [/[\\/]src[\\/]NearPanel\.tsx$/, here("src/public/NearPanelReadOnly.tsx")],
    [/[\\/]src[\\/]BridgeLive\.tsx$/, here("src/public/BridgeReadOnly.tsx")],
    [/[\\/]src[\\/]near[\\/]wallet\.ts$/, here("src/public/noSigning.ts")],
    [/[\\/]packages[\\/]crosschain[\\/]src[\\/]wallet\.ts$/, here("src/public/noSigning.ts")],
    [/[\\/]packages[\\/]crosschain[\\/]src[\\/]solana\.ts$/, here("src/public/noSolanaTx.ts")],
  ];
  return {
    name: "sol2near-public-read-only",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r) return null;
      for (const [re, target] of swap) if (re.test(r.id.split("?")[0]!)) return target;
      return null;
    },
    // Defence in depth: the browser may only connect to the read-only data sources the app uses.
    transformIndexHtml(html) {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self' https://near-testnet.drpc.org https://test.rpc.fastnear.com https://free.rpc.fastnear.com https://near.drpc.org https://api.devnet.solana.com https://www.usetidepool.tech",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join("; ");
      return html
        .replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
        .replace("<title>SOL2NEAR — testnet</title>", "<title>SOL2NEAR — public read-only demo (testnet)</title>");
    },
  };
}

/**
 * TRY TESTNET build (`vite build --mode testnet`): the REAL NEAR Wallet Selector (MyNearWallet, Meteor, testnet only) and
 * Phantom connection stay, so a visitor can connect a real wallet and read their real testnet balances and Treasury
 * deposits. Every signature is locked: VITE_SIGNING_LOCKED makes src/near/wallet.ts refuse before the wallet is asked and
 * hides the send buttons, and the Solana signer (packages/crosschain/src/wallet.ts) is replaced by the refusing stub.
 * Checked by scripts/check-testnet-bundle.mjs. Not deployed anywhere unless the lead approves it.
 */
function tryTestnet(): Plugin {
  const ro = publicReadOnly();
  return {
    name: "sol2near-try-testnet",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (r && /[\\/]packages[\\/]crosschain[\\/]src[\\/]wallet\.ts$/.test(r.id.split("?")[0]!)) return here("src/public/noSigning.ts");
      return null;
    },
    transformIndexHtml(html) {
      const withCsp = (ro.transformIndexHtml as (h: string) => string)(html);
      return withCsp.replace(/<title>[^<]*<\/title>/, "<title>SOL2NEAR — Try Testnet (connect and read, signing locked)</title>");
    },
  };
}

// `--mode e2e` (Playwright build only) enables the mocked-wallet test hook; the production build never has it.
// `--mode public` builds the read-only demo (no signing code at all).
export default defineConfig(({ mode }) => ({
  plugins: mode === "public" ? [publicReadOnly(), react()] : mode === "testnet" ? [tryTestnet(), react()] : [react()],
  base: "./",
  define:
    mode === "e2e" ? { "import.meta.env.VITE_E2E": JSON.stringify("1") }
    : mode === "public" ? { "import.meta.env.VITE_PUBLIC_READ_ONLY": JSON.stringify("1") }
    : mode === "testnet" ? { "import.meta.env.VITE_SIGNING_LOCKED": JSON.stringify("1") }
    : {},
}));
