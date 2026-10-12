// Browser test server for @didit-protocol/auth.
//
// - http://localhost:4174 serves the built package (dist/), the fixture pages
//   and @didit-protocol/signals (until that package lands, the fingerprint
//   source it is built from, transpiled on request).
// - http://127.0.0.1:4175 answers the runtime API with the exchanges recorded
//   against the Didit auth service (src/__tests__/fixtures), applying the same
//   CORS rules as that API, so a request the real API would
//   refuse cross-origin fails here too. GET /__replay/load?scenario=a,b loads
//   recordings; GET /__replay/report lists every request and any mismatch.
// - With DIDIT_AUTH_LIVE_UPSTREAM set, http://localhost:8766 serves the same
//   pages and proxies everything else to that auth service, so the page and the
//   API share one origin, as hosted pages and passkeys require.
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as forward } from "node:http";
import { createRequire } from "node:module";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPOSITORY = resolve(PACKAGE, "../..");
const APP_ORIGIN = "http://localhost:4174";
const ALLOWED_ORIGINS = [APP_ORIGIN];
const ts = createRequire(`${REPOSITORY}/package.json`)("typescript");
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".map": "application/json" };
const TRANSPILED = {
  "/signals.mjs": `${REPOSITORY}/src/fingerprint.ts`,
  "/seeded.mjs": `${PACKAGE}/src/__tests__/helpers/seeded-random.ts`
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "Cache-Control": "no-store", ...headers });
  response.end(body);
}

async function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, APP_ORIGIN).pathname);
  if (TRANSPILED[pathname]) {
    const { outputText } = ts.transpileModule(readFileSync(TRANSPILED[pathname], "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
    });
    return send(response, 200, outputText, { "Content-Type": TYPES[".mjs"] });
  }
  const file = resolve(PACKAGE, `.${pathname}`);
  if (!file.startsWith(`${PACKAGE}${sep}`) || !/^\/(dist|e2e\/fixtures)\//.test(pathname)) return send(response, 404, "Not found");
  try {
    if (!(await stat(file)).isFile()) return send(response, 404, "Not found");
  } catch {
    return send(response, 404, "Not found");
  }
  response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(file).pipe(response);
}

// ---- replayed runtime API ----

let pool = [];
let journal = [];

function canonical(value) {
  return JSON.stringify(value, (_, member) =>
    member && typeof member === "object" && !Array.isArray(member)
      ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => (a < b ? -1 : 1)))
      : member
  );
}

function load(scenarios) {
  pool = scenarios.map((name) => JSON.parse(readFileSync(`${PACKAGE}/src/__tests__/fixtures/${name}.json`, "utf8")));
  journal = [];
}

function cors(request, headers) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    Object.assign(headers, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      Vary: "Origin"
    });
  }
  return headers;
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : undefined;
}

function hostedSignIn(url) {
  // The hosted page signs the person in and redirects back with the code. The
  // recording holds that redirect; it is replayed only for the exact sign-in
  // address the SDK opened during the recording.
  for (const fixture of pool) {
    if (!fixture.signInUrl) continue;
    const recorded = new URL(fixture.signInUrl).searchParams;
    if (canonical(Object.fromEntries(recorded)) === canonical(Object.fromEntries(url.searchParams))) return fixture.callbackUrl;
  }
  return null;
}

async function replay(request, response) {
  const url = new URL(request.url, "http://127.0.0.1:4175");
  if (url.pathname === "/__replay/load") {
    load((url.searchParams.get("scenario") ?? "").split(",").filter(Boolean));
    return send(response, 204, null);
  }
  if (url.pathname === "/__replay/report") {
    return send(response, 200, JSON.stringify(journal), { "Content-Type": "application/json" });
  }
  const match = /^\/auth\/v2\/authentication\/[0-9a-f-]{36}\/(.*)$/.exec(url.pathname);
  if (!match) return serveStatic(request, response);
  const headers = cors(request, { "Cache-Control": "no-store" });
  const origin = request.headers.origin;

  if (request.method === "OPTIONS") return send(response, headers["Access-Control-Allow-Origin"] ? 200 : 403, null, headers);
  // As the API: only the canonical auth origin and the application's allowed origins.
  if (origin && origin !== "http://127.0.0.1:4175" && !ALLOWED_ORIGINS.includes(origin)) {
    return send(response, 403, JSON.stringify({ detail: "origin_not_allowed" }), { "Content-Type": "application/json" });
  }
  if (match[1] === "sign-in/") {
    const callback = hostedSignIn(url);
    journal.push({ method: "GET", path: "sign-in/", query: Object.fromEntries(url.searchParams), mismatch: !callback });
    return callback ? send(response, 302, null, { Location: callback }) : send(response, 400, "unknown sign-in");
  }
  const path = match[1] + url.search;
  const body = await readBody(request);
  const sent = canonical({ method: request.method, path, authorization: request.headers.authorization, body });
  const entry = { method: request.method, path, headers: { ...request.headers }, body };
  journal.push(entry);

  for (const exchange of pool.flatMap((fixture) => fixture.exchanges)) {
    const { request: recorded, response: answer } = exchange;
    const same = canonical({ method: recorded.method, path: recorded.path, authorization: recorded.authorization, body: recorded.body }) === sent;
    // Each recorded request is answered once, except reads: the same GET gets the same answer.
    if (!same || (exchange.used && recorded.method !== "GET")) continue;
    exchange.used = true;
    return send(response, answer.status, answer.body === null ? null : JSON.stringify(answer.body), {
      ...headers,
      ...(answer.body === null ? {} : { "Content-Type": "application/json" }),
      ...(answer.headers ?? {})
    });
  }
  entry.mismatch = true;
  return send(response, 409, JSON.stringify({ error: "not_recorded" }), { ...headers, "Content-Type": "application/json" });
}

// ---- same-origin proxy to a live auth service ----

function proxy(upstream) {
  return (request, response) => {
    const pathname = new URL(request.url, "http://localhost:8766").pathname;
    if (TRANSPILED[pathname] || /^\/(dist|e2e\/fixtures)\//.test(pathname)) return serveStatic(request, response);
    const target = new URL(request.url, upstream);
    const outgoing = forward(target, { method: request.method, headers: { ...request.headers, host: "localhost:8766" } }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    });
    outgoing.on("error", () => send(response, 502, "upstream unavailable"));
    request.pipe(outgoing);
  };
}

// "localhost" resolves to 127.0.0.1 or ::1 depending on the browser: answer on both.
function listenLocal(handler, port) {
  createServer(handler).listen(port, "127.0.0.1");
  createServer(handler)
    .on("error", () => {})
    .listen(port, "::1");
}

listenLocal(serveStatic, 4174);
createServer(replay).listen(4175, "127.0.0.1");
if (process.env.DIDIT_AUTH_LIVE_UPSTREAM) listenLocal(proxy(process.env.DIDIT_AUTH_LIVE_UPSTREAM), 8766);
console.log("Auth test server: pages on http://localhost:4174, recorded API on http://127.0.0.1:4175");
