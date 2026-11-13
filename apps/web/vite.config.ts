import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `--mode e2e` (Playwright build only) enables the mocked-wallet test hook; the production build never has it.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "./",
  define: mode === "e2e" ? { "import.meta.env.VITE_E2E": JSON.stringify("1") } : {},
}));
