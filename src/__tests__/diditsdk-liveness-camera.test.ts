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

describe("startVerification and the page's stored device id", () => {
  afterEach(() => {
    DiditSdk.shared.destroy();
    localStorage.clear();
    document.cookie = "didit_pid=; Path=/; Max-Age=0";
  });

  it("hands the verification the id the page already keeps", async () => {
    localStorage.setItem("didit-pid-v1", "AbCdEfGhIjKlMnOpQrStUv");
    await DiditSdk.shared.startVerification({ url: "https://verify.didit.me/session/token" });
    expect(verificationIframeUrl(DiditSdk.shared).searchParams.get("sdk_device_id")).toBe("AbCdEfGhIjKlMnOpQrStUv");
  });

  it("creates nothing on a page that keeps no id: no parameter, no storage entry, no cookie", async () => {
    await DiditSdk.shared.startVerification({ url: "https://verify.didit.me/session/token" });
    expect(verificationIframeUrl(DiditSdk.shared).searchParams.has("sdk_device_id")).toBe(false);
    expect(localStorage.getItem("didit-pid-v1")).toBeNull();
    expect(document.cookie).not.toContain("didit_pid");
  });

  it("does not hand over a stored value that is not a device id", async () => {
    localStorage.setItem("didit-pid-v1", "<script>alert(1)</script>");
    await DiditSdk.shared.startVerification({ url: "https://verify.didit.me/session/token" });
    expect(verificationIframeUrl(DiditSdk.shared).searchParams.has("sdk_device_id")).toBe(false);
  });
});

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

  it("loads the verification URL with only the presentation parameters when no camera is configured", async () => {
    await DiditSdk.shared.startVerification({ url: "https://verify.didit.me/session/token" });
    expect(verificationIframeUrl(DiditSdk.shared).toString()).toBe(
      "https://verify.didit.me/session/token?sdk_presentation=modal&sdk_close_button=true"
    );
  });
});
