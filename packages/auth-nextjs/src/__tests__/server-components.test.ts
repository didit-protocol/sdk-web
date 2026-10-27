jest.mock("next/headers", () => ({ cookies: jest.fn(), headers: jest.fn() }));

import { isValidElement, type ReactElement } from "react";
import { cookies, headers } from "next/headers";

import { DiditAuthRouteProvider } from "../client/DiditAuthRouteProvider";
import { DiditAuth } from "../server/DiditAuth";
import { SignIn, SignUp } from "../server/SignIn";
import { resetCaches } from "../server/session-cache";
import { ENV, recorded, replay } from "./replay";

function requestWith(cookieValues: Record<string, string>, headerValues: Record<string, string> = {}) {
  (cookies as jest.Mock).mockResolvedValue({ get: (name: string) => (name in cookieValues ? { name, value: cookieValues[name] } : undefined) });
  (headers as jest.Mock).mockResolvedValue(new Headers(headerValues));
}

async function redirectOf(page: Promise<unknown>): Promise<string> {
  const error = (await page.catch((caught: unknown) => caught)) as { digest?: string };

  return error.digest!.split(";")[2];
}

const signedIn = { didit_at: recorded.tokenIssued.body.access_token };

beforeAll(() => Object.assign(process.env, ENV));
beforeEach(() => resetCaches());

describe("<SignIn /> and <SignUp /> pages", () => {
  it("send a signed-out visitor to the hosted page, keeping where they were going", async () => {
    replay();
    requestWith({});
    await expect(redirectOf(SignIn({ searchParams: Promise.resolve({ redirect_url: "/account" }) }))).resolves.toBe(
      "/auth/sign-in?redirect_url=%2Faccount"
    );
    await expect(redirectOf(SignUp({}))).resolves.toBe("/auth/sign-up?redirect_url=%2F");
  });

  it("send someone already signed in straight on, and never to another site", async () => {
    replay({ method: "GET", path: "session/", response: recorded.session });
    requestWith(signedIn);
    await expect(redirectOf(SignIn({ searchParams: Promise.resolve({ redirect_url: ["/account", "/x"] }) }))).resolves.toBe("/account");
    await expect(redirectOf(SignIn({ searchParams: Promise.resolve({ redirect_url: "https://evil.example" }) }))).resolves.toBe("/");
  });
});

describe("<DiditAuth> in a server layout", () => {
  it("hands the client the session it read and the visitor's language", async () => {
    replay({ method: "GET", path: "session/", response: recorded.session });
    requestWith(signedIn, { "accept-language": "fr-FR,fr;q=0.9" });
    const element = (await DiditAuth({ children: "page" })) as ReactElement<Record<string, unknown>>;

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(DiditAuthRouteProvider);
    expect(element.props).toMatchObject({ locale: "fr", children: "page", initialSession: { id: recorded.session.body.sid } });
    // Headless sign-in runs in the browser with the application's key and this app's callback.
    expect(element.props).toMatchObject({ publishableKey: ENV.DIDIT_PUBLISHABLE_KEY, redirectUri: ENV.DIDIT_REDIRECT_URI });
  });

  it("renders signed out when Didit cannot be reached", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    replay({ method: "GET", path: "session/", response: { status: 503, body: { detail: "unavailable" } } });
    requestWith(signedIn);
    const element = (await DiditAuth({ locale: "ja" })) as ReactElement<Record<string, unknown>>;

    expect(element.props).toMatchObject({ initialSession: null, locale: "ja" });
  });
});
