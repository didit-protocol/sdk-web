import { fromBase64Url, toBase64Url } from "./encoding";
import { DiditAuthError } from "./errors";

/** WebAuthn options as the Didit API serializes them (binary fields in base64url). */
export interface PasskeyOptionsJSON {
  challenge: string;
  rpId?: string;
  rp?: { id?: string; name: string };
  user?: { id: string; name: string; displayName: string };
  allowCredentials?: { id: string; type: string; transports?: string[] }[];
  excludeCredentials?: { id: string; type: string; transports?: string[] }[];
  [key: string]: unknown;
}

function descriptors(list: PasskeyOptionsJSON["allowCredentials"]): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((item) => ({ ...item, id: fromBase64Url(item.id), type: "public-key" }) as PublicKeyCredentialDescriptor);
}

export function requestOptions(json: PasskeyOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    ...json,
    challenge: fromBase64Url(json.challenge),
    allowCredentials: descriptors(json.allowCredentials)
  } as unknown as PublicKeyCredentialRequestOptions;
}

export function creationOptions(json: PasskeyOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    ...json,
    challenge: fromBase64Url(json.challenge),
    user: { ...json.user, id: fromBase64Url(json.user?.id ?? "") },
    excludeCredentials: descriptors(json.excludeCredentials)
  } as unknown as PublicKeyCredentialCreationOptions;
}

/** The registration or authentication response JSON the API verifies. */
export function credentialJSON(credential: PublicKeyCredential): Record<string, unknown> {
  const raw = credential.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Record<string, unknown> = { clientDataJSON: toBase64Url(raw.clientDataJSON) };

  if (raw.attestationObject) {
    response.attestationObject = toBase64Url(raw.attestationObject);
    if (typeof raw.getTransports === "function") response.transports = raw.getTransports();
  } else {
    response.authenticatorData = toBase64Url(raw.authenticatorData);
    response.signature = toBase64Url(raw.signature);
    if (raw.userHandle) response.userHandle = toBase64Url(raw.userHandle);
  }
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    ...(credential.authenticatorAttachment ? { authenticatorAttachment: credential.authenticatorAttachment } : {})
  };
}

/**
 * Passkeys are bound to the Didit auth domain: the browser only runs the
 * ceremony on that host or its subdomains, so other origins use the hosted page.
 */
export function assertPasskeysAvailable(rpId?: string): void {
  const host = typeof location === "undefined" ? "" : location.hostname;
  const supported = typeof navigator !== "undefined" && !!navigator.credentials && typeof PublicKeyCredential !== "undefined";

  if (!supported || !rpId || (host !== rpId && !host.endsWith(`.${rpId}`))) {
    throw new DiditAuthError(
      "passkey_unavailable",
      "Passkeys need the Didit sign-in domain; use signIn() to open the hosted page instead."
    );
  }
}

export async function runCeremony(run: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
  let credential: Credential | null;
  try {
    credential = await run();
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const code =
      name === "NotAllowedError" || name === "AbortError"
        ? "passkey_cancelled"
        : name === "InvalidStateError"
          ? "credential_exists"
          : "passkey_unavailable";
    throw new DiditAuthError(code, error instanceof Error ? error.message : undefined);
  }
  if (!credential) throw new DiditAuthError("passkey_cancelled");
  return credential as PublicKeyCredential;
}
