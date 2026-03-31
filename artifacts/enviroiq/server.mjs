/**
 * EnviroIQ production frontend server.
 *
 * Replaces Replit's static file serving so we can inject security headers,
 * gzip compression, and SPA fallback routing — all with zero dependencies
 * (pure Node.js stdlib only).
 */
import http from "http";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist/public");
const PORT = parseInt(process.env.PORT || "22592", 10);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".txt":  "text/plain; charset=utf-8",
};

// Static asset extensions that can be cached for 1 year (Vite adds content hashes)
const IMMUTABLE_EXTS = new Set([".js", ".mjs", ".css", ".woff", ".woff2", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://4layers.net",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = {
  "X-Content-Type-Options":  "nosniff",
  "X-Frame-Options":         "DENY",
  "X-XSS-Protection":        "1; mode=block",
  "Referrer-Policy":         "strict-origin-when-cross-origin",
  "Permissions-Policy":      "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": CSP,
};

function sendFile(req, res, filePath, mime, cacheControl) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const acceptsGzip = /gzip/.test(req.headers["accept-encoding"] || "");
    const compressible = !mime.startsWith("image/");

    const base = {
      ...SECURITY_HEADERS,
      "Content-Type": mime,
      "Cache-Control": cacheControl,
    };

    if (acceptsGzip && compressible) {
      zlib.gzip(buf, { level: 6 }, (zerr, compressed) => {
        if (zerr) {
          base["Content-Length"] = String(buf.length);
          res.writeHead(200, base);
          res.end(buf);
          return;
        }
        base["Content-Encoding"] = "gzip";
        base["Vary"] = "Accept-Encoding";
        base["Content-Length"] = String(compressed.length);
        res.writeHead(200, base);
        res.end(compressed);
      });
    } else {
      base["Content-Length"] = String(buf.length);
      res.writeHead(200, base);
      res.end(buf);
    }
  });
}

http.createServer((req, res) => {
  let urlPath = new URL(req.url, "http://localhost").pathname;
  if (urlPath === "/") urlPath = "/index.html";

  // Prevent path traversal
  const filePath = path.resolve(DIST, "." + urlPath);
  if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const cacheControl = IMMUTABLE_EXTS.has(ext)
    ? "public, max-age=31536000, immutable"
    : "no-cache, no-store, must-revalidate";

  fs.access(filePath, fs.constants.R_OK, (err) => {
    if (err) {
      // SPA fallback: return index.html for any unknown path
      sendFile(req, res, path.join(DIST, "index.html"), "text/html; charset=utf-8", "no-cache, no-store, must-revalidate");
    } else {
      sendFile(req, res, filePath, mime, cacheControl);
    }
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`EnviroIQ frontend listening on port ${PORT}`);
});
