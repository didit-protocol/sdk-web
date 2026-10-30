# @didit-protocol/signals

Didit device signals and end-user event monitoring for the browser, in under 5 KB minified and gzipped.

- **`submitEvent`** sends sign-ups, logins, failed logins, logouts and any other end-user event to Didit's [event monitoring](https://docs.didit.me/transaction-monitoring/events), tied to the same person as their verifications and transactions.
- **Device signals**: the didit-fp-v2 device fingerprint is attached to every batch. Page exit uses the available signals if its composite hash is still pending.
- Works alone or together with the other Didit SDKs: [`@didit-protocol/sdk-web`](https://www.npmjs.com/package/@didit-protocol/sdk-web) depends on this package and re-exports it, so an app that uses both shares one event queue per module format. Standalone CDN and script-tag builds each carry their own queue.

## Installation

```bash
npm install @didit-protocol/signals
```

Script tag (exposes `window.DiditSignals`):

```html
<script src="https://unpkg.com/@didit-protocol/signals/dist/didit-signals.umd.min.js"></script>
```

## Quick start

Your backend mints a short-lived monitoring token for the signed-in person with your API key:

```bash
curl -X POST https://verification.didit.me/v3/events/sdk-token/ \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "vendor_data": "user_391", "allowed_event_categories": ["auth", "session"] }'
```

The page submits events with it:

```typescript
import { submitEvent, flush, configureEvents, DiditEventError } from "@didit-protocol/signals";

configureEvents({
  onError: (error: DiditEventError) => console.warn(error.type, error.eventIds, error.errors),
});

const eventId = submitEvent({
  monitoringToken, // from your backend - never ship an API key
  event: { category: "auth", actionType: "signup", payload: { method: "passkey" } },
});

// Optional: send right away (for example before a redirect you control) and read each outcome.
const result = await flush();
// { acceptedCount, replayedCount, rejectedCount, pendingCount, results: [{ eventId, outcome, eventUuid, status, score, error }] }
```

The person an event belongs to always comes from the token: Didit overwrites any subject in the request with the `vendor_data` the token was minted for, and takes the IP address, user agent and origin from the request.

## How events are sent

| When | How |
|------|-----|
| 25 events are waiting | One `POST /v1/events/batch/` right away |
| 5 seconds after an event was queued | Everything that is waiting |
| The page is hidden or closed | Waiting events that fit the page-exit budget, with `fetch` and `keepalive` so the request outlives the page |
| You call `flush()` | Everything that is waiting; resolves with each event's outcome |

- Every request carries the `X-Monitoring-Token` header and the device fingerprint (`fingerprint_v2` in the body plus its matching `X-Didit-*` headers).
- Each event keeps the token it was submitted with; events with different tokens never share a request, so a sign-out and a new sign-in on the same page never mix people.
- Delivery is best effort: the in-memory queue is lost when the page closes, and browsers may terminate requests. At page exit, browsers allow 64 KiB of `keepalive` requests per page; what does not fit stays queued and is sent if the page comes back. `sendBeacon` is not used: it cannot carry the token header.
- Exit requests start right away with the collected persistent device id, browser signals and bot context. If WebCrypto hashing is still pending, `compositeHash` is empty and `X-Didit-FP-Hash` is omitted, and those events are stored without the composite hash. Normal batches and `flush()` wait for the complete fingerprint, and exit requests use it once it is ready.
- On a network error, HTTP timeout (408), rate limit (429), server error (5xx) or an unreadable answer, the same events are sent again after 10, 20 and 40 seconds, then every minute. They are re-sent byte for byte, so an event Didit already stored comes back as `replayed` instead of being stored twice.
- A refusal is final and is reported through `onError` and in the `flush()` results:

| `error.type` | Meaning |
|--------------|---------|
| `invalid_token` | The token is unknown, revoked, out of uses or bound to another origin (HTTP 401) |
| `expired_token` | The token's lifetime has elapsed (HTTP 401) |
| `monitoring_disabled` | Event monitoring is not switched on for the application (HTTP 403) |
| `validation` | The event failed validation; `error.errors` has Didit's per-field details |
| `dropped` | The queue was full and the event was dropped before it was sent |

`submitEvent` itself throws a `DiditEventError` only for a missing token (`invalid_token`), a missing `category` or `actionType` (`validation`), or an environment without `fetch` (`network`).

## API

### `submitEvent({ monitoringToken, event, baseUrl? }): string`

Queues one event and returns its id.

| Event field | Description |
|-------------|-------------|
| `category` | `auth`, `session`, `security`, `payment`, `dispute`, `gameplay`, `bonus`, `affiliate`, `responsible_gambling` or `custom` |
| `actionType` | What happened, e.g. `signup`, `login`, `login_failed`, `logout`, `password_reset`, `mfa_challenge` |
| `eventId` | Your idempotency key (at most 128 characters); a UUID is generated when omitted |
| `occurredAt` | `Date` or ISO 8601 string; defaults to now (at most 7 days in the past) |
| `timeZone` | IANA time zone; defaults to the browser's |
| `payload` | Category-specific keys; payments need `payment_reference_id`, `amount`, `currency`, `payment_method` and `status` |
| `customValues` | Scalar values your rules can address |
| `session` | `{ sessionId, sequence, pageUrl, referrer }` |
| `transactionContext` | `{ amount, currency, direction, paymentReferenceId }` |
| `subject` | Profile hints `{ fullName, email, phone, country }`; the person always comes from the token |
| `business` | The business the event belongs to |

### `flush(): Promise<DiditEventFlushResult>`

Sends everything that is waiting. Never rejects: events that could not be sent are counted in `pendingCount` and retried automatically.

### `configureEvents(options)`

| Option | Default | Description |
|--------|---------|-------------|
| `baseUrl` | `https://verification.didit.me` | Didit verification API base URL |
| `batchSize` | `25` | Send as soon as this many events are waiting (1 to 500) |
| `flushIntervalMs` | `5000` | Send waiting events after this many milliseconds |
| `maxQueueSize` | `1000` | Events held in memory. When full, low-value events (`session.page_view` and the like) are dropped first; `security`, `payment`, `dispute`, `responsible_gambling` and bet events are never dropped, so this is a soft limit |
| `onError` | none | Called with a `DiditEventError` for every refused or dropped event |

### Device signals

- `getDeviceFingerprintPayload(): Promise<DeviceFingerprintPayload | null>` collects the didit-fp-v2 fingerprint (`null` outside a browser).
- `buildFingerprintHeaders(payload)` returns the matching `X-Didit-*` headers.

Full guide: [SDK Event Submission](https://docs.didit.me/transaction-monitoring/sdk-event-submission).

## Development

This package lives in the [sdk-web](https://github.com/didit-protocol/sdk-web) workspace. From the repository root:

```bash
npm ci
npm test -- --runInBand        # unit tests of both packages
npm run typecheck
npm run build                  # builds @didit-protocol/signals, then @didit-protocol/sdk-web
npm run test:size              # fails above 5 KB minified and gzipped
npm run test:e2e               # Chromium, Firefox and WebKit
```

The unit and browser tests replay real answers of the Didit verification API to `POST /v1/events/batch/` (`src/__tests__/fixtures/device-lane-recordings.json`). To run the browser check against a live API instead (direct cross-origin requests, including CORS and Origin-bound token checks):

```bash
EVENTS_UPSTREAM=<API base URL> EVENTS_MONITORING_TOKEN=<token from POST /v3/events/sdk-token/> \
  npx playwright test e2e/events-live.spec.mjs --project=chromium
```

The API must allow `X-Monitoring-Token`, `Content-Type` and the fingerprint headers in its CORS policy before browser delivery can work. An Origin-bound token must allow the fixture origin `http://127.0.0.1:4173`. These tests do not establish staging or production readiness.

## License

MIT
