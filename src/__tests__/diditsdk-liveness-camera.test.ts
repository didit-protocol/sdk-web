import { describe, it, expect, afterEach } from "@jest/globals";
import { DiditSdk } from "../DiditSdk";
import type { VerificationModal } from "../modal";

// Drives the real VerificationModal (see diditsdk-transactions.test.ts for why
// a module-level mock of "./modal" would be a silent no-op here) and reads the
// iframe it mounted: the URL the hosted page actually loads is the contract.

interface DiditSdkInternals {
  _modal: VerificationModal | null;
}

interface ModalInternals {
  iframe: HTMLIFrameElement | null;
}

function verificationIframeUrl(sdk: DiditSdk): URL {
  const modal = (sdk as unknown as DiditSdkInternals)._modal;
  if (!modal) throw new Error("No verification modal is currently presented");
  const iframe = (modal as unknown as ModalInternals).iframe;
  if (!iframe) throw new Error("Verification modal has no iframe");
  return new URL(iframe.src);
}

describe("startVerification defaultLivenessCamera", () => {
  afterEach(() => {
    DiditSdk.shared.destroy();
  });

  it("loads the verification URL with the camera options as query parameters", async () => {
    await DiditSdk.shared.startVerification({
      url: "https://verify.didit.me/session/token?vendor_data=user-1",
      configuration: { defaultLivenessCamera: "back", showLivenessCameraSwitchButton: false }
    });
    const loaded = verificationIframeUrl(DiditSdk.shared);
    expect(loaded.origin + loaded.pathname).toBe("https://verify.didit.me/session/token");
    expect(loaded.searchParams.get("liveness_camera")).toBe("back");
    expect(loaded.searchParams.get("liveness_camera_switch")).toBe("false");
    expect(loaded.searchParams.has("document_camera")).toBe(false);
    expect(loaded.searchParams.get("vendor_data")).toBe("user-1");
  });

  it("loads the verification URL as given when no camera is configured", async () => {
    await DiditSdk.shared.startVerification({ url: "https://verify.didit.me/session/token" });
    expect(verificationIframeUrl(DiditSdk.shared).toString()).toBe("https://verify.didit.me/session/token");
  });
});
