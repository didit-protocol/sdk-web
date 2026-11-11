export { submitEvent, flush, configureEvents, DiditEventError, DEFAULT_EVENTS_BASE_URL } from "./events";
export { getDeviceFingerprintPayload, buildFingerprintHeaders, setDeviceSignalsProvider } from "./fingerprint";

export type {
  DiditEvent,
  DiditEventCategory,
  DiditEventErrorType,
  DiditEventFlushResult,
  DiditEventResult,
  DiditEventsConfiguration,
  SubmitEventOptions,
  DeviceFingerprintPayload,
  DeviceFingerprintSignals,
  DeviceFingerprintNavigatorSignals
} from "./types";
export type { DeviceSignalsProvider } from "./fingerprint";
