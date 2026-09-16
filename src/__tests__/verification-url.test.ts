import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { buildVerificationUrl, SDKLogger } from "../utils";
import type { DiditSdkConfiguration } from "../types";

describe("buildVerificationUrl", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    SDKLogger.isEnabled = false;
  });

  it("returns the URL untouched when no camera is configured", () => {
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

  it("lets the configuration win over a liveness_camera value already on the URL", () => {
    const built = buildVerificationUrl("https://verify.didit.me/u/abc?liveness_camera=front", {
      defaultLivenessCamera: "back"
    });
    const parsed = new URL(built);
    expect(parsed.searchParams.getAll("liveness_camera")).toEqual(["back"]);
  });

  it("ignores a value that is not a lens and warns about it", () => {
    SDKLogger.isEnabled = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const url = "https://verify.didit.me/session/token";
    const configuration = { defaultLivenessCamera: "rear" } as unknown as DiditSdkConfiguration;
    expect(buildVerificationUrl(url, configuration)).toBe(url);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toContain("defaultLivenessCamera");
  });

  it("returns a URL it cannot parse as it came", () => {
    expect(buildVerificationUrl("not a url", { defaultLivenessCamera: "back" })).toBe("not a url");
  });
});
