# @didit-protocol/signals

Didit device signals and end-user event monitoring for the browser, in under 6 KB minified and gzipped.

- **`submitEvent`** sends sign-ups, logins, failed logins, logouts and any other end-user event to Didit's [event monitoring](https://docs.didit.me/transaction-monitoring/events), tied to the same person as their verifications and transactions.
- **Device signals**: the didit-fp-v2 device fingerprint is attached to every batch. Page exit uses the available signals if its composite hash is still pending.
- **`@didit-protocol/signals/device`** (optional, about 10 KB more) collects the full device fingerprint: the one Didit's hosted verification flow uses.
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

- `getDeviceFingerprintPayload(): Promise<DeviceFingerprintPayload | null>` collects the didit-fp-v2 fingerprint (`null` outside a browser).
- `buildFingerprintHeaders(payload)` returns the matching `X-Didit-*` headers.
- `getStoredDeviceId(): string | null` returns the stored id this page already keeps, or `null`. It never creates one.

The fingerprint has two parts.
The **stored id** (`persistentId`, header `X-Didit-PID`) is a random id kept in the browser's storage: it is what tells one device from another.
The **composite hash** (`compositeHash`, header `X-Didit-FP-Hash`) is a hash of the signals that describe the device; devices of one kind share it, so it is evidence, never an id.
It has no version numbers in it and reads the screen shorter side first, so a browser update or a turned phone does not change it.
Where the browser has no WebCrypto (a page served without TLS) the hash is left out, and the stored id is still sent.

This entry reads the light tier (`signals.tier: "lite"`): the stored id from `localStorage` and a cookie, the navigator and the kind of in-app browser.

## Full device fingerprint: `@didit-protocol/signals/device`

```ts
import { enableDeviceIntelligence } from "@didit-protocol/signals/device";

enableDeviceIntelligence(); // once, when your app starts
```

From then on every event, transaction and Didit Authentication request of the page carries the full tier (`signals.tier: "full"`).
It is the collector Didit's hosted verification flow uses, so a device is described the same way wherever Didit sees it.

What the full tier adds:

| Signal family | What it tells |
|---|---|
| Stored id in `localStorage`, IndexedDB, a cookie and Cache storage | Clearing one of them does not make a known device look new |
| Graphics (`webgl`), fonts, math, API support | What the composite hash is made of, besides the navigator |
| Canvas, audio, hardware, media codecs | Sent for comparison; not part of the hash, because they are not steady enough on one device |
| `environment` | Whether the page runs on an Android emulator or in a virtual machine (`null` when it cannot be told) |
| `bot.flags` | `software-renderer`, `all-active-probes-blocked`, `desktop-no-plugins`, besides the light tier's `webdriver`, `headless-ua` and `ua-mobile-mismatch` |

The collection is spread over short tasks, so the page stays responsive, and runs once per page.
The composite hash of the two tiers differs for the same device, because the full one covers more of it; the stored id is the same.

Other exports: `getFingerprintPayload(options?)`, `getCachedFingerprintPayload()`, `getCompositeDeviceId()`, `payloadToHeaders(payload)`, `attachFingerprintPayload(body, payload)`, `detectWebViewContext(userAgent)`, the `collect*Signals` functions of each family and their types.

### A page inside another site's frame

A browser keeps the storage of a framed page apart for every site that embeds it, and some browsers empty it when they close.
So a page shown in a frame, such as a verification opened by `@didit-protocol/sdk-web`, does not see the stored id of the site around it.
The embedding page can pass its own:

```ts
getFingerprintPayload({ embedderPersistentId }); // the id the embedding page passed, or null
```

The framed page goes by that id only when its own storage has none, never writes it to its own storage, and reports it as `signals.embedder.persistentId`, so what happens in the frame can be linked with the events of the site around it.
A value that is not a stored id is ignored.
`@didit-protocol/sdk-web` passes the id by itself when the page already keeps one (`getStoredDeviceId()`); it creates nothing on a page that keeps none.

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
| `bot_score`, `bot_flags` | The device fingerprint's automation score on a 0-100 scale, and its flags |

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
