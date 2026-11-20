import { expect, jest } from "@jest/globals";
import recordings from "./fixtures/device-lane-recordings.json";
import type { DiditEvent } from "../types";

/**
 * Replays the real answers the Didit verification API gave to
 * POST /v1/events/batch/ (see fixtures/device-lane-recordings.json). A stub
 * only answers a request whose token and events are the ones that were
 * recorded, so a test can never pair an answer with a request it was not given.
 */

export type ScenarioName = keyof typeof recordings.scenarios;

export interface RecordedEvent {
  event_id: string;
  event_category: string;
  action_type: string;
  occurred_at: string;
  time_zone: string;
  payload?: Record<string, unknown>;
  session?: { session_id?: string; page_url?: string };
}

interface Scenario {
  token: string;
  request: { events: RecordedEvent[] };
  response: { status: number; body: unknown };
}

export function scenario(name: ScenarioName): Scenario {
  return recordings.scenarios[name] as unknown as Scenario;
}

export function recordedBody(name: ScenarioName): unknown {
  return scenario(name).response.body;
}

/** The recorded events, rewritten as the camelCase events an integrator passes to submitEvent. */
export function recordedEvents(name: ScenarioName): DiditEvent[] {
  return scenario(name).request.events.map((event) => {
    const input: DiditEvent = {
      eventId: event.event_id,
      category: event.event_category as DiditEvent["category"],
      actionType: event.action_type,
      occurredAt: event.occurred_at,
      timeZone: event.time_zone
    };
    if (event.payload) input.payload = event.payload;
    if (event.session) input.session = { sessionId: event.session.session_id, pageUrl: event.session.page_url };
    return input;
  });
}

export interface SentRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string>; keepalive?: boolean };
  body: { events: RecordedEvent[]; fingerprint_v2?: Record<string, unknown> };
}

export function sentRequests(fetchMock: jest.Mock<typeof fetch>): SentRequest[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    init: init as SentRequest["init"],
    body: JSON.parse(String(init?.body))
  }));
}

export function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** Answers each request with the recording whose token and full events it carries. */
export function replay(...names: ScenarioName[]): (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const sentEvents = JSON.parse(String(init?.body)).events;
    const match = names
      .map((name) => scenario(name))
      .find(
        (recorded) =>
          recorded.token === headers["X-Monitoring-Token"] &&
          JSON.stringify(recorded.request.events) === JSON.stringify(sentEvents)
      );
    expect(String(url)).toMatch(/\/v1\/events\/batch\/$/);
    if (!match) throw new Error("No recording matches the request.");
    return respond(match.response.status, match.response.body);
  };
}
