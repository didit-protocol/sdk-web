# Changelog

All notable changes to `@didit-protocol/signals` will be documented in this file.

## [0.1.0] - 2026-11-01

### Added
- First release: `submitEvent`, `flush` and `configureEvents` send end-user events to `POST /v1/events/batch/` with the `X-Monitoring-Token` header, in batches of 25, every 5 seconds and with `fetch` `keepalive` when the page is hidden or closed.
- Safe retries with backoff that re-send the same bytes, so a stored event comes back as `replayed`; typed `DiditEventError` refusals (`invalid_token`, `expired_token`, `monitoring_disabled`, `validation`, `dropped`) through `onError` and the `flush()` results.
- A queue with backpressure that drops low-value events first and never drops security, payment, dispute, responsible-gambling or bet events.
- The didit-fp-v2 device fingerprint (`getDeviceFingerprintPayload`, `buildFingerprintHeaders`), moved here from `@didit-protocol/sdk-web` and attached to every batch.
- ESM, CommonJS and script-tag (`window.DiditSignals`) builds, under 5 KB minified and gzipped.
