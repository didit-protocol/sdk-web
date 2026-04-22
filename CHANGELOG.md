# Changelog

All notable changes to `@didit-protocol/sdk-web` will be documented in this file.

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
