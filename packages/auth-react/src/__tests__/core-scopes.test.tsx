// Two provider scopes are two AuthClients over one browser session. They must agree on who is
// signed in without repeating the one-time redirect exchange.
const coreSession = {
  userId: "00000000-0000-4000-8000-000000000002",
  sessionId: "00000000-0000-4000-8000-000000000001",
  applicationId: "00000000-0000-4000-8000-000000000003",
  vendorData: null,
  email: "maria.oliveira@example.com",
  emailVerified: true,
  phone: null,
  methods: ["password"],
  mfaVerified: false,
  verifiedIdentity: null,
  organizations: [],
  expiresAt: "2099-11-11T08:30:56Z"
};

let signedIn = false;
let pending = true;
let exchanges = 0;
const listeners = new Set<(event: string, session: unknown) => void>();

function emit(event: string, session: unknown) {
  listeners.forEach((listener) => listener(event, session));
}

function makeCore() {
  return {
    handleRedirectCallback: jest.fn(async () => {
      if (!pending) throw new Error("invalid_state");
      pending = false;
      exchange();
      return { session: coreSession, returnTo: "/account" };
    }),
    getSession: jest.fn(async () => (signedIn ? coreSession : null)),
    onAuthStateChange: jest.fn((listener: (event: string, session: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    signIn: jest.fn(async () => undefined),
    signOut: jest.fn(async () => {
      signedIn = false;
      emit("SIGNED_OUT", null);
    }),
    reauthenticate: jest.fn(async () => undefined),
    stepUp: jest.fn(),
    handleStepUpCallback: jest.fn(),
    getToken: jest.fn(async () => (signedIn ? "access-token" : null)),
    password: { signIn: jest.fn() },
    emailCode: { start: jest.fn(), verify: jest.fn() },
    phone: { start: jest.fn(), verify: jest.fn() },
    protection: { verify: jest.fn(), passkey: jest.fn() },
    mfa: { verify: jest.fn(), setup: jest.fn() },
    agents: { list: jest.fn(async () => []), revoke: jest.fn(async () => undefined) }
  };
}

function exchange() {
  exchanges += 1;
  signedIn = true;
  emit("SIGNED_IN", coreSession);
}

const createDiditAuth = jest.fn(() => makeCore());
jest.mock("@didit-protocol/auth", () => ({ createDiditAuth }), { virtual: true });

import { waitFor } from "@testing-library/react";

import { createCoreAuthClient } from "../core";

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  signedIn = false;
  pending = true;
  exchanges = 0;
  listeners.clear();
  window.history.replaceState(null, "", "/callback?code=c&state=s");
});

afterEach(() => jest.restoreAllMocks());

it("settles two provider scopes on the one session and exchanges the redirect once", async () => {
  const first = createCoreAuthClient({ publishableKey: "pk_test_example" });
  const second = createCoreAuthClient({ publishableKey: "pk_test_example" });
  first.subscribe(() => undefined);
  second.subscribe(() => undefined);

  await Promise.all([first.load(), second.load()]);
  await waitFor(() => expect(second.getSnapshot().status).toBe("signed-in"));
  expect(first.getSnapshot().status).toBe("signed-in");
  expect(second.getSnapshot().session?.user.id).toBe(coreSession.userId);
  expect(exchanges).toBe(1);
  expect(window.location.pathname).toBe("/account");
});

it("tells the other scope when one signs out", async () => {
  const first = createCoreAuthClient({ publishableKey: "pk_test_example" });
  const second = createCoreAuthClient({ publishableKey: "pk_test_example" });
  const stopFirst = first.subscribe(() => undefined);
  const stopSecond = second.subscribe(() => undefined);
  await Promise.all([first.load(), second.load()]);
  await waitFor(() => expect(second.getSnapshot().status).toBe("signed-in"));

  await first.signOut();

  await waitFor(() => expect(second.getSnapshot().status).toBe("signed-out"));
  expect(first.getSnapshot().status).toBe("signed-out");
  stopFirst();
  stopSecond();
});
