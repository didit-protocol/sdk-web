import { DiditAuthError } from "./errors";

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  token?: string;
}

export interface HttpClient {
  <T>(path: string, options?: RequestOptions): Promise<T>;
}

type Body = Record<string, unknown> | null;

const CODE = /^[a-z][a-z_]*$/;

function firstCode(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && CODE.test(first) ? first : null;
}

function fieldErrors(body: Body): Record<string, string[]> | undefined {
  const fields: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (key === "error" || key === "detail") continue;
    const list = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string");
    if (list.length) fields[key] = list;
  }
  return Object.keys(fields).length ? fields : undefined;
}

function fallbackCode(status: number): string {
  if (status === 401) return "invalid_token";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return status >= 500 ? "server_error" : "invalid_request";
}

/**
 * Maps a Didit API error response to a DiditAuthError. The API answers with
 * `{"error": code}`, `{"detail": code}` or per-field codes such as
 * `{"password": "password_policy"}` (kept in `fields`); throttling answers 429
 * with prose.
 */
export function toError(status: number, body: Body, retryAfter?: number): DiditAuthError {
  const fields = fieldErrors(body);
  const code =
    status === 429
      ? "rate_limited"
      : firstCode(body?.error) ??
        firstCode(body?.detail) ??
        Object.values(fields ?? {})
          .map(firstCode)
          .find(Boolean) ??
        fallbackCode(status);
  const detail = typeof body?.detail === "string" && !CODE.test(body.detail) ? body.detail : undefined;

  return new DiditAuthError(code, detail, { status, fields, retryAfter });
}

export function createHttpClient(
  base: string,
  fetchImpl: typeof fetch,
  extraHeaders: () => Promise<Record<string, string>>
): HttpClient {
  return async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...(await extraHeaders()) };
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    let response: Response;
    try {
      response = await fetchImpl(`${base}/${path}`, {
        method: options.method ?? (options.body ? "POST" : "GET"),
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        // The runtime API authenticates with bearer tokens only: never send the auth domain's cookies.
        credentials: "omit"
      });
    } catch (error) {
      throw new DiditAuthError("network_error", error instanceof Error ? error.message : undefined);
    }
    const text = response.status === 204 ? "" : await response.text().catch(() => "");
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const body = data && typeof data === "object" && !Array.isArray(data) ? (data as Body) : null;
      throw toError(response.status, body, Number(response.headers.get("Retry-After")) || undefined);
    }
    return data as T;
  };
}
