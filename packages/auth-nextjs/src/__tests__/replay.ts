import { readFileSync } from "node:fs";
import { join } from "node:path";

import recorded from "./fixtures/runtime-responses.json";

export { recorded };

/** A scenario @didit-protocol/auth recorded against a local Didit auth service (its own test fixtures). */
export function coreFixture(scenario: string) {
  return JSON.parse(readFileSync(join(__dirname, "../../../auth/src/__tests__/fixtures", `${scenario}.json`), "utf8"));
}

interface MintedKey {
  origin: string;
  publishableKey: string;
}

/** Publishable keys the local Didit auth service minted, with the application origin each names. */
export const KEYS = coreFixture("publishable-keys") as Record<"localSandbox" | "sandbox" | "live" | "customDomain", MintedKey>;

/** The application's origin, which its publishable key names: the Frontend API. */
export const FRONTEND_API = KEYS.localSandbox.origin;
export const ENV = { DIDIT_PUBLISHABLE_KEY: KEYS.localSandbox.publishableKey, DIDIT_REDIRECT_URI: "http://localhost:3000/auth/callback" };

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
 * expected call answers once; an unexpected call, or one to another origin
 * than the publishable key names, fails the test.
 */
export function replay(...expected: Expected[]) {
  const queue = [...expected];
  const calls: Call[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const path = url.pathname.replace(/^\//, "") + url.search;

    if (url.origin !== FRONTEND_API) throw new Error(`Call to another origin: ${method} ${url.href}`);
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
