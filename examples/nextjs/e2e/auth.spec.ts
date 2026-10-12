import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Runs against a real Didit Frontend API (a Sandbox application, or a local
// stack). Sign-up and password reset read their emails from E2E_MAILBOX, a
// JSON Lines file with one { to, subject, html } object per email sent.
const FRONTEND_API = process.env.DIDIT_FRONTEND_API ?? "";
const MAILBOX = process.env.E2E_MAILBOX ?? "";
// Optional: a command that gives the signed-up person agent grants; it gets the email as its last argument.
const SEED_GRANTS = process.env.E2E_SEED_GRANTS ?? "";

const APP = `http://localhost:${process.env.E2E_PORT ?? 3000}`;
const email = `person${Date.now()}@example.com`;
const password = "A-long-random-passphrase-491!";
const newPassword = "Another-long-passphrase-582!";

test.describe.configure({ mode: "serial" });
test.skip(!FRONTEND_API || !MAILBOX, "Set DIDIT_FRONTEND_API and E2E_MAILBOX to run against a Frontend API.");

let context: BrowserContext;
let page: Page;

function mailCount(): number {
  return existsSync(MAILBOX) ? readFileSync(MAILBOX, "utf8").split("\n").filter(Boolean).length : 0;
}

async function mailTo(address: string, after: number): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const mails = readFileSync(MAILBOX, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(after)
      .map((line) => JSON.parse(line) as { to: string; html: string });
    const mail = mails.reverse().find((entry) => entry.to === address);

    if (mail) return mail.html;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email reached ${address}.`);
}

async function cookie(name: string) {
  return (await context.cookies()).find((entry) => entry.name === name);
}

async function session(): Promise<{ id: string; methods: string[] } | null> {
  const response = await page.request.get("/auth/session", { headers: { "x-didit-auth": "fetch" } });

  return ((await response.json()) as { session: { id: string; methods: string[] } | null }).session;
}

async function signInOnHostedPage(secret: string) {
  await expect(page).toHaveURL(new RegExp(`^${FRONTEND_API.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/sign-in/`));
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(secret);
  await page.locator('button[name="action"][value="password"]').click();
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test("a protected page sends a signed-out visitor to the hosted sign-in", async () => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\/\?redirect_uri=/);
  const hosted = new URL(page.url());

  expect(hosted.searchParams.get("code_challenge_method")).toBe("S256");
  expect(hosted.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const transaction = (await context.cookies()).find((entry) => entry.name.startsWith("didit_tx."));

  expect(transaction?.httpOnly).toBe(true);
  expect(transaction?.sameSite).toBe("Lax");
});

test("sign up with an email code lands back in the app, signed in", async () => {
  await page.goto("/sign-up");
  const state = new URL(page.url()).searchParams.get("state")!;
  const transaction = `didit_tx.${state.slice(0, 16)}`;

  expect(await cookie(transaction)).toBeDefined();
  await page.locator('button[name="action"][value="show_signup"]').click();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const before = mailCount();

  await page.locator('button[name="action"][value="signup"]').click();
  const code = (await mailTo(email, before)).match(/(\d{3}) (\d{3})<\/span>/);

  expect(code).not.toBeNull();
  await page.locator('input[name="code"]').fill(`${code![1]}${code![2]}`);
  await page.locator('button[name="action"][value="complete"]').click();

  await expect(page).toHaveURL(`${APP}/`);
  await expect(page.getByRole("heading", { name: "You are signed in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  const access = await cookie("didit_at");
  const refresh = await cookie("didit_rt");

  expect(access?.httpOnly && refresh?.httpOnly).toBe(true);
  // This sign-in's transaction cookie is spent; an abandoned one simply expires.
  expect(await cookie(transaction)).toBeUndefined();
});

test("the account page is rendered on the server with the session", async () => {
  const html = await (await page.request.get("/account")).text();

  expect(html).toContain(email);
  await page.goto("/account");
  await expect(page.getByTestId("email")).toContainText(email);
  await expect(page.getByTestId("methods")).not.toBeEmpty();
});

test("an expired access token is refreshed without signing the person out", async () => {
  const before = await cookie("didit_rt");

  await context.clearCookies({ name: "didit_at" });
  await page.goto("/account");
  await expect(page.getByTestId("email")).toContainText(email);
  const after = await cookie("didit_rt");

  expect(await cookie("didit_at")).toBeDefined();
  expect(after?.value).not.toBe(before?.value);
});

test("connected agents can be revoked", async () => {
  if (SEED_GRANTS) {
    const [command, ...args] = SEED_GRANTS.split(" ");

    execFileSync(command, [...args, email], { stdio: "inherit" });
  }
  await page.goto("/account/agents");
  const card = page.getByRole("region", { name: "Connected agents" });

  await expect(card).toBeVisible();
  const revoke = card.getByRole("button", { name: /^Revoke: / });

  test.skip((await revoke.count()) === 0, "No agent grants for this person (set E2E_SEED_GRANTS).");
  const agent = (await revoke.first().getAttribute("aria-label"))!.replace("Revoke: ", "");

  await revoke.first().click();
  await expect(card.getByText(`${agent}'s session ended everywhere.`, { exact: false })).toBeVisible();
  await expect(card.getByText("Revoked", { exact: true })).toBeVisible();
  const listed = await page.request.get("/auth/agents", { headers: { "x-didit-auth": "fetch" } });
  const grants = ((await listed.json()) as { agents: { agentName: string; revokedAt: string | null }[] }).agents;

  expect(grants.find((grant) => grant.agentName === agent)?.revokedAt).not.toBeNull();
});

test("confirming it is you signs in again and replaces the session", async () => {
  const before = await session();

  await page.goto("/account/security");
  await page.getByRole("button", { name: "Sign in again to continue" }).click();
  await signInOnHostedPage(password);
  await expect(page).toHaveURL(`${APP}/account/security`);
  const after = await session();

  expect(after?.id).toBeDefined();
  expect(after?.id).not.toBe(before?.id);
});

test("signing out ends the session at Didit and clears the cookies", async () => {
  const token = ((await (await page.request.get("/auth/token", { headers: { "x-didit-auth": "fetch" } })).json()) as {
    token: string;
  }).token;

  await page.goto("/");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(await cookie("didit_at")).toBeUndefined();
  expect(await cookie("didit_rt")).toBeUndefined();
  const check = await page.request.get(`${FRONTEND_API}/session/`, { headers: { Authorization: `Bearer ${token}` } });

  expect(check.status()).toBe(401);
});

test("a forgotten password is reset and the new one signs in", async () => {
  await page.goto("/sign-in");
  await signInOnHostedPage("not-the-right-password");
  await page.locator('button[name="action"][value="show_reset"]').click();
  await page.locator('input[name="email"]').fill(email);
  const before = mailCount();

  await page.locator('button[name="action"][value="reset"]').click();
  const link = (await mailTo(email, before)).match(/href="([^"]+\/reset\/\?token=[^"]+)"/);

  expect(link).not.toBeNull();
  await page.goto(link![1].replace(/&amp;/g, "&"));
  await page.locator('input[name="password"]').fill(newPassword);
  await page.locator('button[name="action"][value="new_password"]').click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible();

  await page.goto("/sign-in?redirect_url=/account");
  await signInOnHostedPage(newPassword);
  await expect(page).toHaveURL(`${APP}/account`);
  await expect(page.getByTestId("email")).toContainText(email);
});
