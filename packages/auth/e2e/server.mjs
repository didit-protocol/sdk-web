// Browser test server for @didit-protocol/auth.
//
// - http://localhost:4174 serves the built package (dist/), the fixture pages
//   and the built @didit-protocol/signals (npm run build builds both).
// - http://127.0.0.1:4175 is an application's origin: it answers the runtime API
//   at its root with the exchanges recorded against the Didit auth service
//   (src/__tests__/fixtures), applying the same CORS rules as that API, so a
//   request the real API would refuse cross-origin fails here too.
//   GET /__replay/load?scenario=a,b loads recordings; GET /__replay/report lists
//   every request and any mismatch.
// - With DIDIT_AUTH_LIVE_UPSTREAM set, port 8766 serves the same pages on any
//   host (an application's host under *.localhost, the service's local zone)
//   and proxies everything else to that auth service with the host unchanged,
//   so the page and the API share one origin, as passkeys require.
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
  "/seeded.mjs": `${PACKAGE}/src/__tests__/helpers/seeded-random.ts`
};
// The fixture pages' import map resolves @didit-protocol/signals here.
const SIGNALS = { "/signals.mjs": `${REPOSITORY}/packages/signals/dist/didit-signals.esm.js` };

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
  if (SIGNALS[pathname]) return send(response, 200, readFileSync(SIGNALS[pathname]), { "Content-Type": TYPES[".mjs"] });
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

const isStatic = (pathname) => !!(TRANSPILED[pathname] || SIGNALS[pathname]) || /^\/(dist|e2e\/fixtures)\//.test(pathname);

function hostedSignIn(url) {
  // The hosted page signs the person in and redirects back with the code. The
  // recording holds that redirect; it is replayed only for the exact sign-in
  // address the SDK opened during the recording.
  for (const { signInUrl, callbackUrl } of pool.flatMap((fixture) => fixture.signIns ?? [fixture])) {
    if (!signInUrl) continue;
    const recorded = new URL(signInUrl).searchParams;
    if (canonical(Object.fromEntries(recorded)) === canonical(Object.fromEntries(url.searchParams))) return callbackUrl;
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
  // Every runtime route ends with a slash; anything else (pages, scripts, the favicon) is static.
  if (isStatic(url.pathname) || !url.pathname.endsWith("/")) return serveStatic(request, response);
  const route = url.pathname.slice(1);
  const headers = cors(request, { "Cache-Control": "no-store" });
  const origin = request.headers.origin;

  if (request.method === "OPTIONS") return send(response, headers["Access-Control-Allow-Origin"] ? 200 : 403, null, headers);
  // As the API: only the canonical auth origin and the application's allowed origins.
  if (origin && origin !== "http://127.0.0.1:4175" && !ALLOWED_ORIGINS.includes(origin)) {
    return send(response, 403, JSON.stringify({ detail: "origin_not_allowed" }), { "Content-Type": "application/json" });
  }
  if (route === "sign-in/") {
    const callback = hostedSignIn(url);
    journal.push({ method: "GET", path: "sign-in/", query: Object.fromEntries(url.searchParams), mismatch: !callback });
    return callback ? send(response, 302, null, { Location: callback }) : send(response, 400, "unknown sign-in");
  }
  const path = route + url.search;
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
    if (isStatic(new URL(request.url, "http://localhost:8766").pathname)) return serveStatic(request, response);
    const target = new URL(request.url, upstream);
    // The service tells applications apart by the host they are served on.
    const outgoing = forward(target, { method: request.method, headers: request.headers }, (answer) => {
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
