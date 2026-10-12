// The headless core ships as its own package; this stands in for its documented contract.
const core = {
  handleRedirectCallback: jest.fn(),
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signIn: jest.fn(async () => undefined),
  signOut: jest.fn(async () => undefined),
  stepUp: jest.fn(async () => undefined),
  getToken: jest.fn(async () => "token"),
  agents: { list: jest.fn(async () => []), revoke: jest.fn(async () => undefined) }
};
const createDiditAuth = jest.fn(() => core);

jest.mock("@didit-protocol/auth", () => ({ createDiditAuth }), { virtual: true });

import { render, screen, waitFor } from "@testing-library/react";

import { SignedIn, SignedOut } from "../control";
import { DiditAuth } from "../DiditAuth";
import { createCoreAuthClient } from "../core";
import { session } from "./test-client";

beforeEach(() => jest.clearAllMocks());

describe("<DiditAuth publishableKey>", () => {
  it("creates the browser core with the key and completes a returning sign-in", async () => {
    window.history.replaceState(null, "", "/callback?code=c&state=s");
    core.handleRedirectCallback.mockResolvedValue({ returnTo: "/account" });
    core.getSession.mockResolvedValue(session);

    render(
      <DiditAuth publishableKey="pk_test_example">
        <SignedIn>signed in</SignedIn>
        <SignedOut>signed out</SignedOut>
      </DiditAuth>
    );
    await screen.findByText("signed in");
    expect(createDiditAuth).toHaveBeenCalledWith({ publishableKey: "pk_test_example", frontendApi: undefined, redirectUri: undefined });
    expect(window.location.pathname + window.location.search).toBe("/account");
  });

  it("reads as signed out when the session cannot be restored", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
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
    await client.stepUp({ redirectUrl: "/c" });
    await client.revokeAgent("grant");
    expect(core.signIn.mock.calls).toEqual([[{ returnTo: "/a", screen: "sign-in" }], [{ returnTo: "/b", screen: "sign-up" }]]);
    expect(core.stepUp).toHaveBeenCalledWith({ returnTo: "/c" });
    expect(core.agents.revoke).toHaveBeenCalledWith("grant");
    await expect(client.getToken()).resolves.toBe("token");
  });

  it("follows the core's auth state changes", async () => {
    const client = createCoreAuthClient({ publishableKey: "pk_test_example" });
    const listener = core.onAuthStateChange.mock.calls[0][0] as (value: unknown) => void;

    listener(session);
    await waitFor(() => expect(client.getSnapshot()).toEqual({ status: "signed-in", session }));
    listener(null);
    expect(client.getSnapshot().status).toBe("signed-out");
  });
});
