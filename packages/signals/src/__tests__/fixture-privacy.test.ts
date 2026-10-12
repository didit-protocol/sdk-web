import { describe, expect, it } from "@jest/globals";
import recordings from "./fixtures/device-lane-recordings.json";

// This recording alone uses sequential UUIDs in this synthetic namespace.
// Check field paths, never rejected values, so failures are safe to publish.
const SYNTHETIC_UUID = /^00000000-0000-4000-8000-[0-9a-f]{12}$/;
const UUID = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi;

function unsafeIdentifierPaths(value: unknown, path = "$", key = ""): string[] {
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([name, child]) => unsafeIdentifierPaths(child, `${path}.${name}`, name));
  }
  if (key === "event_uuid") return typeof value === "string" && SYNTHETIC_UUID.test(value) ? [] : [path];
  if (typeof value !== "string") return [];

  return (value.match(UUID) ?? []).some((id) => !SYNTHETIC_UUID.test(id)) ? [path] : [];
}

describe("recorded device lane fixture privacy", () => {
  it("contains only deterministic synthetic UUIDs, including nested fields", () => {
    expect(unsafeIdentifierPaths(recordings)).toEqual([]);
  });

  it("accepts the documented synthetic namespace", () => {
    const sample = { results: [{ event_uuid: "00000000-0000-4000-8000-000000000001" }] };

    expect(unsafeIdentifierPaths(sample)).toEqual([]);
  });

  it("rejects unnormalized UUIDs without echoing their values", () => {
    // Invented negative example, not a retained service identifier.
    const sample = { results: [{ event_uuid: "11111111-1111-4111-8111-111111111111" }] };

    expect(unsafeIdentifierPaths(sample)).toEqual(["$.results.0.event_uuid"]);
  });

  it("also rejects unnormalized UUIDs embedded outside event_uuid fields", () => {
    const sample = { response: { detail: "Unknown event 11111111-1111-4111-8111-111111111111." } };

    expect(unsafeIdentifierPaths(sample)).toEqual(["$.response.detail"]);
  });

  it.each([null, 42, "", "synthetic-event"])("rejects malformed stored identifiers (%p)", (event_uuid) => {
    expect(unsafeIdentifierPaths({ event_uuid })).toEqual(["$.event_uuid"]);
  });

  it("preserves distinct stored identities and their accepted/replayed relationships", () => {
    const accepted = recordings.scenarios.accepted.response.body.results;
    const replayed = recordings.scenarios.replayed.response.body.results;
    const identity = ({ index, event_id, event_uuid }: (typeof accepted)[number]) => [index, event_id, event_uuid];

    expect(new Set(accepted.map(({ event_uuid }) => event_uuid)).size).toBe(accepted.length);
    expect(replayed.map(identity)).toEqual(accepted.map(identity));
    expect(recordings.scenarios.replayed.request).toEqual(recordings.scenarios.accepted.request);
  });
});
