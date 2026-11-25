/** Base64url without padding: the form a stored id and a hash are written in. */
function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function toBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }
  return input;
}

async function sha256Bytes(input: string | Uint8Array): Promise<Uint8Array> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("WebCrypto SubtleCrypto is not available");
  }
  const bytes = toBytes(input);
  // crypto.subtle.digest needs a BufferSource; copy into a fresh ArrayBuffer-backed view
  // so we are not handing over a SharedArrayBuffer-typed slice. The view itself is passed, not
  // its buffer: a bare ArrayBuffer made in another realm (a test runner's sandbox on Node 20) is
  // refused as "not an ArrayBuffer", and the hash would be left out; a view is accepted everywhere.
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return new Uint8Array(digest);
}

// SHA-256 truncated to the leading 128 bits, base64url-encoded (22 chars).
// Used as the composite fingerprint hash. 128 bits keeps the birthday boundary
// at 2^64 — collision-safe at any conceivable session volume.
async function sha256_128(input: string | Uint8Array): Promise<string> {
  const bytes = await sha256Bytes(input);
  return bytesToBase64Url(bytes.slice(0, 16));
}

function randomBytes(length: number): Uint8Array {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buffer = new Uint8Array(length);
    crypto.getRandomValues(buffer);
    return buffer;
  }
  // Math.random fallback — only reached in environments without WebCrypto.
  const fallback = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    fallback[i] = Math.floor(Math.random() * 256);
  }
  return fallback;
}

function randomBase64Url(byteLength: number): string {
  return bytesToBase64Url(randomBytes(byteLength));
}

export { bytesToBase64Url, randomBase64Url, sha256_128, sha256Bytes };
