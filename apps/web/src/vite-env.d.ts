/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** "1" only in the e2e build (`vite build --mode e2e`): enables the mocked-wallet test hook. */
  readonly VITE_E2E?: string;
  /** "1" only in the public read-only build (`--mode public`). */
  readonly VITE_PUBLIC_READ_ONLY?: string;
}
