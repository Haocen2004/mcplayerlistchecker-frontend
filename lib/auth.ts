import { SignJWT, jwtVerify } from "jose";
import { promisify } from "node:util";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { getFrontendConfig } from "./config";
import { getDb } from "./mongo";

export const SESSION_COOKIE = "mc_dashboard_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const AUTH_COLLECTION = "frontend_auth_users";
const ADMIN_ID = "admin";
const scryptAsync = promisify(scrypt);

export interface SessionPayload {
  sub: string;
  role: "admin";
  mustChangePassword: boolean;
}

interface AuthUserRecord {
  _id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function createSessionToken(username: string, mustChangePassword = false): Promise<string> {
  return new SignJWT({ role: "admin", mustChangePassword })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== "string" || payload.role !== "admin") return null;
    return {
      sub: payload.sub,
      role: "admin",
      mustChangePassword: payload.mustChangePassword === true
    };
  } catch {
    return null;
  }
}

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function getSessionFromRequest(req: IncomingMessage): Promise<SessionPayload | null> {
  return verifySessionToken(readCookie(req.headers.cookie || "", SESSION_COOKIE));
}

export async function validateCredentials(username: string, password: string): Promise<{ ok: boolean; mustChangePassword: boolean }> {
  const config = getFrontendConfig();
  if (!safeEqual(username, config.authUser)) return { ok: false, mustChangePassword: false };

  const user = await getStoredUser();
  if (!user) {
    return {
      ok: safeEqual(password, config.authPassword),
      mustChangePassword: true
    };
  }

  return {
    ok: await verifyPassword(password, user.passwordSalt, user.passwordHash),
    mustChangePassword: false
  };
}

export async function changePassword(username: string, currentPassword: string, newPassword: string) {
  const validation = await validateCredentials(username, currentPassword);
  if (!validation.ok) {
    return { ok: false, error: "current password is incorrect" };
  }

  const trimmed = newPassword.trim();
  if (trimmed.length < 6) {
    return { ok: false, error: "new password must be at least 6 characters" };
  }

  if (safeEqual(trimmed, currentPassword)) {
    return { ok: false, error: "new password must be different" };
  }

  const { salt, hash } = await hashPassword(trimmed);
  const db = await getDb();
  const now = new Date();
  await db.collection<AuthUserRecord>(AUTH_COLLECTION).updateOne(
    { _id: ADMIN_ID },
    {
      $set: {
        username,
        passwordHash: hash,
        passwordSalt: salt,
        updatedAt: now
      },
      $setOnInsert: {
        _id: ADMIN_ID,
        createdAt: now
      }
    },
    { upsert: true }
  );

  return { ok: true };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.FRONTEND_COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  };
}

export function readCookie(header: string, name: string): string | undefined {
  const parts = header.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

function getSecret(): Uint8Array {
  return new TextEncoder().encode(getFrontendConfig().jwtSecret);
}

async function getStoredUser(): Promise<AuthUserRecord | null> {
  const db = await getDb();
  return db.collection<AuthUserRecord>(AUTH_COLLECTION).findOne({ _id: ADMIN_ID });
}

async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return { salt, hash: derived.toString("hex") };
}

async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const expected = Buffer.from(hash, "hex");
  const actual = await scryptAsync(password, salt, expected.length) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
