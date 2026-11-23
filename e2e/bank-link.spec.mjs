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
    await expect.poll(async () => (await records(page)).exit).toEqual([
      { reason: "failed", step: "bank_hop", link_id: "11111111-1111-4111-8111-111111111111" }
    ]);
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
    await page.waitForURL(/^http:\/\/localhost:4173\/bank\/link\//, { waitUntil: "commit" });
    // The hosted page does not exist in this fixture: assert what the SDK stored, then return as the hosted page would.
    await page.goto(HOST_PAGE);
    const stored = await page.evaluate(() => window.sessionStorage.getItem("didit_bank_link_resume"));
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("blt_");
    await page.goto(`${HOST_PAGE}?didit_resume=rsc_stubresume0001.c2VjcmV0X3ZhbHVl`);
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
    // The person sees a refusal card with a Close control, never an empty page.
    const card = page.locator(".didit-load-error");
    await expect(card).toBeVisible();
    await expect(card).toContainText("can't be opened here");
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    expect((await records(page)).exit).toEqual([{ reason: "not_allowed", step: null }]);
  });

  test("an unreachable API ends with error network and exit, never a hung opening state", async ({ page }) => {
    await page.goto(`${HOST_PAGE}?api=http://localhost:1`);
    await page.evaluate(() => window.openModal());
    await expect.poll(async () => (await records(page)).exit).toEqual([{ reason: "failed", step: null }]);
    expect((await records(page)).events[0].code).toBe("network");
    await expect(page.locator(FRAME)).toHaveCount(0);
  });
});

const DIALOG = ".didit-modal-overlay";

/** Whether focus is inside the dialog, as this page sees it (a focused frame is the frame element). */
const focusInDialog = (page) =>
  page.evaluate((selector) => document.querySelector(selector)?.contains(document.activeElement) ?? false, DIALOG);

test.describe("Bank Link modal: focus, scroll and layout", () => {
  test("focus moves into the dialog, Tab and Shift+Tab stay inside, Escape closes and focus returns to the opener", async ({ page }) => {
    await page.goto(HOST_PAGE);
    await page.focus("#open-modal");
    await page.keyboard.press("Enter");
    await expect(page.frameLocator(FRAME).getByRole("heading", { name: "Connect your bank" })).toBeVisible();
    expect(await focusInDialog(page)).toBe(true);
    const dialog = page.locator(DIALOG);
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(await dialog.getAttribute("aria-label")).toBeTruthy();

    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInDialog(page), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusInDialog(page), `Shift+Tab ${i + 1}`).toBe(true);
    }

    // Escape is heard by the page while the dialog (not the frame) holds focus.
    await page.evaluate(() => document.querySelector(".didit-modal-overlay").focus());
    await page.keyboard.press("Escape");
    await expect(page.locator(FRAME)).toHaveCount(0);
    expect((await records(page)).exit.map((e) => e.reason)).toEqual(["closed"]);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("open-modal");
  });

  test("the page behind does not scroll while the modal is open, and is exactly as before afterwards", async ({ page }) => {
    await page.goto(HOST_PAGE);
    await page.evaluate(() => window.scrollTo(0, 400));
    const snapshot = () =>
      page.evaluate(() => ({
        scrollY: window.scrollY,
        width: document.documentElement.clientWidth,
        bodyLeft: document.body.getBoundingClientRect().left,
        bodyWidth: document.body.getBoundingClientRect().width,
        rootStyle: document.documentElement.getAttribute("style") ?? "",
        bodyStyle: document.body.getAttribute("style") ?? ""
      }));
    const before = await snapshot();
    expect(before.scrollY).toBe(400);
    await page.evaluate(() => window.openModal());
    await expect(page.frameLocator(FRAME).getByRole("heading", { name: "Connect your bank" })).toBeVisible();
    await page.mouse.move(40, 400);
    await page.mouse.wheel(0, 600);
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(150);
    const open = await snapshot();
    expect(open.scrollY).toBe(400);
    expect(open.width).toBe(before.width); // no jump from the scrollbar leaving
    expect(open.bodyLeft).toBe(before.bodyLeft);
    expect(open.bodyWidth).toBe(before.bodyWidth);
    await page.locator(".didit-close-button").click();
    await expect(page.locator(FRAME)).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
  });

  test("open and close twice leave no overlay, curtain or inline style behind", async ({ page }) => {
    await page.goto(HOST_PAGE);
    const before = await page.evaluate(() => document.documentElement.getAttribute("style") ?? "");
    for (let round = 0; round < 2; round++) {
      await page.evaluate(() => window.openModal());
      await expect(page.locator(FRAME)).toHaveCount(1);
      await page.locator(".didit-close-button").click();
      await expect(page.locator(FRAME)).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.querySelectorAll(".didit-modal-overlay, .didit-modal-curtain").length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.getAttribute("style") ?? "")).toBe(before);
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    for (const scheme of ["light", "dark"]) {
      test(`the frame fills the dialog's content box at ${viewport.width}x${viewport.height}, ${scheme}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(HOST_PAGE);
        await page.evaluate(() => window.openModal());
        await expect(page.frameLocator(FRAME).getByRole("heading", { name: "Connect your bank" })).toBeVisible();
        await page.waitForTimeout(400); // the modal settles on the size the frame reported
        const geometry = await page.evaluate(() => {
          const container = document.querySelector(".didit-modal-container");
          const frame = container.querySelector("iframe");
          const c = container.getBoundingClientRect();
          const f = frame.getBoundingClientRect();
          const style = getComputedStyle(container);
          const px = (name) => parseFloat(style[name]) || 0;
          return {
            content: {
              left: c.left + px("borderLeftWidth") + px("paddingLeft"),
              top: c.top + px("borderTopWidth") + px("paddingTop"),
              right: c.right - px("borderRightWidth") - px("paddingRight"),
              bottom: c.bottom - px("borderBottomWidth") - px("paddingBottom")
            },
            frame: { left: f.left, top: f.top, right: f.right, bottom: f.bottom },
            overflowX: container.scrollWidth - container.clientWidth,
            overflowY: container.scrollHeight - container.clientHeight,
            frameBorder: getComputedStyle(frame).borderTopWidth
          };
        });
        for (const edge of ["left", "top", "right", "bottom"]) {
          expect(geometry.frame[edge], edge).toBeCloseTo(geometry.content[edge], 1);
        }
        expect(geometry.overflowX).toBe(0);
        expect(geometry.overflowY).toBe(0);
        expect(geometry.frameBorder).toBe("0px");
      });
    }
  }

  test("inline: the frame fills the container, and nothing is left behind after close", async ({ page }) => {
    await page.goto(HOST_PAGE);
    await page.evaluate(() => window.openInline());
    await expect(page.locator("#bank iframe")).toBeVisible();
    const sizes = await page.evaluate(() => {
      const box = document.getElementById("bank");
      const frame = box.querySelector("iframe").getBoundingClientRect();
      const cs = getComputedStyle(box);
      const inner = {
        width: box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        height: box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      };
      return { frame: { width: frame.width, height: frame.height }, inner };
    });
    expect(sizes.frame.width).toBeCloseTo(sizes.inner.width, 1);
    expect(sizes.frame.height).toBeCloseTo(sizes.inner.height, 1);
    const frame = page.frameLocator("#bank iframe");
    await frame.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("#bank iframe")).toHaveCount(0);
    expect(await page.evaluate(() => document.getElementById("bank").children.length)).toBe(0);
  });

  test("a resume with a dotted code continues, and an invalid option does not consume the code", async ({ page }) => {
    const code = "rsc_stubresume0001.c2VjcmV0X3ZhbHVl";
    const frame = await open(page, "modal");
    await frame.getByRole("button", { name: "Continue on this page" }).click();
    await page.waitForURL(/^http:\/\/localhost:4173\/bank\/link\//, { waitUntil: "commit" });
    const fragment = new URLSearchParams(new URL(page.url()).hash.slice(1));
    expect(fragment.get("resume_code")).toBe(code); // the dotted code was accepted from the frame and forwarded as is
    await page.goto(`${HOST_PAGE}?didit_resume=${code}`);
    await expect.poll(async () => (await records(page)).resume).toEqual({ resumed: true });
    await expect.poll(async () => (await records(page)).success.map((s) => s.resumed)).toEqual([true]);
  });

  test("an invalid option rejects and leaves the code in the address; the corrected call resumes", async ({ page }) => {
    const code = "rsc_stubresume0001.c2VjcmV0X3ZhbHVl";
    const frame = await open(page, "modal");
    await frame.getByRole("button", { name: "Continue on this page" }).click();
    await page.waitForURL(/^http:\/\/localhost:4173\/bank\/link\//, { waitUntil: "commit" });
    await page.goto(`${HOST_PAGE}?didit_resume=${code}&keep=1&noresume=1`);
    // The page skipped its own automatic call (noresume): the test drives the two calls itself.
    const failure = await page.evaluate(() => window.resumeWith({ apiBaseUrl: "not a url" }));
    expect(failure).toEqual({ error: "invalid_options" });
    expect(new URL(page.url()).searchParams.get("didit_resume")).toBe(code);
    expect(await page.evaluate(() => window.sessionStorage.getItem("didit_bank_link_resume"))).not.toBeNull();
    expect(await page.evaluate(() => window.resumeWith({}))).toEqual({ resumed: true });
    expect(new URL(page.url()).search).toBe("?keep=1&noresume=1");
    await expect.poll(async () => (await records(page)).success.map((s) => s.resumed)).toEqual([true]);
  });

  test("a frame id with a dot is refused with error unknown, never network", async ({ page }) => {
    await page.goto(`${HOST_PAGE}?token=blt_dotframe_0123456789ab`);
    await page.evaluate(() => window.openModal());
    await expect.poll(async () => (await records(page)).exit).toEqual([{ reason: "failed", step: null }]);
    expect((await records(page)).events[0].code).toBe("unknown");
    await expect(page.locator(FRAME)).toHaveCount(0);
  });

  test("inline: the frame follows the screen's height when the host fixed none, honours maxHeight and height, and keeps a host's own height", async ({ page }) => {
    const frameHeight = (selector) => page.locator(`${selector} iframe`).evaluate((el) => el.getBoundingClientRect().height);
    await page.goto(HOST_PAGE);
    await page.evaluate(() => window.openInlineAuto());
    await expect(page.locator("#auto iframe")).toBeVisible();
    await expect.poll(() => frameHeight("#auto")).toBe(900);
    expect(await page.evaluate(() => document.getElementById("auto").getBoundingClientRect().height)).toBe(900);
    await page.frameLocator("#auto iframe").getByRole("button", { name: "Close" }).click();
    await expect(page.locator("#auto iframe")).toHaveCount(0);

    await page.evaluate(() => window.openInlineAuto({ maxHeight: 500 }));
    await expect.poll(() => frameHeight("#auto")).toBe(500);
    await page.frameLocator("#auto iframe").getByRole("button", { name: "Close" }).click();

    await page.evaluate(() => window.openInlineAuto({ height: 300 }));
    await expect.poll(() => frameHeight("#auto")).toBe(300);
    await page.frameLocator("#auto iframe").getByRole("button", { name: "Close" }).click();

    // A host that fixed its own height (420px) keeps it; the framed page scrolls inside.
    await page.evaluate(() => window.openInline());
    await expect(page.locator("#bank iframe")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await frameHeight("#bank")).toBeCloseTo(420, 0);
  });

  test("a close at an early screen reports the link id and the last known step", async ({ page }) => {
    const frame = await open(page, "modal");
    await frame.getByRole("button", { name: "Close" }).click();
    await expect.poll(async () => (await records(page)).exit).toEqual([
      { reason: "closed", step: "consent", link_id: "11111111-1111-4111-8111-111111111111" }
    ]);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("IFRAME");
  });

  test("a frame that never posts a message ends with one error network and a retry that loads a fresh frame", async ({ page }) => {
    await page.clock.install();
    await page.goto(`${HOST_PAGE}?token=blt_silentonce_${Date.now()}abcdef`);
    await page.evaluate(() => window.openModal());
    await expect(page.locator(FRAME)).toHaveCount(1);
    expect(new URL(await page.locator(FRAME).getAttribute("src")).pathname).toContain("frame_silent");
    await page.clock.fastForward(26000);
    const card = page.locator(".didit-load-error");
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Try again" })).toBeFocused();
    await page.clock.fastForward(60000);
    expect((await records(page)).events).toEqual([{ name: "error", code: "network" }]); // reported once
    expect(await page.locator(FRAME).evaluate((el) => getComputedStyle(el).display)).toBe("none");

    await card.getByRole("button", { name: "Try again" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.frameLocator(FRAME).getByRole("heading", { name: "Connect your bank" })).toBeVisible();
    await expect.poll(() => names(page)).toEqual(["error", "opened"]);
    await page.clock.fastForward(60000);
    expect(await names(page)).toEqual(["error", "opened"]); // the first message cancelled the wait
  });

  test("closing while the retry card shows ends the flow with exit closed and nothing else", async ({ page }) => {
    await page.clock.install();
    await page.goto(`${HOST_PAGE}?token=blt_silentonce_${Date.now()}ghijkl`);
    await page.evaluate(() => window.openInline());
    await expect(page.locator("#bank iframe")).toHaveCount(1); // the wait starts when the frame is created
    await page.clock.fastForward(26000);
    await expect(page.locator("#bank .didit-load-error")).toBeVisible();
    await page.evaluate(() => window.closeLink());
    await expect(page.locator("#bank iframe, #bank .didit-load-error")).toHaveCount(0);
    expect((await records(page)).exit).toEqual([{ reason: "closed", step: null }]);
  });

  test("the timeout card's Close ends the flow with exit closed", async ({ page }) => {
    await page.clock.install();
    await page.goto(`${HOST_PAGE}?token=blt_silentonce_${Date.now()}mnopqr`);
    await page.evaluate(() => window.openModal());
    await expect(page.locator(FRAME)).toHaveCount(1);
    await page.clock.fastForward(26000);
    const card = page.locator(".didit-load-error");
    await expect(card.getByRole("button", { name: "Try again" })).toBeVisible();
    await card.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    expect((await records(page)).exit).toEqual([{ reason: "closed", step: null }]);
  });

  test("a plain http baseUrl is refused loudly: a thrown error, an error event and a console warning", async ({ page }) => {
    const warnings = [];
    page.on("console", (message) => message.type() === "warning" && warnings.push(message.text()));
    await page.goto(`${HOST_PAGE}?base=http://insecure.example&noresume=1`);
    const code = await page.evaluate(() => {
      try {
        window.openModal();
        return null;
      } catch (error) {
        return error.code;
      }
    });
    expect(code).toBe("invalid_options");
    expect((await records(page)).events).toEqual([{ name: "error", code: "invalid_options" }]);
    expect(warnings.some((text) => text.includes("baseUrl must be an https URL"))).toBe(true);
    await expect(page.locator(FRAME)).toHaveCount(0);
  });
});
