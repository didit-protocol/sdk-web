import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const HOST = "127.0.0.1";
const PORT = 4173;
const ROOT = process.cwd();
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

async function serve(request, response) {
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
