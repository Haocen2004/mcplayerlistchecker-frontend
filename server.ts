import { createServer } from "node:http";
import { fileURLToPath, parse } from "node:url";
import path from "node:path";
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

await app.prepare();

const server = createServer((req, res) => {
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
