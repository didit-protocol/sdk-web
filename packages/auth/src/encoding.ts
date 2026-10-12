const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict base64url decoding: no padding, no standard-alphabet characters. */
export function fromBase64Url(value: string): Uint8Array {
  if (!BASE64URL.test(value) || value.length % 4 === 1) throw new TypeError("invalid base64url");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function decodeText(value: string): string {
  return new TextDecoder().decode(fromBase64Url(value));
}

export function randomString(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** RFC 7636 S256 code challenge for a PKCE verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  return toBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}
