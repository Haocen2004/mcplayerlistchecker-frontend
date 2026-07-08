import { createServer } from "node:http";
import { fileURLToPath, parse } from "node:url";
import path from "node:path";
import fs from "node:fs";
import next from "next";
import { handleLiveUpgrade } from "./lib/live-server";
import { getFrontendConfig } from "./lib/config";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== "production";
const config = getFrontendConfig();
const app = next({
  dev,
  dir: appDir,
  customServer: false,
  hostname: "0.0.0.0",
  port: config.port
} as any);
const handle = app.getRequestHandler();
const nextStaticDir = path.join(appDir, ".next", "static");

await app.prepare();

const server = createServer((req, res) => {
  if (req.url?.startsWith("/_next/static/")) {
    serveNextStatic(req.url, res);
    return;
  }

  const parsedUrl = req.url ? parse(req.url, true) : undefined;
  return handle(req, res, parsedUrl);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/api/live")) {
    handleLiveUpgrade(req, socket, head);
    return;
  }

  socket.destroy();
});

server.listen(config.port, () => {
  console.log(`Frontend listening on http://localhost:${config.port}`);
});

function serveNextStatic(url: string, res: import("node:http").ServerResponse) {
  const relativePath = decodeURIComponent(url.replace(/^\/_next\/static\/?/, ""));
  const filePath = path.resolve(nextStaticDir, relativePath);

  if (!filePath.startsWith(nextStaticDir + path.sep)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      const fallbackPath = fallbackStaticPath(filePath);
      if (fallbackPath) {
        res.setHeader("Content-Type", contentType(fallbackPath));
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(fallbackPath).pipe(res);
        return;
      }

      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    res.setHeader("Content-Type", contentType(filePath));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    fs.createReadStream(filePath).pipe(res);
  });
}

function fallbackStaticPath(filePath: string): string | null {
  const ext = path.extname(filePath);
  if (ext !== ".css") return null;

  const cssDir = path.join(nextStaticDir, "css");
  try {
    const candidates = fs.readdirSync(cssDir)
      .filter(file => file.endsWith(".css"))
      .map(file => path.join(cssDir, file))
      .filter(file => fs.statSync(file).isFile())
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

    return candidates[0] || null;
  } catch {
    return null;
  }
}

function contentType(filePath: string) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  if (filePath.endsWith(".woff")) return "font/woff";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
