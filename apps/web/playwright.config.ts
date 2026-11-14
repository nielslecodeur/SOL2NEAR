import { defineConfig } from "@playwright/test";

// Real local Google Chrome (channel "chrome"): no browser download. Serves the e2e build (VITE_E2E=1).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // Live tests read public NEAR / Solana / Tidepool endpoints without SLA: one retry absorbs a provider blip; the report lists retried tests as "flaky".
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  use: { channel: "chrome", headless: true, baseURL: "http://127.0.0.1:4181", screenshot: "only-on-failure" },
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
