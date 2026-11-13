import { errMessage, fail } from "./errors.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpConfig {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * One JSON request to Tidepool. Network failures -> `network`; 4xx -> `validation` (Tidepool's own
 * message is passed through verbatim); 5xx / 429 / non-JSON -> `http`.
 */
export async function requestJson<T>(cfg: HttpConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const doFetch = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(cfg.baseUrl + path, {
      method,
      headers: { accept: "application/json", ...(body !== undefined && { "content-type": "application/json" }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
    });
  } catch (e) {
    throw fail("network", `${method} ${path}: ${errMessage(e)}`);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const j = json as { message?: unknown; error?: unknown } | undefined;
    const msg = String(j?.message ?? j?.error ?? text).slice(0, 300);
    const kind = res.status >= 400 && res.status < 500 && res.status !== 429 ? "validation" : "http";
    throw fail(kind, `Tidepool ${method} ${path} -> HTTP ${res.status}: ${msg}`, res.status);
  }
  if (json === undefined) throw fail("http", `Tidepool ${method} ${path}: response is not JSON`, res.status);
  return json as T;
}
