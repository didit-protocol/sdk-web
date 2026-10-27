/** Where the SDK's routes live: sign-in, callback helpers, session, token, agents. */
export const BASE_PATH = "/auth";
/** Request header carrying the requested path to server components, for `auth.protect()`. */
export const PATH_HEADER = "x-didit-auth-path";
/** Header the browser client sends on its calls; another site cannot send it without CORS. */
export const CLIENT_HEADER = "x-didit-auth";
