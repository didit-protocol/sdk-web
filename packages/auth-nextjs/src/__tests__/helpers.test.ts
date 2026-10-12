import { DiditAuthConfigError, resolveConfig } from "../server/config";
import {
  cookieNames,
  decodeRefresh,
  decodeTransaction,
  encodeRefresh,
  encodeTransaction,
  readSessionCookies
} from "../server/cookies";
import { negotiateLocale } from "../server/locale";
import { codeChallenge, randomString, timingSafeEqual } from "../server/pkce";
import { safeReturnTo } from "../server/return-to";
import { ENV } from "./replay";

describe("PKCE", () => {
  it("derives the S256 challenge of RFC 7636 appendix B", async () => {
    await expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("makes 43-character URL-safe verifiers that differ every time", () => {
    const values = new Set(Array.from({ length: 50 }, () => randomString()));

    expect(values.size).toBe(50);
    values.forEach((value) => expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/));
  });

  it("compares strings without short-circuiting", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("resolveConfig", () => {
  it("reads the Frontend API and callback from the environment", () => {
    expect(resolveConfig({ ...ENV, DIDIT_FRONTEND_API: `${ENV.DIDIT_FRONTEND_API}/` })).toEqual({
      frontendApi: ENV.DIDIT_FRONTEND_API,
      redirectUri: ENV.DIDIT_REDIRECT_URI,
      callbackPath: "/auth/callback",
      basePath: "/auth",
      secure: false,
      sessionCacheMs: 30_000
    });
  });

  it("asks for the Frontend API, even when a publishable key is set", () => {
    expect(() => resolveConfig({ DIDIT_PUBLISHABLE_KEY: "pk_test_x", DIDIT_REDIRECT_URI: ENV.DIDIT_REDIRECT_URI })).toThrow(
      /DIDIT_FRONTEND_API/
    );
    expect(() => resolveConfig({ DIDIT_FRONTEND_API: ENV.DIDIT_FRONTEND_API })).toThrow(DiditAuthConfigError);
  });

  it("refuses plain http outside localhost", () => {
    expect(() => resolveConfig({ ...ENV, DIDIT_FRONTEND_API: "http://auth.example.com" })).toThrow(/https/);
    expect(() => resolveConfig({ ...ENV, DIDIT_REDIRECT_URI: "http://app.example.com/auth/callback" })).toThrow(/https/);
  });

  it("marks an https app secure and caps the session cache", () => {
    const config = resolveConfig({
      DIDIT_FRONTEND_API: "https://auth.example.com",
      DIDIT_REDIRECT_URI: "https://app.example.com/auth/callback",
      DIDIT_SESSION_CACHE_SECONDS: "9999"
    });

    expect(config.secure).toBe(true);
    expect(config.sessionCacheMs).toBe(300_000);
  });
});

describe("cookies", () => {
  it("uses __Host- names only over https", () => {
    expect(cookieNames({ secure: true })).toEqual({
      access: "__Host-didit_at",
      refresh: "__Host-didit_rt",
      transaction: "__Host-didit_tx."
    });
    expect(cookieNames({ secure: false }).access).toBe("didit_at");
  });

  it("round-trips the refresh cookie and refuses anything else", () => {
    const stored = { token: "refreshToken2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", expiresAt: 1794385856 };

    expect(decodeRefresh(encodeRefresh(stored))).toEqual(stored);
    expect(decodeRefresh("1794385856.bad token")).toBeNull();
    expect(decodeRefresh("soon.refreshToken")).toBeNull();
    expect(decodeRefresh(undefined)).toBeNull();
  });

  it("round-trips the sign-in transaction, whatever the return path holds", () => {
    const transaction = { verifier: randomString(), state: randomString(), returnTo: "/a:b/~c?d=e&f=%20#g" };

    expect(decodeTransaction(encodeTransaction(transaction))).toEqual(transaction);
    expect(decodeTransaction("only:two")).toBeNull();
    expect(decodeTransaction("a:b:%E0%A4%A")).toBeNull();
  });

  it("ignores an oversized access cookie", () => {
    const names = cookieNames({ secure: false });
    const read = readSessionCookies(names, (name) => (name === names.access ? "x".repeat(129) : undefined));

    expect(read).toEqual({ access: null, refresh: null });
  });
});

describe("safeReturnTo", () => {
  it.each([
    ["/account", "/account"],
    ["/account?tab=agents#top", "/account?tab=agents#top"],
    ["/a/../b", "/b"]
  ])("keeps the path %s", (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "account", "", null, undefined])(
    "refuses %p",
    (value) => {
      expect(safeReturnTo(value)).toBeNull();
    }
  );
});

describe("negotiateLocale", () => {
  it("picks the best supported language by weight", () => {
    expect(negotiateLocale("pt-BR,pt;q=0.9,es;q=0.8,en;q=0.7")).toBe("es");
    expect(negotiateLocale("de-CH")).toBe("de");
    expect(negotiateLocale("en;q=0.5,ja;q=0.9")).toBe("ja");
    expect(negotiateLocale("zh-CN")).toBe("en");
    expect(negotiateLocale(null)).toBe("en");
  });
});
