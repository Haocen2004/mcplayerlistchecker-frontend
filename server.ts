import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import next from "next";
import { handleLiveUpgrade } from "./lib/live-server";
import { getFrontendConfig } from "./lib/config";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, dir: appDir });
const handle = app.getRequestHandler();
const config = getFrontendConfig();

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res);
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
