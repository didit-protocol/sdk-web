import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { DiditSdk } from "../DiditSdk";
import type { VerificationEvent } from "../types";

jest.mock("../modal", () => ({
  VerificationModal: jest.fn().mockImplementation(() => ({
    show: jest.fn(),
    hide: jest.fn(),
    destroy: jest.fn(),
    setLoading: jest.fn(),
    loadUrl: jest.fn(),
    updateCloseButtonVisibility: jest.fn(),
    updateExitConfirmation: jest.fn()
  }))
}));

describe("SDK Event Handling", () => {
  let sdk: DiditSdk;
  let onEventMock: jest.Mock;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    DiditSdk.shared.destroy();

    sdk = DiditSdk.shared;
    onEventMock = jest.fn();
    sdk.onEvent = onEventMock;

    const originalAddEventListener = window.addEventListener;
    jest.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
      if (type === "message") {
        messageHandler = listener as (event: MessageEvent) => void;
      }
      return originalAddEventListener.call(window, type, listener);
    });
  });

  afterEach(() => {
    sdk.destroy();
    jest.restoreAllMocks();
    messageHandler = null;
  });

  describe("Event Types", () => {
    const eventTypes: Array<{
      type: string;
      data?: Record<string, unknown>;
      description: string;
    }> = [
      { type: "didit:ready", description: "ready event" },
      { type: "didit:started", data: { sessionId: "test-123" }, description: "started event" },
      {
        type: "didit:step_started",
        data: { step: "DOCUMENT_CAPTURE_FRONT", sessionId: "test-123" },
        description: "step_started event"
      },
      {
        type: "didit:step_completed",
        data: { step: "DOCUMENT_CAPTURE_FRONT", nextStep: "FACE_PASSIVE_LIVENESS", sessionId: "test-123" },
        description: "step_completed event"
      },

      {
        type: "didit:media_started",
        data: { step: "FACE_PASSIVE_LIVENESS", mediaType: "camera" },
        description: "media_started event"
      },
      {
        type: "didit:media_captured",
        data: { step: "FACE_PASSIVE_LIVENESS", isAuto: true },
        description: "media_captured event"
      },
      {
        type: "didit:document_selected",
        data: { documentType: "Passport", country: "USA" },
        description: "document_selected event"
      },

      {
        type: "didit:verification_submitted",
        data: { step: "DOCUMENT_CAPTURE_FRONT", sessionId: "test-123", documentType: "ID_CARD" },
        description: "verification_submitted event"
      },
      {
        type: "didit:code_sent",
        data: { step: "PHONE_VERIFY_CODE", channel: "sms", codeSize: 6, retriesLeft: 3 },
        description: "code_sent event"
      },
      {
        type: "didit:code_verified",
        data: { step: "PHONE_VERIFY_CODE", channel: "sms" },
        description: "code_verified event"
      },

      {
        type: "didit:status_updated",
        data: { sessionId: "test-123", status: "IN_PROGRESS", step: "FACE_PASSIVE_LIVENESS" },
        description: "status_updated event"
      },
      {
        type: "didit:error",
        data: { error: "Camera access denied", step: "FACE_PASSIVE_LIVENESS" },
        description: "error event"
      },
      {
        type: "didit:cancelled",
        data: { sessionId: "test-123" },
        description: "cancelled event"
      },
      {
        type: "didit:completed",
        data: { sessionId: "test-123", status: "Approved" },
        description: "completed event"
      }
    ];

    it.each(eventTypes)("should forward $description to onEvent callback", ({ type, data }) => {
      const event: VerificationEvent = {
        type: type as VerificationEvent["type"],
        data,
        timestamp: Date.now()
      };

      (sdk as unknown as { handleVerificationEvent: (e: VerificationEvent) => void }).handleVerificationEvent(event);

      expect(onEventMock).toHaveBeenCalledTimes(1);
      expect(onEventMock).toHaveBeenCalledWith(event);
    });
  });

  describe("Event Data Integrity", () => {
    it("should preserve all event data fields including new granular fields", () => {
      const complexData = {
        sessionId: "session-abc-123",
        status: "Approved",
        step: "FACE_PASSIVE_LIVENESS",
        nextStep: "COMPLETED",
        documentType: "Passport",
        country: "USA",
        isAuto: true,
        mediaType: "camera",
        channel: "sms",
        codeSize: 6,
        retriesLeft: 2
      };

      const event: VerificationEvent = {
        type: "didit:step_completed",
        data: complexData,
        timestamp: 1234567890
      };

      (sdk as unknown as { handleVerificationEvent: (e: VerificationEvent) => void }).handleVerificationEvent(event);

      expect(onEventMock).toHaveBeenCalledWith(event);
      const receivedEvent = onEventMock.mock.calls[0][0] as VerificationEvent;
      expect(receivedEvent.data).toEqual(complexData);
      expect(receivedEvent.timestamp).toBe(1234567890);
    });

    it("should preserve code verification fields", () => {
      const codeData = {
        step: "PHONE_VERIFY_CODE",
        channel: "whatsapp",
        codeSize: 4,
        retriesLeft: 1
      };

      const event: VerificationEvent = {
        type: "didit:code_sent",
        data: codeData,
        timestamp: Date.now()
      };

      (sdk as unknown as { handleVerificationEvent: (e: VerificationEvent) => void }).handleVerificationEvent(event);

      expect(onEventMock).toHaveBeenCalledWith(event);
      const receivedEvent = onEventMock.mock.calls[0][0] as VerificationEvent;
      expect(receivedEvent.data?.channel).toBe("whatsapp");
      expect(receivedEvent.data?.codeSize).toBe(4);
      expect(receivedEvent.data?.retriesLeft).toBe(1);
    });

    it("should handle events without data", () => {
      const event: VerificationEvent = {
        type: "didit:ready",
        timestamp: Date.now()
      };

      (sdk as unknown as { handleVerificationEvent: (e: VerificationEvent) => void }).handleVerificationEvent(event);

      expect(onEventMock).toHaveBeenCalledWith(event);
      const receivedEvent = onEventMock.mock.calls[0][0] as VerificationEvent;
      expect(receivedEvent.data).toBeUndefined();
    });
  });

  describe("Multiple Events", () => {
    it("should forward all events in sequence", () => {
      const events: VerificationEvent[] = [
        { type: "didit:ready", timestamp: 1 },
        { type: "didit:started", data: { sessionId: "123" }, timestamp: 2 },
        { type: "didit:step_started", data: { step: "document" }, timestamp: 3 },
        { type: "didit:media_captured", data: { step: "document" }, timestamp: 4 },
        { type: "didit:step_completed", data: { step: "document" }, timestamp: 5 }
      ];

      events.forEach((event) => {
        (sdk as unknown as { handleVerificationEvent: (e: VerificationEvent) => void }).handleVerificationEvent(event);
      });

      expect(onEventMock).toHaveBeenCalledTimes(5);

      events.forEach((event, index) => {
        expect(onEventMock.mock.calls[index][0]).toEqual(event);
      });
    });
  });

  describe("No Callback Set", () => {
    it("should not throw when onEvent is not set", () => {
      sdk.onEvent = undefined;

      const event: VerificationEvent = {
        type: "didit:ready",
        timestamp: Date.now()
      };

      expect(() => {
        (sdk as unknown as { handleVerificationEvent: (e: VerificationEvent) => void }).handleVerificationEvent(event);
      }).not.toThrow();
    });
  });
});

describe("SDK Event Callback Configuration", () => {
  it("should allow setting onEvent callback", () => {
    const sdk = DiditSdk.shared;
    const callback = jest.fn();

    sdk.onEvent = callback;

    expect(sdk.onEvent).toBe(callback);

    sdk.destroy();
  });

  it("should allow replacing onEvent callback", () => {
    const sdk = DiditSdk.shared;
    const callback1 = jest.fn();
    const callback2 = jest.fn();

    sdk.onEvent = callback1;
    sdk.onEvent = callback2;

    expect(sdk.onEvent).toBe(callback2);

    sdk.destroy();
  });

  it("should allow clearing onEvent callback", () => {
    const sdk = DiditSdk.shared;
    const callback = jest.fn();

    sdk.onEvent = callback;
    sdk.onEvent = undefined;

    expect(sdk.onEvent).toBeUndefined();

    sdk.destroy();
  });
});
