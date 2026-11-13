// Must be the FIRST import of main.tsx. Some wallet / Solana dependencies expect Node globals while their
// modules load: @solana/spl-token reads `Buffer`; the NEAR wallet stack reads `global` and `process`.
// The production build worked without them (Rollup handles these packages differently); the Vite dev
// server (`pnpm dev`, README step 6) rendered a blank page, then failed to load the wallet selector.
import { Buffer } from "buffer";

type ProcessShim = { env: Record<string, string>; browser: boolean; version: string; versions: Record<string, string>; nextTick: (cb: (...a: unknown[]) => void, ...a: unknown[]) => void };
const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: typeof globalThis; process?: ProcessShim };
g.Buffer ??= Buffer;
g.global ??= globalThis;
// `versions.node` stays undefined so no library takes a Node-only code path in the browser.
g.process ??= { env: {}, browser: true, version: "", versions: {}, nextTick: (cb, ...a) => queueMicrotask(() => cb(...a)) };
