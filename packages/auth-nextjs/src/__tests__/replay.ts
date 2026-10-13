import recorded from "./fixtures/runtime-responses.json";

export { recorded };

export const FRONTEND_API = "http://127.0.0.1:8000/auth/v2/authentication/00000000-0000-4000-8000-000000000003";
export const ENV = { DIDIT_FRONTEND_API: FRONTEND_API, DIDIT_REDIRECT_URI: "http://localhost:3000/auth/callback" };

export interface RecordedResponse {
  status: number;
  body: unknown;
}

interface Expected {
  method: string;
  path: string;
  response: RecordedResponse;
}

export interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}

/**
 * Replaces fetch with a replay of recorded Frontend API responses. Each
 * expected call answers once; an unexpected call fails the test.
 */
export function replay(...expected: Expected[]) {
  const queue = [...expected];
  const calls: Call[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const path = url.pathname.replace(new URL(FRONTEND_API).pathname, "").replace(/^\//, "") + url.search;

    calls.push({ method, path, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    const index = queue.findIndex((entry) => entry.method === method && entry.path === path);

    if (index < 0) throw new Error(`Unexpected call: ${method} ${path}`);
    const [{ response }] = queue.splice(index, 1);

    return new Response(response.body === null ? null : JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  return { calls, remaining: () => queue.map((entry) => `${entry.method} ${entry.path}`) };
}
