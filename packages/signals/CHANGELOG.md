# Changelog

All notable changes to `@didit-protocol/signals` will be documented in this file.

## [0.2.0] - Unreleased

### Added
- `@didit-protocol/signals/device`: the full device fingerprint, the one Didit's hosted verification flow collects. `enableDeviceIntelligence()` makes it the fingerprint every event, transaction and Authentication request of the page carries. It keeps the stored id in `localStorage`, IndexedDB, a cookie and Cache storage, and adds the graphics, font, math, API support, canvas, audio, hardware and codec signals, whether the page runs on emulated hardware, and three more automation flags.
- `@didit-protocol/signals/autocapture`: `startAutocapture()` sends `session.session_started`, a `session.page_view` for every page and single-page-app navigation, the event an element declares with `data-didit-event`, and `session.bot_signal_observed` with how the person interacted (action counts, timing regularity, pointer and typing rhythm). It never reads field values, key presses or page content, and reports a page by its path with identifiers replaced by `:id`. `track()` sends your own event with the session attached, and `getDeviceContext()` gives the device identifiers for an event your backend sends.
- `signals.tier` (`lite` or `full`) and `signals.compositeHashVersion` in the fingerprint payload.

### Changed
- One implementation of the device fingerprint: this entry is now built from the same files as `@didit-protocol/signals/device`, and uses the part of them that fits its size.
- The composite hash no longer changes with a browser or system update, or when a phone is turned: it reads the user agent and the browser brands without their version numbers, and the screen shorter side first. Every browser's hash changes once with this release; the stored id does not.
- The kind of in-app browser (`signals.webview.kind`, header `X-Didit-FP-Webview`) names the app (`whatsapp`, `instagram`, `tiktok`, ...) or `generic-wv`, as the hosted verification flow reports it, instead of `android-webview`, `ios-webview` and `in-app-browser`.
- Where the browser has no WebCrypto, the composite hash is left out instead of being replaced by a weaker hash that would read as another device. The stored id is still sent.
- The entry is under 6 KB minified and gzipped (it was under 5 KB): sharing every line with the full fingerprint costs about 0.7 KB.

## [0.1.0] - 2026-11-01

### Added
- First release: `submitEvent`, `flush` and `configureEvents` send end-user events to `POST /v1/events/batch/` with the `X-Monitoring-Token` header, in batches of 25, every 5 seconds and with `fetch` `keepalive` when the page is hidden or closed.
- Safe retries with backoff that re-send the same bytes, so a stored event comes back as `replayed`; typed `DiditEventError` refusals (`invalid_token`, `expired_token`, `monitoring_disabled`, `validation`, `dropped`) through `onError` and the `flush()` results.
- A queue with backpressure that drops low-value events first and never drops security, payment, dispute, responsible-gambling or bet events.
- The didit-fp-v2 device fingerprint (`getDeviceFingerprintPayload`, `buildFingerprintHeaders`), moved here from `@didit-protocol/sdk-web` and attached to every batch.
- ESM, CommonJS and script-tag (`window.DiditSignals`) builds, under 5 KB minified and gzipped.
