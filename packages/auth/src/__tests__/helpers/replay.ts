import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";

import { seededRandomValues } from "./seeded-random";

export interface Exchange {
  request: { method: string; path: string; authorization?: string; body?: unknown };
  response: { status: number; headers?: Record<string, string>; body: unknown };
}

/**
 * Real exchanges between this SDK and a local Didit auth service, recorded in
 * order for one scenario (see fixtures/README.md). Extra keys are the inputs
 * and outcomes of that recording, such as the code that was emailed.
 */
export interface Fixture {
  scenario: string;
  apiBase: string;
  redirectUri: string;
  events: string[];
  exchanges: Exchange[];
  [note: string]: unknown;
}

export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
}

export function publishableKeyFor(apiBase: string, mode: "test" | "live" = "test"): string {
  return `pk_${mode}_${Buffer.from(apiBase).toString("base64url")}`;
}

/**
 * A fetch that answers with the recorded responses, in order, after checking
 * that the SDK sent exactly the recorded request (address, method, bearer
 * token and JSON body). The SDK draws the same random values as during the
 * recording, so PKCE verifiers, challenges and states match byte for byte.
 */
export function replay(fixture: Fixture) {
  let index = 0;
  const mismatches: string[] = [];
  const headers: Record<string, string>[] = [];

  jest.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(seededRandomValues(fixture.scenario) as never);

  const fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const exchange = fixture.exchanges[index++];
    const sent = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(init.body as string) : undefined;

    headers.push(sent);
    if (!exchange) {
      mismatches.push(`unexpected request ${init.method} ${url}`);
      throw new TypeError("no recorded exchange");
    }
    const { request, response } = exchange;
    const expected = canonical({
      url: `${fixture.apiBase}/${request.path}`,
      method: request.method,
      authorization: request.authorization,
      body: request.body
    });
    const actual = canonical({ url, method: init.method, authorization: sent.Authorization, body });

    if (actual !== expected || init.credentials !== "omit") {
      mismatches.push(`exchange ${index - 1}: sent ${actual}, recorded ${expected}`);
      throw new TypeError("request differs from the recording");
    }
    const text = response.body === null ? "" : JSON.stringify(response.body);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: { get: (name: string) => response.headers?.[name] ?? null },
      text: async () => text
    } as unknown as Response;
  });

  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    headers,
    get count() {
      return index;
    },
    /** Every recorded exchange was requested exactly as recorded. */
    verify(consumed = fixture.exchanges.length) {
      expectNoMismatch(mismatches);
      if (index !== consumed) throw new Error(`requested ${index} of ${consumed} recorded exchanges`);
    }
  };
}

/** JSON with sorted keys and without undefined members, so key order never matters. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, member) =>
    member && typeof member === "object" && !Array.isArray(member)
      ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => (a < b ? -1 : 1)))
      : member
  );
}

function expectNoMismatch(mismatches: string[]): void {
  if (mismatches.length) throw new Error(mismatches.join("\n"));
}

/** Moves the SDK's clock forward, as the recording did to reach the access token's expiry. */
export function advanceClock(milliseconds: number): void {
  const now = Date.now();
  jest.spyOn(Date, "now").mockImplementation(() => now + milliseconds);
}
