import fs from "node:fs";
import path from "node:path";

interface RootConfig {
  apiPort?: number;
  mongoUri?: string;
  mongoDb?: string;
}

export interface FrontendConfig {
  port: number;
  mongoUri: string;
  mongoDb: string;
  botHttpUrl: string;
  botWsUrl: string;
  authUser: string;
  authPassword: string;
  jwtSecret: string;
}

let cachedConfig: FrontendConfig | null = null;

export function getFrontendConfig(): FrontendConfig {
  if (cachedConfig) return cachedConfig;

  const rootConfig = readRootConfig();
  const apiPort = Number(rootConfig.apiPort || 3000);
  const botHttpUrl = process.env.BOT_HTTP_URL || `http://localhost:${apiPort}`;
  const botWsUrl = process.env.BOT_WS_URL || botHttpUrl.replace(/^http/i, "ws");

  cachedConfig = {
    port: numberFromEnv("PORT", 3001),
    mongoUri: process.env.MONGO_URI || rootConfig.mongoUri || "mongodb://localhost:27017",
    mongoDb: process.env.MONGO_DB || rootConfig.mongoDb || "mc_checker",
    botHttpUrl,
    botWsUrl,
    authUser: process.env.FRONTEND_AUTH_USER || "admin",
    authPassword: process.env.FRONTEND_AUTH_PASSWORD || "admin",
    jwtSecret: process.env.FRONTEND_JWT_SECRET || "change-this-secret-before-exposing-the-dashboard"
  };

  if (!process.env.FRONTEND_AUTH_PASSWORD) {
    console.warn("[Auth] FRONTEND_AUTH_PASSWORD is not set; using default password 'admin'.");
  }

  return cachedConfig;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readRootConfig(): RootConfig {
  const candidates = [
    path.resolve(process.cwd(), "config.json"),
    path.resolve(process.cwd(), "..", "config.json")
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      return JSON.parse(fs.readFileSync(file, "utf8")) as RootConfig;
    } catch (error) {
      console.warn(`[Config] Failed to read ${file}: ${(error as Error).message}`);
    }
  }

  return {};
}
