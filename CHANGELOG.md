# Changelog

All notable changes to `@didit-protocol/sdk-web` will be documented in this file.

## [0.5.0] - 2026-11-01

### Added
- `DiditSdk.shared.submitEvent()` queues end-user events (sign-up, login, failed login, logout, password reset, MFA, device change) for Didit's event monitoring with a monitoring token minted by your backend. Events are batched to `POST /v1/events/batch/` with the `X-Monitoring-Token` header and the device fingerprint, and sent when 25 are waiting, every 5 seconds and when the page is hidden or closed.
- Re-exports the `@didit-protocol/signals` API: `submitEvent`, `flush`, `configureEvents`, `DiditEventError`, `DEFAULT_EVENTS_BASE_URL`, `getDeviceFingerprintPayload`, `buildFingerprintHeaders` and their types.
- The modal grows to the redesigned flow's handoff card once the hosted page reports its layout with a `didit:layout` message: 960px by 660px on windows 1024px and wider (at most 90% of the window), 500px wide and as tall as the page's content (at most 90% of the window) on narrower windows, and full screen at 540px and below. Its close button becomes a 44px circle that follows the page's theme and text direction. Pages that report no layout keep the 500px by 700px modal, and embedded mode keeps filling its host element.
- The verification URL carries `sdk_presentation` (`modal` or `embedded`) and, in a modal, `sdk_close_button` (`true` or `false`), so the hosted page knows how the SDK shows it.

### Changed
- The device fingerprint moved into the new `@didit-protocol/signals` package, now a dependency. Transaction submissions send the same fingerprint as before.
- npm ES module and CommonJS imports share `@didit-protocol/signals`. Existing standalone `dist/didit-sdk.esm.js` and script-tag URLs remain self-contained. The CommonJS package entry uses a `.cjs` extension for Node compatibility.
- The verification iframe, in a modal and embedded, also allows `clipboard-write`, so the hosted flow's copy buttons work inside the SDK.

### Fixed
- The exit confirmation is announced as a dialog, and its Exit control is a button that works from the keyboard. Focus stays inside the confirmation while it is open and goes back to where it was when the user continues. In the redesigned flow's modal, a confirmation taller than the modal at a large text size scrolls, wraps long words and opens again at its title; focusing the dialog keeps the title visible in Safari.
- A failed launch keeps the SDK in the `error` state with its `errorMessage` instead of silently returning to `idle`, and starting again clears it.
- Closing or completing a verification reports the `idle` state through `onStateChange`.
- A verification the user closes by hand reports the session the flow already announced in the `cancelled` result.
- Embedded mode fails a launch with a clear error when its host element is missing, instead of rendering an overlay it never shows.

## [0.4.0] - 2026-09-19

### Added
- The native SDKs' four camera options on `DiditSdkConfiguration`, with the same names, defaults and semantics: `defaultDocumentCamera` (`'back'`), `defaultLivenessCamera` (`'front'`), `showDocumentCameraSwitchButton` (`true`) and `showLivenessCameraSwitchButton` (`true`). Open the face (passive liveness) capture on the rear camera, or lock either capture step to one lens by hiding its in-capture camera switcher.
- The options are forwarded to the hosted verification page as the `document_camera`, `liveness_camera`, `document_camera_switch` and `liveness_camera_switch` query parameters of the verification URL. A device without the requested camera keeps the one it has, and the switcher stays hidden on single-camera devices.
- `CameraLens` type export (`'front' | 'back'`). A lens or switcher flag of the wrong type is ignored with a console warning instead of being forwarded.

## [0.3.1] - 2026-09-07

### Fixed
- Keep the verification iframe within its modal on short desktop and landscape viewports so the hosted flow remains scrollable to the end.
- Derive the exported `SDK_VERSION` and its TypeScript declaration from the package version across every build format.
- Keep embedded mode filling its host element's content box instead of inheriting the modal's 700px height cap.

### Changed
- Add browser-level modal layout coverage for desktop, mobile, landscape, resizing, embedded mode, scrolling, and exit controls.

## [0.3.0] - 2026-09-01

### Added
- `submitTransaction()` for browser-side transaction monitoring submissions using scoped transaction tokens.
- Automatic device intelligence collection for transaction submissions.
- Wallet ownership action flows with bounded post-action polling and completion callbacks.
- Bosnian (`bs`), Kazakh (`kk`), Kyrgyz (`ky`), and Albanian (`sq`) modal translations.

### Fixed
- Isolate events, keyboard handling, and body scroll locking when multiple SDK modals are open.
- Restore body scrolling after an already-open modal is opened again and then closed.
- Abort transaction polling during teardown and on terminal authentication errors.
- Preserve the verification-only contract of `isPresented` and expose action modal state separately.
- Reject malformed transaction responses instead of returning fabricated empty identifiers or statuses.

## [0.2.1] - 2026-05-21

### Added
- Mongolian (`mn`) language support for the modal UI.

## [0.2.0] - 2026-04-30

### Added
- Allow origin when it matches the instantation url

## [0.1.9] - 2026-03-04

### Fixed
- Improve Czech (cs) translation wording for the exit confirmation dialog.

## [0.1.8] - 2026-03-04

### Added
- Internationalization (i18n) for modal UI with support for 49 languages.
- Automatic language detection from verification URL path, with fallback to `navigator.language` and then English.
- New `translations.ts` module with full translation map and `getTranslations()` helper.
- New `detectLanguageFromUrl()` utility function.
- `languages` constant array with all supported language codes.

### Supported languages
ar, bg, bn, ca, cnr, cs, da, de, el, en, es, et, fa, fi, fr, he, hi, hr, hu, hy, id, it, ja, ka, ko, lt, lv, mk, ms, nl, no, pl, pt-BR, pt, ro, ru, sk, sl, so, sr, sv, th, tr, uk, uz, vi, zh-CN, zh-TW, zh

## [0.1.7] - 2026-02-26

### Changed
- Refine loading spinner: use `rem` units and thinner stroke.

## [0.1.6] - 2026-02-26

### Fixed
- Fix Safari height bug by changing `vh` to `dvh` for modal height.

### Changed
- Improve close button positioning on the modal.

## [0.1.5] - 2026-02-26

### Changed
- Update README with integration guides and API reference.
- Remove non-general parameters from completed session event.
- Remove internal `ready` state.

## [0.1.4] - 2026-02-26

### Added
- Embedded mode for rendering verification inline instead of a modal overlay.

### Fixed
- Fix error event handling.

## [0.1.3] - 2026-02-26

### Added
- `close()` method exposed as a configurable parameter.

## [0.1.2] - 2026-02-26

### Changed
- Remove internal ready event.

## [0.1.0] - 2026-02-26

### Added
- Initial release.
- Modal and iframe-based verification flow.
- Singleton SDK pattern (`DiditSdk.shared`).
- ESM, CommonJS, and UMD builds.
- Configurable options: `zIndex`, `showCloseButton`, `showExitConfirmation`, `loggingEnabled`, `closeModalOnComplete`.
- Event system with granular verification events.
- State management with `onStateChange` callback.
