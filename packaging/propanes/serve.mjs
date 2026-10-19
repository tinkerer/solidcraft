#!/usr/bin/env node
// Serves the built web app (dist/web) and mounts a ProPanes feedback server
// same-origin under /propanes/, so the widget embedded in index.html loads
// without a cross-origin (or login-gated) hop. No dependencies: node >= 18.
//
//   node packaging/propanes/serve.mjs            # http://127.0.0.1:3088/
//   PORT=8080 SITE=dist/web PROPANES_UPSTREAM=http://127.0.0.1:3001 node packaging/propanes/serve.mjs
//
// Caching mirrors packaging/docker/nginx.conf: Trunk's hashed files are
// immutable for a year; everything else (index.html, sw.js, build.json) is
// revalidated so browsers pick up a new build.
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const PORT = Number(process.env.PORT || 3088);
const HOST = process.env.HOST || "0.0.0.0";
const SITE = resolve(process.env.SITE || join(import.meta.dirname, "../../dist/web"));
const UPSTREAM = new URL(process.env.PROPANES_UPSTREAM || "http://127.0.0.1:3001");
const PREFIX = "/propanes";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};
const HASHED = /-[0-9a-f]{8,16}(_bg)?\.(js|wasm|css)$/;

function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(SITE, path));
  if (!file.startsWith(SITE + sep) && file !== SITE) {
    res.writeHead(403).end();
    return;
  }
  let st;
  try {
    st = statSync(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  if (st.isDirectory()) {
    res.writeHead(301, { location: path + "/" }).end();
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] || "application/octet-stream",
    "content-length": st.size,
    "cache-control": HASHED.test(file) ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

function upstreamHeaders(req) {
  const h = { ...req.headers, host: UPSTREAM.host };
  h["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers.host || "";
  h["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "http";
  h["x-forwarded-for"] = [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", ");
  return h;
}

function stripPrefix(url) {
  const rest = url.slice(PREFIX.length);
  return rest.startsWith("/") || rest === "" ? rest || "/" : null;
}

function proxy(req, res) {
  const path = stripPrefix(req.url);
  if (path === null) return serveStatic(req, res);
  const up = http.request(
    { host: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path, headers: upstreamHeaders(req) },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  up.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`propanes upstream unavailable: ${e.message}`);
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  if (req.url === PREFIX || req.url.startsWith(PREFIX + "/") || req.url.startsWith(PREFIX + "?")) return proxy(req, res);
  serveStatic(req, res);
});

// WebSockets (widget live session, terminals) ride the same prefix.
server.on("upgrade", (req, socket, head) => {
  const path = req.url.startsWith(PREFIX) ? stripPrefix(req.url) : null;
  if (path === null) return socket.destroy();
  const up = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path, headers: upstreamHeaders(req) });
  up.on("upgrade", (r, upSocket, upHead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (const [k, v] of Object.entries(r.headers)) lines.push(`${k}: ${v}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (upHead.length) socket.write(upHead);
    if (head.length) upSocket.write(head);
    upSocket.pipe(socket).pipe(upSocket);
    const close = () => { socket.destroy(); upSocket.destroy(); };
    socket.on("error", close);
    upSocket.on("error", close);
  });
  up.on("response", (r) => {
    socket.write(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\nconnection: close\r\n\r\n`);
    socket.destroy();
  });
  up.on("error", () => socket.destroy());
  up.end();
});

server.listen(PORT, HOST, () => {
  console.log(`solidcraft web: http://${HOST}:${PORT}/ (site ${SITE}; ${PREFIX}/ -> ${UPSTREAM.origin})`);
});
