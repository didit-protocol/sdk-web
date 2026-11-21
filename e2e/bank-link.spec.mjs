import { expect, test } from "@playwright/test";

const FRAME = ".didit-verification-iframe";
const OVERLAY = ".didit-modal-overlay";
const HOST_PAGE = "/e2e/fixtures/bank-link.html";

const records = (page) => page.evaluate(() => window.records);
const names = async (page) => (await records(page)).events.map((event) => event.name);

async function open(page, mode) {
  await page.goto(HOST_PAGE);
  await page.evaluate((m) => (m === "inline" ? window.openInline() : window.openModal()), mode);
  const frame = page.frameLocator(FRAME);
  await expect(frame.getByRole("heading", { name: "Connect your bank" })).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["opened"]);
  return frame;
}

test.describe("Bank Link in the web SDK, against a stub frame that speaks the contract", () => {
  test("modal: opens, delivers events, succeeds once and closes", async ({ page }) => {
    const frame = await open(page, "modal");
    await expect(page.locator(OVERLAY)).toHaveClass(/active/);
    const src = new URL(await page.locator(FRAME).getAttribute("src"));
    expect(src.origin).toBe("http://localhost:4173");
    expect(src.pathname).toBe("/bank/frame/frame_stub_0001"); // the frame_id of the policy answer
    expect(src.search).toBe("");
    expect(await page.locator(FRAME).getAttribute("referrerpolicy")).toBe("no-referrer");

    // The stub read the token from the fragment and removed it from its own address.
    const fragment = await page.frames().find((f) => f.url().includes("/bank/frame/")).evaluate(() => window.fragment);
    expect(fragment.t).toBe("blt_0123456789abcdefghij");
    expect(fragment.parent_origin).toBe("http://127.0.0.1:4173");

    await frame.getByRole("button", { name: "Finish" }).click();
    await expect.poll(() => names(page)).toEqual(["opened", "success"]);
    await frame.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(FRAME)).toHaveCount(0);
    const data = await records(page);
    expect(data.success).toHaveLength(1);
    expect(data.success[0].link_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(data.exit).toHaveLength(0);
  });

  test("inline: renders inside the container, and a failure arrives as exit", async ({ page }) => {
    const frame = await open(page, "inline");
    await expect(page.locator("#bank iframe")).toBeVisible();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await frame.getByRole("button", { name: "Fail" }).click();
    await expect.poll(async () => (await records(page)).exit).toEqual([{ reason: "failed", step: "bank_hop" }]);
  });

  test("the modal's own close button ends the flow with exit closed", async ({ page }) => {
    await open(page, "modal");
    await page.locator(".didit-close-button").click();
    await expect.poll(async () => (await records(page)).exit.map((e) => e.reason)).toEqual(["closed"]);
    await expect(page.locator(FRAME)).toHaveCount(0);
  });

  test("bank hop: the SDK opens a popup, tells the frame, and navigates it to the bank address", async ({ page }) => {
    await page.context().route("https://bank.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<p>Stub bank sign-in</p>" })
    );
    const frame = await open(page, "modal");
    const popupPromise = page.waitForEvent("popup");
    await frame.getByRole("button", { name: "Continue to your bank" }).click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toBe("https://bank.example/auth");
    await expect.poll(async () => (await names(page)).includes("bank_redirect")).toBe(true);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    const received = await page.frames().find((f) => f.url().includes("/bank/frame/")).evaluate(() => window.received.map((m) => m.data.state));
    expect(received).toContain("opened");
    await popup.close();
    await expect.poll(async () =>
      page.frames().find((f) => f.url().includes("/bank/frame/")).evaluate(() => window.received.map((m) => m.data.state))
    ).toContain("closed");
  });

  test("redirect fallback: leaves the page for the hosted page and comes back through resumeBankLink", async ({ page }) => {
    const frame = await open(page, "modal");
    await frame.getByRole("button", { name: "Continue on this page" }).click();
    // Wait for the navigation to settle before the next one, or the two interrupt each other.
    await page.waitForURL(/^http:\/\/localhost:4173\/bank\/link\//);
    // The hosted page does not exist in this fixture: assert what the SDK stored, then return as the hosted page would.
    await page.goto(HOST_PAGE);
    const stored = await page.evaluate(() => window.sessionStorage.getItem("didit_bank_link_resume"));
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("blt_");
    await page.goto(`${HOST_PAGE}?didit_resume=stub_resume_code_1`);
    await expect.poll(async () => (await records(page)).resume).toEqual({ resumed: true });
    await expect.poll(async () => (await records(page)).success.map((s) => s.resumed)).toEqual([true]);
    await expect(page.locator(FRAME)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
  });

  test("ignores a message from another origin or another window", async ({ page }) => {
    await open(page, "modal");
    await page.evaluate(() => {
      window.postMessage({ type: "didit:bank_link:success", v: 1, data: { link_id: "x" } }, "*");
    });
    await page.waitForTimeout(200);
    expect(await names(page)).toEqual(["opened"]);
  });

  test("an unknown link opens no frame: error invalid_token, then exit not_allowed", async ({ page }) => {
    await page.goto(`${HOST_PAGE}?token=blt_invalid_0123456789abc`);
    await page.evaluate(() => window.openModal());
    await expect.poll(async () => (await records(page)).exit).toEqual([{ reason: "not_allowed", step: null }]);
    expect(await names(page)).toEqual(["error", "exit"]);
    expect((await records(page)).events[0].code).toBe("invalid_token");
    await expect(page.locator(FRAME)).toHaveCount(0);
  });

  test("a page origin the link does not list opens no frame and warns the developer", async ({ page }) => {
    const warnings = [];
    page.on("console", (message) => message.type() === "warning" && warnings.push(message.text()));
    await page.goto(`${HOST_PAGE}?token=blt_otherorigin_0123456789`);
    await page.evaluate(() => window.openModal());
    await expect.poll(async () => (await records(page)).exit).toEqual([{ reason: "not_allowed", step: null }]);
    expect((await records(page)).events[0].code).toBe("origin_not_allowed");
    await expect(page.locator(FRAME)).toHaveCount(0);
    expect(warnings.some((text) => text.includes("http://127.0.0.1:4173") && text.includes("allowed_origins"))).toBe(true);
  });

  test("an unreachable API ends with error network and exit, never a hung opening state", async ({ page }) => {
    await page.goto(`${HOST_PAGE}?api=http://localhost:1`);
    await page.evaluate(() => window.openModal());
    await expect.poll(async () => (await records(page)).exit).toEqual([{ reason: "failed", step: null }]);
    expect((await records(page)).events[0].code).toBe("network");
    await expect(page.locator(FRAME)).toHaveCount(0);
  });
});
