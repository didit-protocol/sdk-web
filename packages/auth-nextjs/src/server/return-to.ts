// Same rule as @didit-protocol/auth-react's safeReturnTo; this copy keeps the
// proxy free of React imports. The server check is the one that counts.
/** A same-origin path to return to, or `null`: never another site. */
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
