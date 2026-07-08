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

  installNoStoreHeader(res);
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

function installNoStoreHeader(res: import("node:http").ServerResponse) {
  const cacheControl = "no-store, max-age=0";
  const writeHead = res.writeHead.bind(res);

  res.setHeader("Cache-Control", cacheControl);
  res.writeHead = ((statusCode: number, statusMessageOrHeaders?: any, headers?: any) => {
    if (typeof statusMessageOrHeaders === "string") {
      return writeHead(statusCode, statusMessageOrHeaders, {
        ...headers,
        "Cache-Control": cacheControl
      });
    }

    return writeHead(statusCode, {
      ...statusMessageOrHeaders,
      "Cache-Control": cacheControl
    });
  }) as typeof res.writeHead;
}

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
      if (serveStaticFallback(filePath, res)) {
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

function serveStaticFallback(filePath: string, res: import("node:http").ServerResponse): boolean {
  const ext = path.extname(filePath);
  if (ext === ".js") {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.end(reloadScript());
    return true;
  }

  if (ext !== ".css") return false;

  const cssDir = path.join(nextStaticDir, "css");
  try {
    const candidates = fs.readdirSync(cssDir)
      .filter(file => file.endsWith(".css"))
      .map(file => path.join(cssDir, file))
      .filter(file => fs.statSync(file).isFile())
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

    if (!candidates[0]) return false;

    res.setHeader("Content-Type", contentType(candidates[0]));
    res.setHeader("Cache-Control", "no-cache");
    fs.createReadStream(candidates[0]).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function reloadScript() {
  return `
(function () {
  try {
    var key = "mc-dashboard-static-reload";
    var now = Date.now();
    var last = Number(sessionStorage.getItem(key) || "0");
    if (now - last < 5000) return;
    sessionStorage.setItem(key, String(now));
    var url = new URL(window.location.href);
    url.searchParams.set("_reload", String(now));
    window.location.replace(url.toString());
  } catch (error) {
    window.location.reload();
  }
})();
`;
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
