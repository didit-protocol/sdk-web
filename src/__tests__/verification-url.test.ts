import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { buildVerificationUrl, SDKLogger } from "../utils";
import type { DiditSdkConfiguration } from "../types";

describe("buildVerificationUrl", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    SDKLogger.isEnabled = false;
  });

  it("returns the URL untouched when no camera option is configured", () => {
    const url = "https://verify.didit.me/session/token";
    expect(buildVerificationUrl(url)).toBe(url);
    expect(buildVerificationUrl(url, {})).toBe(url);
    expect(buildVerificationUrl(url, { embedded: true })).toBe(url);
  });

  it("forwards defaultLivenessCamera as the liveness_camera query parameter", () => {
    const built = buildVerificationUrl("https://verify.didit.me/session/token", { defaultLivenessCamera: "back" });
    expect(new URL(built).searchParams.get("liveness_camera")).toBe("back");
    expect(new URL(built).pathname).toBe("/session/token");
  });

  it("forwards defaultDocumentCamera as the document_camera query parameter", () => {
    const built = buildVerificationUrl("https://verify.didit.me/session/token", { defaultDocumentCamera: "front" });
    expect(new URL(built).searchParams.get("document_camera")).toBe("front");
    expect(new URL(built).searchParams.has("liveness_camera")).toBe(false);
  });

  it("forwards the switcher flags as true/false parameters", () => {
    const built = buildVerificationUrl("https://verify.didit.me/session/token", {
      showDocumentCameraSwitchButton: false,
      showLivenessCameraSwitchButton: true
    });
    const parsed = new URL(built);
    expect(parsed.searchParams.get("document_camera_switch")).toBe("false");
    expect(parsed.searchParams.get("liveness_camera_switch")).toBe("true");
  });

  it("forwards all four options together, the way the native SDKs expose them", () => {
    const built = buildVerificationUrl("https://verify.didit.me/u/abc", {
      defaultDocumentCamera: "front",
      defaultLivenessCamera: "back",
      showDocumentCameraSwitchButton: false,
      showLivenessCameraSwitchButton: false
    });
    const parsed = new URL(built);
    expect(parsed.searchParams.get("document_camera")).toBe("front");
    expect(parsed.searchParams.get("liveness_camera")).toBe("back");
    expect(parsed.searchParams.get("document_camera_switch")).toBe("false");
    expect(parsed.searchParams.get("liveness_camera_switch")).toBe("false");
  });

  it("forwards an explicit front as well, so a URL can be pinned to the selfie camera", () => {
    const built = buildVerificationUrl("https://verify.didit.me/u/abc", { defaultLivenessCamera: "front" });
    expect(new URL(built).searchParams.get("liveness_camera")).toBe("front");
  });

  it("keeps the query parameters and hash already on the URL", () => {
    const built = buildVerificationUrl("https://verify.didit.me/u/abc?vendor_data=user-1#top", {
      defaultLivenessCamera: "back"
    });
    const parsed = new URL(built);
    expect(parsed.searchParams.get("vendor_data")).toBe("user-1");
    expect(parsed.searchParams.get("liveness_camera")).toBe("back");
    expect(parsed.hash).toBe("#top");
  });

  it("lets the configuration win over a value already on the URL", () => {
    const built = buildVerificationUrl("https://verify.didit.me/u/abc?liveness_camera=front&document_camera_switch=true", {
      defaultLivenessCamera: "back",
      showDocumentCameraSwitchButton: false
    });
    const parsed = new URL(built);
    expect(parsed.searchParams.getAll("liveness_camera")).toEqual(["back"]);
    expect(parsed.searchParams.getAll("document_camera_switch")).toEqual(["false"]);
  });

  it("ignores a lens value that is not a lens and warns about it", () => {
    SDKLogger.isEnabled = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const url = "https://verify.didit.me/session/token";
    const configuration = { defaultLivenessCamera: "rear" } as unknown as DiditSdkConfiguration;
    expect(buildVerificationUrl(url, configuration)).toBe(url);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toContain("defaultLivenessCamera");
  });

  it("ignores a switcher flag that is not a boolean and keeps the valid options", () => {
    SDKLogger.isEnabled = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const configuration = {
      showDocumentCameraSwitchButton: "no",
      defaultDocumentCamera: "front"
    } as unknown as DiditSdkConfiguration;
    const built = buildVerificationUrl("https://verify.didit.me/session/token", configuration);
    const parsed = new URL(built);
    expect(parsed.searchParams.has("document_camera_switch")).toBe(false);
    expect(parsed.searchParams.get("document_camera")).toBe("front");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toContain("showDocumentCameraSwitchButton");
  });

  it("returns a URL it cannot parse as it came", () => {
    expect(buildVerificationUrl("not a url", { defaultLivenessCamera: "back" })).toBe("not a url");
  });
});
