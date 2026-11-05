/**
 * Minimal static server for J.A.R.V.I.S. — no dependencies.
 * Binds 0.0.0.0 so it works behind sandbox/proxy previews.
 *
 *   node server.js            → http://localhost:3000
 *   PORT=8080 node server.js
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const DEFAULT_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "microphone=(self), geolocation=(self), camera=()",
};

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname);
  } catch {
    res.writeHead(400, DEFAULT_HEADERS).end("Bad request");
    return;
  }

  if (urlPath.endsWith("/")) urlPath += "index.html";

  // Never serve dotfiles (.git, .env, editor state) or dependency folders.
  if (urlPath.split("/").some((part) => part.startsWith(".") && part !== "." && part !== "..") ||
      urlPath.startsWith("/node_modules/")) {
    res.writeHead(404, DEFAULT_HEADERS).end("Not found");
    return;
  }

  const filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
    res.writeHead(403, DEFAULT_HEADERS).end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(302, { ...DEFAULT_HEADERS, Location: `${urlPath}/` }).end();
      return;
    }
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      ...DEFAULT_HEADERS,
      "Content-Type": type,
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.pipe(res);
    stream.on("error", () => res.destroy());
    stream.on("close", () => {
      const status = res.statusCode;
      console.log(`${req.method} ${urlPath} ${status} ${Date.now() - started}ms`);
    });
  } catch {
    res.writeHead(404, { ...DEFAULT_HEADERS, "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html>
<html><head><meta charset="utf-8"><title>404 — J.A.R.V.I.S.</title>
<style>body{background:#04070d;color:#dbe9f4;font-family:ui-monospace,monospace;display:grid;place-items:center;height:100vh;margin:0;text-align:center}
a{color:#35e0ff}h1{letter-spacing:.3em;font-weight:400;font-size:1.1rem}</style></head>
<body><div><h1>404 // SIGNAL LOST</h1><p>That route isn't in my maps.</p><p><a href="/">Return to the reactor</a></p></div></body></html>`);
    console.log(`${req.method} ${urlPath} 404`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`J.A.R.V.I.S. online → http://${HOST}:${PORT}`);
  console.log(`Serving ${ROOT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal} received — powering down.`);
    server.close(() => process.exit(0));
  });
}
