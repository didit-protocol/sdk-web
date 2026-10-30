import { expect, test } from "@playwright/test";

const FRAME = ".didit-verification-iframe";
const OVERLAY = ".didit-modal-overlay";
const EMBEDDED = ".didit-embedded";
const HOST = "#embedded-host";

// A flow stand-in served at a Didit-hosted address (and, for a handoff, at
// another Didit subdomain or a foreign origin) without touching the real one.
function flowPage() {
  return `<!doctype html><html><body><main><h1>Verify your identity</h1></main></body></html>`;
}

async function openSdk(page, query = "") {
  await page.goto(`/e2e/fixtures/sdk-session.html${query}`);
  await expect(page.locator(FRAME)).toBeVisible();
  await expect(page.locator(FRAME).contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  return page.locator(FRAME);
}

function postFromFrame(iframe, message) {
  return iframe.contentFrame().locator("body").evaluate((body, payload) => {
    window.parent.postMessage(payload, "*");
  }, message);
}

function records(page) {
  return page.evaluate(() => window.records);
}

function states(page) {
  return page.evaluate(() => window.records.states.map((entry) => entry.state));
}

test.describe("web SDK integration", () => {
  test("launches the modal flow with the presentation contract", async ({ page }) => {
    const iframe = await openSdk(page);

    await expect(page.locator(OVERLAY)).toHaveClass(/active/);
    const src = new URL(await iframe.getAttribute("src"));
    expect(src.searchParams.get("sdk_presentation")).toBe("modal");
    expect(src.searchParams.get("sdk_close_button")).toBe("true");
    const data = await records(page);
    expect(data.events.map((event) => event.type)).toEqual(["didit:started"]);
    expect(data.states).toEqual([{ state: "loading", error: null }]);
  });

  test("fills an embedded host and never draws the overlay", async ({ page }) => {
    const iframe = await openSdk(page, "?embedded=true");

    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator(EMBEDDED)).toBeVisible();
    const hostBox = await page.locator(HOST).boundingBox();
    const frameBox = await iframe.boundingBox();
    expect(frameBox.width).toBeCloseTo(hostBox.width, 0);
    expect(frameBox.height).toBeCloseTo(hostBox.height, 0);
    expect(new URL(await iframe.getAttribute("src")).searchParams.get("sdk_presentation")).toBe("embedded");
  });

  test("reports a completed verification with its session", async ({ page }) => {
    const iframe = await openSdk(page);

    await postFromFrame(iframe, { type: "didit:ready", data: { sessionId: "ses_1" }, timestamp: 1 });
    await postFromFrame(iframe, {
      type: "didit:completed",
      data: { sessionId: "ses_1", status: "Approved" },
      timestamp: 2
    });

    await expect.poll(async () => (await records(page)).results).toEqual([
      { type: "completed", session: { sessionId: "ses_1", status: "Approved" } }
    ]);
  });

  test("parses a JSON string message from the flow", async ({ page }) => {
    const iframe = await openSdk(page);

    await postFromFrame(iframe, JSON.stringify({ type: "didit:cancelled", data: { sessionId: "ses_2" }, timestamp: 1 }));

    await expect.poll(async () => (await records(page)).results).toEqual([
      { type: "cancelled", session: { sessionId: "ses_2", status: "Pending" } }
    ]);
  });

  test("cancels through the exit confirmation and stops the flow", async ({ page }) => {
    const iframe = await openSdk(page);
    await postFromFrame(iframe, { type: "didit:ready", data: { sessionId: "ses_3" }, timestamp: 1 });

    await page.getByRole("button", { name: "Close verification" }).click();
    await expect(page.getByRole("heading", { name: "Exit verification?" })).toBeVisible();
    await page.getByRole("button", { name: "Exit", exact: true }).click();

    await expect(page.locator(OVERLAY)).not.toHaveClass(/active/);
    await expect(iframe).toHaveAttribute("src", "about:blank");
    await expect.poll(async () => (await records(page)).results).toEqual([
      { type: "cancelled", session: { sessionId: "ses_3", status: "Pending" } }
    ]);
    await expect.poll(async () => states(page)).toContain("idle");
  });

  test("keeps the attempt open on a recoverable error and only reports it as an event", async ({ page }) => {
    const iframe = await openSdk(page);

    await postFromFrame(iframe, { type: "didit:error", data: { error: "network_error", step: "document" }, timestamp: 1 });
    await postFromFrame(iframe, { type: "didit:cancelled", data: { sessionId: "ses_4" }, timestamp: 2 });

    const data = await records(page);
    expect(data.events.map((event) => event.type)).toEqual(["didit:started", "didit:error", "didit:cancelled"]);
    expect(data.results).toEqual([{ type: "cancelled", session: { sessionId: "ses_4", status: "Pending" } }]);
  });

  test("launches again after a completed attempt and reports each attempt once", async ({ page }) => {
    const iframe = await openSdk(page);
    await postFromFrame(iframe, { type: "didit:completed", data: { sessionId: "ses_a", status: "Approved" }, timestamp: 1 });
    await expect.poll(async () => (await records(page)).results.length).toBe(1);

    await page.evaluate(() => window.startSdk(new URL("./verification-flow.html?attempt=2", location.href).href));
    const second = page.locator(FRAME);
    await expect(second).toHaveAttribute("src", /attempt=2/);
    await expect(second.contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();
    expect(await page.locator(OVERLAY).count()).toBe(1);
    expect(await page.locator(FRAME).count()).toBe(1);

    await postFromFrame(second, { type: "didit:completed", data: { sessionId: "ses_b", status: "Declined" }, timestamp: 2 });
    await expect.poll(async () => (await records(page)).results).toEqual([
      { type: "completed", session: { sessionId: "ses_a", status: "Approved" } },
      { type: "completed", session: { sessionId: "ses_b", status: "Declined" } }
    ]);
  });

  test("a completed attempt is followed by a fresh, working launch", async ({ page }) => {
    const iframe = await openSdk(page, "?closeModalOnComplete=true");
    await postFromFrame(iframe, { type: "didit:completed", data: { sessionId: "ses_c", status: "Approved" }, timestamp: 1 });

    await expect(page.locator(OVERLAY)).not.toHaveClass(/active/);
    await expect.poll(async () => states(page)).toEqual(["loading", "idle"]);

    await page.evaluate(() => window.startSdk());
    await expect(page.locator(OVERLAY)).toHaveClass(/active/);
    await expect(page.locator(FRAME).contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  });

  test("a late message after the modal closed does not complete the session", async ({ page }) => {
    const iframe = await openSdk(page);
    await page.getByRole("button", { name: "Close verification" }).click();
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect.poll(async () => (await records(page)).results.length).toBe(1);

    // Whatever still holds a reference to the torn-down frame can post, but the
    // SDK has stopped listening and must not deliver a second result.
    await page.evaluate(() => window.postMessage({ type: "didit:completed", data: { status: "Approved" } }, "*"));
    await iframe.contentFrame().locator("body").evaluate(() => {
      window.parent.postMessage({ type: "didit:completed", data: { status: "Approved" } }, "*");
    }).catch(() => {});
    await page.waitForTimeout(150);

    expect((await records(page)).results).toEqual([{ type: "cancelled" }]);
  });

  test("ignores completion and close requests from the page and from a foreign frame", async ({ page }) => {
    const iframe = await openSdk(page);

    // The integrator's own page is not the verification frame, even when it
    // knows the exact message shape the flow uses.
    await page.evaluate(() => {
      window.postMessage({ type: "didit:completed", data: { status: "Approved" } }, "*");
      window.postMessage({ type: "didit:close_request" }, "*");
    });
    // A foreign iframe on another origin is not the verification frame either.
    await page.route("http://app.example.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: flowPage() })
    );
    await page.evaluate(() => {
      const sibling = document.createElement("iframe");
      sibling.id = "foreign-frame";
      sibling.src = "http://app.example.test/foreign";
      document.body.appendChild(sibling);
    });
    await expect
      .poll(() => page.frames().some((candidate) => candidate.url().startsWith("http://app.example.test/")))
      .toBe(true);
    const sibling = page.frames().find((candidate) => candidate.url().startsWith("http://app.example.test/"));
    await sibling.locator("body").evaluate(() => {
      window.parent.postMessage({ type: "didit:completed", data: { status: "Approved" } }, "*");
      window.parent.postMessage({ type: "didit:close_request" }, "*");
    });
    await page.waitForTimeout(250);

    expect((await records(page)).results).toEqual([]);
    await expect(page.locator(OVERLAY)).toHaveClass(/active/);
    expect(await page.getByRole("heading", { name: "Exit verification?" }).isVisible()).toBe(false);
  });
});

test.describe("web SDK permitted origins and handoff", () => {
  test("accepts a handoff between Didit subdomains", async ({ page }) => {
    await page.route("https://verify.didit.me/**", (route) =>
      route.fulfill({ contentType: "text/html", body: flowPage() })
    );
    await page.route("https://business.didit.me/**", (route) =>
      route.fulfill({ contentType: "text/html", body: flowPage() })
    );
    await openSdk(page, "?flow=https://verify.didit.me/session/ses_5");
    const frame = page.frames().find((candidate) => candidate.url().startsWith("https://verify.didit.me/"));
    expect(frame).toBeTruthy();

    await frame.goto("https://business.didit.me/handoff/ses_5");
    await frame.locator("body").evaluate(() => {
      window.parent.postMessage({ type: "didit:completed", data: { sessionId: "ses_5", status: "Approved" }, timestamp: 1 }, "*");
    });

    await expect.poll(async () => (await records(page)).results).toEqual([
      { type: "completed", session: { sessionId: "ses_5", status: "Approved" } }
    ]);
  });

  test("accepts messages from the origin the integrator instantiated the SDK with", async ({ page }) => {
    // The page is on 127.0.0.1 and the flow on localhost: a different origin
    // whose hostname matches the verification URL the SDK was given.
    await page.goto(
      "http://127.0.0.1:4173/e2e/fixtures/sdk-session.html?flow=http://localhost:4173/e2e/fixtures/verification-flow.html"
    );
    const frame = page.frames().find((candidate) => candidate.url().startsWith("http://localhost:4173/"));
    expect(frame).toBeTruthy();
    await expect(page.locator(FRAME).contentFrame().getByRole("heading", { name: "Verify your identity" })).toBeVisible();

    await frame.locator("body").evaluate(() => {
      window.parent.postMessage({ type: "didit:completed", data: { sessionId: "ses_6", status: "Approved" }, timestamp: 1 }, "*");
    });

    await expect.poll(async () => (await records(page)).results).toEqual([
      { type: "completed", session: { sessionId: "ses_6", status: "Approved" } }
    ]);
  });

  test("rejects completion from a foreign origin the flow redirected to", async ({ page }) => {
    await page.route("http://app.example.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: flowPage() })
    );
    await openSdk(page);
    const frame = page.frames().find((candidate) => candidate.url().includes("/e2e/fixtures/verification-flow.html"));
    expect(frame).toBeTruthy();

    await page.route("http://localhost:4173/**", (route) => route.continue());
    await frame.goto("http://app.example.test/handoff");
    await frame.locator("body").evaluate(() => {
      window.parent.postMessage({ type: "didit:completed", data: { sessionId: "ses_7", status: "Approved" }, timestamp: 1 }, "*");
      window.parent.postMessage({ type: "didit:close_request" }, "*");
    });
    await page.waitForTimeout(250);

    expect((await records(page)).results).toEqual([]);
    await expect(page.locator(OVERLAY)).toHaveClass(/active/);
  });
});

test.describe("web SDK on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("launches, closes and completes at 390 px", async ({ page }) => {
    const iframe = await openSdk(page);
    const close = page.getByRole("button", { name: "Close verification" });
    await expect(close).toBeInViewport();
    await close.click();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await postFromFrame(iframe, { type: "didit:completed", data: { sessionId: "ses_8", status: "Approved" }, timestamp: 1 });
    await expect.poll(async () => (await records(page)).results).toEqual([
      { type: "completed", session: { sessionId: "ses_8", status: "Approved" } }
    ]);
  });

  test("embedded mode fits the host on a phone", async ({ page }) => {
    await openSdk(page, "?embedded=true");
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const hostBox = await page.locator(HOST).boundingBox();
    const frameBox = await page.locator(FRAME).boundingBox();
    expect(frameBox.width).toBeCloseTo(hostBox.width, 0);
    expect(frameBox.height).toBeCloseTo(hostBox.height, 0);
  });
});
