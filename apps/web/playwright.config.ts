import { defineConfig } from "@playwright/test";

// Real local Google Chrome (channel "chrome"): no browser download. Serves the e2e build (VITE_E2E=1).
// Two projects, never mixed in the report:
// - "offline": @offline (replayed RPC snapshot, every public endpoint blocked) and @preview (sandbox / mainnet fixtures).
//   Deterministic: NO retry — a failure here is a real failure.
// - "live": smoke tests that read public NEAR testnet / mainnet, Solana devnet and Tidepool endpoints, which have no SLA.
//   One retry absorbs a provider blip; retried tests are listed as "flaky" in the report, never hidden.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { channel: "chrome", headless: true, baseURL: "http://127.0.0.1:4181", screenshot: "only-on-failure" },
  projects: [
    { name: "offline", grep: /@offline|@preview/, retries: 0 },
    { name: "live", grepInvert: /@offline|@preview/, retries: 1 },
  ],
  webServer: [
    {
      command: "npx vite preview --outDir dist-e2e --port 4181 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:4181",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // The Vite DEV server, exactly what README step 6 runs (`pnpm --filter @sol2near/web dev`).
      command: "npx vite --port 4184 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:4184",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
