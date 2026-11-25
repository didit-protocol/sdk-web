# @didit-protocol/signals

Didit device signals and end-user event monitoring for the browser, in under 6 KB minified and gzipped (the device collector is loaded separately).

- **`submitEvent`** sends sign-ups, logins, failed logins, logouts and any other end-user event to Didit's [event monitoring](https://docs.didit.me/transaction-monitoring/events), tied to the same person as their verifications and transactions.
- **Device signals**: the full didit-fp-v2 device fingerprint and the automation evidence are attached to every batch.
  They come from a separate small file (about 13.6 KB gzipped) that the core loads after itself, so the core stays under 6 KB.
  Page exit uses what is available if the file has not finished.
- **`@didit-protocol/signals/autocapture`** (optional, about 3 KB more) sends page views, declared actions and interaction telemetry without a `submitEvent` call for each.
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
- Exit requests start right away with what is collected by then: the full payload if the collector has finished, otherwise the persistent device id and the browser signals. If WebCrypto hashing is still pending, `compositeHash` is empty and `X-Didit-FP-Hash` is omitted, and those events are stored without the composite hash. Normal batches and `flush()` wait for the complete fingerprint, and exit requests use it once it is ready.
- On a network error, HTTP timeout (408), rate limit (429), server error (5xx) or an unreadable answer, the same events are sent again after 10, 20 and 40 seconds, then every minute. They are re-sent byte for byte, so an event Didit already stored comes back as `replayed` instead of being stored twice.
- A refusal is final and is reported through `onError` and in the `flush()` results:

| `error.type` | Meaning |
|--------------|---------|
| `invalid_token` | The token is unknown, revoked, out of uses or bound to another origin (HTTP 401) |
| `expired_token` | The token's lifetime has elapsed (HTTP 401) |
| `monitoring_disabled` | Event monitoring is not switched on for the application (HTTP 403) |
| `validation` | The event failed validation; `error.errors` has Didit's per-field details |
| `dropped` | The queue was full and the event was dropped before it was sent |

`submitEvent` itself throws a `DiditEventError` only for a missing token (`invalid_token`), a missing `category` or `actionType` or an unusable `occurredAt` Date (`validation`), or an environment without `fetch` (`network`).

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

- `getDeviceFingerprintPayload(options?): Promise<DeviceFingerprintPayload | null>` collects the didit-fp-v2 fingerprint (`null` outside a browser).
- `buildFingerprintHeaders(payload)` returns the matching `X-Didit-*` headers.
- `getStoredDeviceId(): string | null` returns the stored id this page already keeps, or `null`. It never creates one.
- `setEmbedderDeviceId(id: string | null): void` is for a page shown inside another site's frame: it tells the page the stored id of the page that embeds it (see "A page inside a frame" below).

The fingerprint has two parts.
The **stored id** (`persistentId`, header `X-Didit-PID`) is a random id kept in the browser's storage: it is what tells one device from another.
The **composite hash** (`compositeHash`, header `X-Didit-FP-Hash`) is a hash of the signals that describe the device; devices of one kind share it, so it is evidence, never an id.
It has no version numbers in it and reads the screen shorter side first, so a browser update or a turned phone does not change it.
Where the browser has no WebCrypto (a page served without TLS) the hash is left out, and the stored id is still sent.

By default the fingerprint is the full one (`signals.tier: "full"`), from the collector, which the core loads as a separate file (`dist/collector.mjs`) the first time something is sent.
A request waits for its fingerprint for at most 2 seconds.
If the collector is not there by then, or it is blocked or fails, the request goes out with the lite payload (`signals.tier: "lite"`: the stored id from `localStorage` and a cookie, the navigator and the kind of in-app browser) and is never delayed further.
Past those 2 seconds the lite payload goes out without its composite hash rather than wait for it.
Once the collector has finished, every later request carries its payload.
The composite hash of the two kinds differs for the same device because the full one covers more of it, and both report the same kind of in-app browser.

One device has one stored id.
The lite payload names the device first, from `localStorage` and the cookie, and makes up an id when both are empty.
The collector then reads every store the browser has (IndexedDB and Cache storage too).
An id one of them still holds is the device's id: the collector writes it back over the one made up for this page, and the device is not reported as new.
Where no store holds one, the made-up id is the device's id, reported as created by both payloads.
From then on both payloads carry the collector's answer, so the id of the lite payload can change once on a page, on a device whose cookie and `localStorage` were cleared.

`getDeviceFingerprintPayload({ tier: "lite" })` answers at once with the lite payload and never loads or waits for the collector.
Its composite hash is the same on every call, so use it for a request that only has to say which device it comes from and must not be held up.

#### A page inside a frame

A browser keeps a framed page's storage apart for each site that embeds it, and some browsers empty it when they close, so a framed page often has no stored id.
`@didit-protocol/sdk-web` passes the embedding page's stored id to the verification it opens, as the `sdk_device_id` query parameter.
A framed page that uses this package hands it over before its first event, transaction or sign-in:

```ts
import { setEmbedderDeviceId } from "@didit-protocol/signals";

setEmbedderDeviceId(new URLSearchParams(location.search).get("sdk_device_id"));
```

The page then goes by that id while its own storage has none, never writes it to its own storage, and reports it as `signals.embedder.persistentId`, which links what happens in the frame with the events of the site around it.
An id the page already stores is kept.
Anything that is not a stored id is ignored.

The full payload carries `evidence`: facts about how the page was driven, as compact JSON text.
The client sends facts only.
Didit's servers read the evidence and decide the automation score; nothing is scored in the browser, and no request carries a score.

- `getSignalsEvidence(): Promise<string | null>` returns the evidence text, for a request your own backend sends to Didit on behalf of this page.
  It waits for the collector for at most 2 seconds and resolves to `null` outside a browser, on timeout or when the collector failed.
  It never rejects.
  `getSignalsEvidence({ wait: false })` never waits: it resolves to the evidence if the collector has finished, else to `null`, and lets the collector go on loading so a later call has it.

The script-tag build (`dist/didit-signals.umd.min.js`) contains the collector, so it is one file of about 19.1 KB minified and gzipped.

## Automatic capture: `@didit-protocol/signals/autocapture`

```ts
import { startAutocapture } from "@didit-protocol/signals/autocapture";

const stop = startAutocapture({
  // The monitoring token of the signed-in person; null while nobody is signed in.
  monitoringToken: () => session?.monitoringToken ?? null,
});
```

What it sends, through the same queue as `submitEvent`:

| Event | When | Payload |
|---|---|---|
| `session.session_started` | Once per browser tab session | `path`, `referrer_host` |
| `session.page_view` | Every page, and every navigation of a single-page app (History API, hash routes, back and forward) | `path`, `previous_path`, `seconds_on_previous` |
| The event an element declares | `<a data-didit-event="auth.password_forgot">` on click, `<form data-didit-event="auth.login">` on submit | `path`, plus `data-didit-prop-*` attributes |
| `session.bot_signal_observed` | Once per page the person acted on at least five times, when they leave it | See below |

Every event carries `session.session_id` and a `sequence` number, so a person's path through your site can be read in order.
`track(category, actionType, payload?)` sends an event of your own with the same session attached.

**How the person interacted** (`session.bot_signal_observed`) is reported in numbers that [event rules](https://docs.didit.me/transaction-monitoring/event-rules) can read as `event.bot.*`:

| Field | Meaning |
|---|---|
| `actions`, `observed_seconds`, `actions_per_minute` | How much the person did on the page |
| `timing_variance_ms` | How regular the time between two actions is (standard deviation). A script's is close to 0 |
| `reaction_time_ms_p50` | The median time between two actions |
| `pointer_entropy` | How varied the pointer's direction was, 0 to 3 bits. Left out when the pointer hardly moved |
| `keystroke_entropy` | How varied the rhythm of typing was, 0 to 3 bits, from the time between key presses alone |
| `untrusted_actions` | Actions a script dispatched instead of a person |

**What it never reads:** the value of any field, which keys are pressed, the text of the page, element ids or classes, query strings and URL fragments.
A page is reported by its path, and every path segment that looks like an identifier (a number, a UUID, a long token, an email address) is replaced by `:id`: `/users/48213/orders` is sent as `/users/:id/orders`.

| Option | Default | Description |
|--------|---------|-------------|
| `monitoringToken` | required | The token, or a function returning it (read for every event, so it can return a renewed one) |
| `pageViews` | `true` | Send `session.session_started` and `session.page_view` |
| `declaredActions` | `true` | Send the events elements declare with `data-didit-event` |
| `behavior` | `true` | Send `session.bot_signal_observed` |
| `sanitizePath` | see above | Your own rule for the path that is reported |
| `preAuthBuffer` | `25` | Events kept while there is no token yet; they are sent with the first token, marked `pre_auth: true` |
| `maxEvents` | `500` | Events autocapture may send in one browser tab session |
| `baseUrl` | the configured one | Didit verification API base URL |

A monitoring token belongs to one person, so nothing can be sent before your backend knows who is there.
What happens before that (a visit to the forgotten-password page, then a sign-in) is kept in memory and sent once the token exists.
For an action of somebody who never signs in, send the event from your backend with `POST /v3/events/`, and pass `await getDeviceContext()` from this entry as its `device_context`, so it meets the same device as the events sent from the browser.

A token is good for a limited number of events (1,000 unless your backend asks for more with `max_uses`), and automatic capture uses about two per page.

Full guide: [SDK Event Submission](https://docs.didit.me/transaction-monitoring/sdk-event-submission).

## Development

This package lives in the [sdk-web](https://github.com/didit-protocol/sdk-web) workspace. From the repository root:

```bash
npm ci
npm test -- --runInBand        # unit tests of both packages
npm run typecheck
npm run build                  # builds @didit-protocol/signals, then @didit-protocol/sdk-web
npm run test:size              # fails when an entry is over its budget (the core: 6 KB minified and gzipped)
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
