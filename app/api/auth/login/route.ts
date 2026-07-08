import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE, validateCredentials } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const validation = await validateCredentials(username, password);

  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: "invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken(username, validation.mustChangePassword);
  const response = NextResponse.json({
    ok: true,
    mustChangePassword: validation.mustChangePassword,
    user: { username }
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
