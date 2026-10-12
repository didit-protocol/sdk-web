import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const HOST = "127.0.0.1";
const PORT = 4173;
const ROOT = process.cwd();
const RECORDINGS = JSON.parse(
  await readFile(resolve(ROOT, "packages/signals/src/__tests__/fixtures/device-lane-recordings.json"), "utf8")
).scenarios;
// Requests each test lane received, so parallel browsers never read each other's.
const received = new Map();
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8"
};

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${HOST}:${PORT}`).pathname);
  const filePath = resolve(ROOT, `.${pathname}`);

  return filePath.startsWith(`${ROOT}${sep}`) ? filePath : null;
}

function sendError(response, statusCode) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(statusCode === 404 ? "Not found" : "Forbidden");
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The device lane, POST /e2e/lane/<test id>/v1/events/batch/: answers with the
 * real recorded answer for exactly this token and these events, or 501 so a
 * test can never pass on an answer that was not recorded for its request.
 * With EVENTS_UPSTREAM set, /e2e/live/v1/events/batch/ forwards to that Didit
 * verification API instead (same origin for the browser, so no CORS).
 */
async function serveEventLane(request, response, pathname) {
  const lane = /^\/e2e\/lane\/([\w-]+)\/v1\/events\/batch\/$/.exec(pathname);
  const receivedMatch = /^\/e2e\/lane\/([\w-]+)\/received$/.exec(pathname);
  if (receivedMatch && request.method === "GET") {
    sendJson(response, 200, received.get(receivedMatch[1]) ?? []);
    return true;
  }
  if (pathname === "/e2e/live/v1/events/batch/" && request.method === "POST" && process.env.EVENTS_UPSTREAM) {
    const upstream = await fetch(`${process.env.EVENTS_UPSTREAM.replace(/\/+$/, "")}/v1/events/batch/`, {
      method: "POST",
      headers: Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => /^(content-type|user-agent|x-monitoring-token|x-didit-)/.test(name))
      ),
      body: await readBody(request)
    });
    response.writeHead(upstream.status, { "Content-Type": "application/json" });
    response.end(await upstream.text());
    return true;
  }
  if (!lane || request.method !== "POST") return false;

  const body = JSON.parse(await readBody(request));
  const token = request.headers["x-monitoring-token"];
  const requests = received.get(lane[1]) ?? [];
  requests.push({ headers: request.headers, body });
  received.set(lane[1], requests);

  const recording = Object.values(RECORDINGS).find(
    (scenario) =>
      scenario.token === token &&
      JSON.stringify(scenario.request.events) === JSON.stringify(body.events)
  );
  if (recording) {
    sendJson(response, recording.response.status, recording.response.body);
  } else {
    sendJson(response, 501, { detail: "No recording matches the request." });
  }
  return true;
}

async function serve(request, response) {
  const { pathname } = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (pathname.startsWith("/e2e/lane/") || pathname.startsWith("/e2e/live/")) {
    try {
      if (await serveEventLane(request, response, pathname)) return;
    } catch (error) {
      sendJson(response, 500, { detail: "Event fixture request failed." });
      return;
    }
  }

  const filePath = resolveRequestPath(request.url ?? "/");

  if (!filePath) return sendError(response, 403);
  try {
    const file = await stat(filePath);

    if (!file.isFile()) return sendError(response, 404);
    response.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    sendError(response, 404);
  }
}

createServer(serve).listen(PORT, HOST, () => {
  console.log(`Fixture server listening on http://${HOST}:${PORT}`);
});
