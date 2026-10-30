// The peer seam uses the published headless API, including flat sessions and event names.
const core = {
  handleRedirectCallback: jest.fn(),
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signIn: jest.fn(async () => undefined),
  signOut: jest.fn(async () => undefined),
  reauthenticate: jest.fn(async () => undefined),
  stepUp: jest.fn(),
  handleStepUpCallback: jest.fn(),
  getToken: jest.fn(async () => "token"),
  password: { signIn: jest.fn() },
  emailCode: { start: jest.fn(), verify: jest.fn() },
  phone: { start: jest.fn(), verify: jest.fn() },
  protection: { verify: jest.fn(), passkey: jest.fn() },
  mfa: { verify: jest.fn(), setup: jest.fn() },
  agents: { list: jest.fn(async () => []), revoke: jest.fn(async () => undefined) }
};
const createDiditAuth = jest.fn(() => core);

jest.mock("@didit-protocol/auth", () => ({ createDiditAuth }), { virtual: true });

import { render, screen, waitFor } from "@testing-library/react";

import { SignedIn, SignedOut } from "../control";
import { DiditAuth } from "../DiditAuth";
import { createCoreAuthClient } from "../core";
import { protectionRequired, session, stepUps } from "./test-client";

const coreSession = {
  ...session.user, userId: session.user.id, sessionId: session.id,
  methods: session.methods, mfaVerified: session.mfaVerified, expiresAt: session.expiresAt
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, "", "/");
  core.getSession.mockResolvedValue(coreSession);
});

afterEach(() => jest.restoreAllMocks());

describe("<DiditAuth publishableKey>", () => {
  it("creates the browser core with the key and completes a returning sign-in", async () => {
    window.history.replaceState(null, "", "/callback?code=c&state=s");
    core.handleRedirectCallback.mockResolvedValue({ returnTo: "/account", session: coreSession });
    core.getSession.mockResolvedValue(coreSession);

    render(
      <DiditAuth publishableKey="pk_test_example">
        <SignedIn>signed in</SignedIn>
        <SignedOut>signed out</SignedOut>
      </DiditAuth>
    );
    await screen.findByText("signed in");
    expect(createDiditAuth).toHaveBeenCalledWith({ publishableKey: "pk_test_example", redirectUri: undefined, language: undefined });
    expect(window.location.pathname + window.location.search).toBe("/account");
  });

  it("reads as signed out when the session cannot be restored", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/callback?code=c&state=s");
    core.handleRedirectCallback.mockRejectedValue(new Error("state mismatch"));

    render(
      <DiditAuth publishableKey="pk_test_example">
        <SignedOut>signed out</SignedOut>
      </DiditAuth>
    );
    await screen.findByText("signed out");
  });
});

describe("createCoreAuthClient", () => {
  it("maps the components' calls onto the core", async () => {
    const client = createCoreAuthClient({ publishableKey: "pk_test_example" });

    await client.signIn({ redirectUrl: "/a" });
    await client.signUp({ redirectUrl: "/b" });
    await client.reauthenticate({ redirectUrl: "/c" });
    await client.revokeAgent("grant");
    expect(core.signIn.mock.calls).toEqual([[{ returnTo: "/a" }], [{ returnTo: "/b" }]]);
    expect(core.reauthenticate).toHaveBeenCalledWith({ returnTo: "/c" });
    expect(core.agents.revoke).toHaveBeenCalledWith("grant");
    await expect(client.getToken()).resolves.toBe("token");
  });

  it("runs the core's step-up, not a new sign-in", async () => {
    const client = createCoreAuthClient({ publishableKey: "pk_test_example" });

    core.stepUp.mockResolvedValue(stepUps.notRequired);
    await expect(client.stepUp({ action: "payout", amount: "900.00", currency: "USD" })).resolves.toEqual(stepUps.notRequired);
    expect(core.stepUp).toHaveBeenCalledWith({ action: "payout", amount: "900.00", currency: "USD" });
    core.handleStepUpCallback.mockResolvedValue(stepUps.approved);
    await expect(client.handleStepUpCallback()).resolves.toEqual(stepUps.approved);
    expect(core.handleStepUpCallback).toHaveBeenCalledWith(undefined);
    expect(core.reauthenticate).not.toHaveBeenCalled();
    expect(core.signIn).not.toHaveBeenCalled();
  });

  it("hands headless steps to the core and reports its sessions in the components' shape", async () => {
    const client = createCoreAuthClient({ publishableKey: "pk_test_example" });

    core.password.signIn.mockResolvedValue(protectionRequired);
    core.protection.verify.mockResolvedValue({ status: "signed_in", session: coreSession });
    core.mfa.setup.mockResolvedValue({ status: "signed_in", session: coreSession, recoveryCodes: ["a", "b"] });
    await expect(client.password.signIn({ email: "person@example.com", password: "secret" })).resolves.toEqual(protectionRequired);
    await expect(client.protection.verify({ code: "123456" })).resolves.toEqual({ status: "signed_in", session });
    await expect(client.mfa.setup({ code: "654321" })).resolves.toEqual({ status: "signed_in", session, recoveryCodes: ["a", "b"] });
    expect(core.password.signIn).toHaveBeenCalledWith({ email: "person@example.com", password: "secret" });
    expect(core.protection.verify).toHaveBeenCalledWith({ code: "123456" });
  });

  it("keeps the session when a token refresh has none cached yet", async () => {
    const client = createCoreAuthClient({ publishableKey: "pk_test_example" });
    await client.load();
    const listener = core.onAuthStateChange.mock.calls[0][0] as (event: string, value: unknown) => void;

    listener("SIGNED_IN", coreSession);
    listener("TOKEN_REFRESHED", null);
    expect(client.getSnapshot()).toEqual({ status: "signed-in", session });
  });

  it("follows the core's auth state changes", async () => {
    const client = createCoreAuthClient({ publishableKey: "pk_test_example" });
    await client.load();
    const listener = core.onAuthStateChange.mock.calls[0][0] as (event: string, value: unknown) => void;

    listener("SIGNED_IN", coreSession);
    await waitFor(() => expect(client.getSnapshot()).toEqual({ status: "signed-in", session }));
    listener("SIGNED_OUT", null);
    expect(client.getSnapshot().status).toBe("signed-out");
  });
});

it("restores an ordinary page without attempting a callback", async () => {
  const client = createCoreAuthClient({ publishableKey: "pk_test_example" });

  expect(createDiditAuth).not.toHaveBeenCalled();
  await client.load();
  expect(core.handleRedirectCallback).not.toHaveBeenCalled();
  expect(client.getSnapshot().session).toEqual(session);
});

it("refuses an external callback return path", async () => {
  const client = createCoreAuthClient({ publishableKey: "pk_test_example" });

  window.history.replaceState(null, "", "/callback?code=c&state=s");
  core.handleRedirectCallback.mockResolvedValue({ returnTo: "https://other.example", session: coreSession });
  await client.load();
  expect(window.location.pathname).toBe("/callback");
});
