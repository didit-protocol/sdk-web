import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const mailbox = process.env.E2E_MAILBOX ?? "";
const seedGrants = process.env.E2E_SEED_GRANTS ?? "";
const email = `browser${Date.now()}@example.com`;
const password = "A-long-test-passphrase-982!";
const newPassword = "Another-test-passphrase-723!";
let context: BrowserContext;
let page: Page;
let lastSession: string | undefined;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.VITE_DIDIT_PUBLISHABLE_KEY || !mailbox, "A sandbox key and email delivery sink are required.");

function messages(): { to: string; html: string }[] {
  return existsSync(mailbox) ? readFileSync(mailbox, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
}

async function nextMail(after: number): Promise<string> {
  let html = "";
  await expect.poll(() => {
    html = messages().slice(after).find(message => message.to === email)?.html ?? "";
    return Boolean(html);
  }).toBe(true);
  return html;
}

async function login(secret: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(secret);
  await page.locator('button[name="action"][value="password"]').click();
}

async function logout() {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  page.on("response", async response => {
    if (response.url().endsWith("/session/") && response.request().method() === "GET" && response.ok()) {
      lastSession = ((await response.json()) as { sid: string }).sid;
    }
  });
});
test.afterAll(async () => { await context.close(); });

test("hosted signup completes through the real browser peer and survives reload", async () => {
  await page.goto("/sign-up");
  await page.locator('button[name="action"][value="show_signup"]').click();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const before = messages().length;
  await page.locator('button[name="action"][value="signup"]').click();
  const code = (await nextMail(before)).match(/(\d{3}) (\d{3})<\/span>/);
  expect(code).not.toBeNull();
  await page.locator('input[name="code"]').fill(`${code![1]}${code![2]}`);
  await page.locator('button[name="action"][value="complete"]').click();
  await expect(page.getByRole("heading", { name: "You are signed in" })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});

test("step-up confirms the same person and replaces the browser session", async () => {
  const previous = lastSession;
  expect(previous).toBeDefined();
  await page.getByRole("button", { name: "Sign in again to continue" }).click();
  await login(password);
  await expect(page.getByRole("heading", { name: "You are signed in" })).toBeVisible();
  await expect.poll(() => lastSession).not.toBe(previous);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});

test("the real grants endpoint supplies the list and records revocation", async () => {
  test.skip(!seedGrants, "Set E2E_SEED_GRANTS to provision grants for this person.");
  const [command, ...args] = seedGrants.split(" ");
  execFileSync(command, [...args, email], { stdio: "inherit" });
  await page.reload();
  const card = page.getByRole("region", { name: "Connected agents" });
  await card.getByRole("button", { name: /^Revoke:/ }).first().click();
  await expect(card.getByText("Revoked", { exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText("Revoked", { exact: true })).toBeVisible();
});

test("sign-out, forgot password and password sign-in use the real hosted flow", async () => {
  await logout();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await login("not-the-correct-password");
  await page.locator('button[name="action"][value="show_reset"]').click();
  await page.locator('input[name="email"]').fill(email);
  const before = messages().length;
  await page.locator('button[name="action"][value="reset"]').click();
  const link = (await nextMail(before)).match(/href="([^"]+\/reset\/\?token=[^"]+)"/);
  expect(link).not.toBeNull();
  await page.goto(link![1].replace(/&amp;/g, "&"));
  await page.locator('input[name="password"]').fill(newPassword);
  await page.locator('button[name="action"][value="new_password"]').click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible();
  await page.goto("/sign-in");
  await login(newPassword);
  await expect(page.getByRole("heading", { name: "You are signed in" })).toBeVisible();
  await logout();
});
