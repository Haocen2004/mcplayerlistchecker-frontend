import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import { getSessionFromRequest } from "./auth";
import { getFrontendConfig } from "./config";

const wss = new WebSocketServer({ noServer: true });

export async function handleLiveUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const session = await getSessionFromRequest(req);
  if (!session || session.mustChangePassword) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, client => {
    attachBotProxy(client);
  });
}

function attachBotProxy(client: WebSocket) {
  const config = getFrontendConfig();
  let upstream: WebSocket | null = new WebSocket(config.botWsUrl);

  const sendClient = (payload: unknown) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    }
  };

  upstream.on("open", () => {
    sendClient({ type: "liveConnection", ok: true });
    upstream?.send(JSON.stringify({ path: "/players" }));
  });

  upstream.on("message", data => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });

  upstream.on("error", error => {
    sendClient({ type: "liveConnection", ok: false, error: (error as Error).message });
  });

  upstream.on("close", () => {
    sendClient({ type: "liveConnection", ok: false, error: "bot websocket disconnected" });
  });

  client.on("message", data => {
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(data.toString() || JSON.stringify({ path: "/players" }));
    }
  });

  client.on("close", () => {
    upstream?.close();
    upstream = null;
  });
}
