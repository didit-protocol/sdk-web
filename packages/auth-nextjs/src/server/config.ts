export class DiditAuthConfigError extends Error {
  constructor(message: string) {
    super(`[didit-auth] ${message}`);
    this.name = "DiditAuthConfigError";
  }
}

export interface DiditAuthConfig {
  /** Frontend API base URL, without a trailing slash. */
  frontendApi: string;
  /** The callback address registered for your application. */
  redirectUri: string;
  /** Path of the callback route, taken from `redirectUri`. */
  callbackPath: string;
  /** Where the SDK's own routes live. */
  basePath: string;
  /** `true` when the app is served over HTTPS: cookies are then `Secure` and `__Host-` prefixed. */
  secure: boolean;
  /** How long a validated session is reused before asking Didit again. */
  sessionCacheMs: number;
}

export type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(name: string, value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new DiditAuthConfigError(`${name} is not a valid URL.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new DiditAuthConfigError(`${name} must use https (http is accepted only for localhost).`);
  }
  return url;
}

/**
 * Reads the configuration from the environment: `DIDIT_FRONTEND_API` (the
 * Frontend API shown in Authentication > Developers) and `DIDIT_REDIRECT_URI`
 * (your callback address, for example `http://localhost:3000/auth/callback`).
 */
export function resolveConfig(env: Env = process.env): DiditAuthConfig {
  const frontendApi = env.DIDIT_FRONTEND_API?.trim();
  const redirectUri = env.DIDIT_REDIRECT_URI?.trim();

  if (!frontendApi) {
    throw new DiditAuthConfigError(
      "Set DIDIT_FRONTEND_API to the Frontend API in Authentication > Developers. " +
        "It is not derived from DIDIT_PUBLISHABLE_KEY yet."
    );
  }
  if (!redirectUri) {
    throw new DiditAuthConfigError("Set DIDIT_REDIRECT_URI to your callback address, for example https://example.com/auth/callback.");
  }
  const api = parseUrl("DIDIT_FRONTEND_API", frontendApi);
  const callback = parseUrl("DIDIT_REDIRECT_URI", redirectUri);
  const cacheSeconds = Number(env.DIDIT_SESSION_CACHE_SECONDS ?? 30);

  return {
    frontendApi: `${api.origin}${api.pathname}`.replace(/\/+$/, ""),
    redirectUri: callback.href,
    callbackPath: callback.pathname,
    basePath: "/auth",
    secure: callback.protocol === "https:",
    sessionCacheMs: Number.isFinite(cacheSeconds) && cacheSeconds >= 0 ? Math.min(cacheSeconds, 300) * 1000 : 30_000
  };
}
