import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { DiditAuthProvider, useDiditAuthContext } from "../context";
import { SignedIn, SignedOut } from "../control";
import { useAuth, useUser } from "../hooks";
import { snapshotOf } from "../store";
import { protectionRequired, session, stepUps, testClient } from "./test-client";

function wrapperFor(client: ReturnType<typeof testClient>["client"], locale?: string) {
  return ({ children }: { children?: ReactNode }) => (
    <DiditAuthProvider client={client} locale={locale}>
      {children}
    </DiditAuthProvider>
  );
}

describe("<DiditAuthProvider>", () => {
  it("loads the session once and renders the stylesheet once, with the CSP nonce", () => {
    const { client } = testClient();
    const { container, rerender } = render(
      <DiditAuthProvider client={client} nonce="n0nce">
        <SignedOut>out</SignedOut>
      </DiditAuthProvider>
    );

    rerender(
      <DiditAuthProvider client={client} nonce="n0nce">
        <SignedOut>still out</SignedOut>
      </DiditAuthProvider>
    );
    const styles = container.querySelectorAll("style[data-didit-auth]");

    expect(client.load).toHaveBeenCalledTimes(1);
    expect(styles).toHaveLength(1);
    expect(styles[0].getAttribute("nonce")).toBe("n0nce");
    expect(styles[0].textContent).toContain(".didit-ca{");
  });

  it("refuses hooks outside the provider", () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useAuth())).toThrow(/inside <DiditAuth>/);
    jest.restoreAllMocks();
  });

  it("resolves the language to a built-in one", () => {
    const { client } = testClient();

    expect(renderHook(() => useDiditAuthContext().locale, { wrapper: wrapperFor(client, "es-MX") }).result.current).toBe("es");
    expect(renderHook(() => useDiditAuthContext().locale, { wrapper: wrapperFor(client, "pt-BR") }).result.current).toBe("en");
  });
});

describe("<SignedIn> and <SignedOut>", () => {
  it("render nothing until the session is known, then follow it", () => {
    const { client, store } = testClient({ session: "loading" });

    render(
      <DiditAuthProvider client={client}>
        <SignedIn>member area</SignedIn>
        <SignedOut>please sign in</SignedOut>
      </DiditAuthProvider>
    );
    expect(screen.queryByText("member area")).toBeNull();
    expect(screen.queryByText("please sign in")).toBeNull();
    act(() => store.set(snapshotOf(null)));
    expect(screen.getByText("please sign in")).toBeTruthy();
    act(() => store.set(snapshotOf(session)));
    expect(screen.getByText("member area")).toBeTruthy();
    expect(screen.queryByText("please sign in")).toBeNull();
  });
});

describe("useAuth and useUser", () => {
  it("expose the session and the client's actions", async () => {
    const { client } = testClient({ session });
    const { result } = renderHook(() => ({ auth: useAuth(), user: useUser() }), { wrapper: wrapperFor(client) });

    expect(result.current.auth).toMatchObject({ isLoaded: true, isSignedIn: true, userId: session.user.id, sessionId: session.id });
    expect(result.current.user).toEqual({ isLoaded: true, isSignedIn: true, user: session.user });
    await expect(result.current.auth.getToken()).resolves.toBe("access-token");
    await result.current.auth.reauthenticate({ redirectUrl: "/payout" });
    expect(client.reauthenticate).toHaveBeenCalledWith({ redirectUrl: "/payout" });
    await act(() => result.current.auth.signOut());
    expect(result.current.auth.isSignedIn).toBe(false);
    expect(result.current.user.user).toBeNull();
  });

  it("run the application's step-up rules, not a new sign-in", async () => {
    const { client } = testClient({ session });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(client) });

    await expect(result.current.stepUp({ action: "contact" })).resolves.toEqual(stepUps.pending);
    expect(client.stepUp).toHaveBeenCalledWith({ action: "contact" });
    await expect(result.current.handleStepUpCallback("/account?step_up=x")).resolves.toEqual(stepUps.approved);
    expect(client.handleStepUpCallback).toHaveBeenCalledWith("/account?step_up=x");
    expect(client.reauthenticate).not.toHaveBeenCalled();
  });

  it("give headless screens the protection challenge and its two ways out", async () => {
    const { client } = testClient();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(client) });

    await expect(result.current.password.signIn({ email: "person@example.com", password: "secret" })).resolves.toEqual(
      protectionRequired
    );
    expect(protectionRequired).toEqual({ status: "protection_required", methods: ["email_code"], expiresIn: 300 });
    await expect(result.current.protection.verify({ code: "123456" })).resolves.toEqual({ status: "signed_in", session });
    await expect(result.current.protection.passkey()).resolves.toMatchObject({ status: "signed_in" });
    expect(result.current.emailCode).toBe(client.emailCode);
    expect(result.current.phone).toBe(client.phone);
    expect(result.current.mfa).toBe(client.mfa);
  });

  it("are not loaded while the session is being restored", () => {
    const { client } = testClient({ session: "loading" });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(client) });

    expect(result.current).toMatchObject({ isLoaded: false, isSignedIn: false, userId: null });
  });
});
