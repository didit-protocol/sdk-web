/**
 * A same-origin path to return to, or `null`. Absolute URLs, protocol-relative
 * `//host` and backslash tricks are refused so a link can never send someone
 * to another site after signing in.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;

  try {
    const base = "https://return-to.invalid";
    const url = new URL(value, base);

    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** The `redirect_url` of the current page, when it is a safe path. */
export function returnToFromLocation(): string | null {
  if (typeof window === "undefined") return null;

  return safeReturnTo(new URLSearchParams(window.location.search).get("redirect_url"));
}
