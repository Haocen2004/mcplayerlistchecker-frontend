import { NextResponse } from "next/server";
import {
  changePassword,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE
} from "@/lib/auth";
import { requireSession } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { session, response } = await requireSession({ allowPasswordChange: true });
  if (response) return response;

  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  const result = await changePassword(session.sub, currentPassword, newPassword);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const token = await createSessionToken(session.sub, false);
  const next = NextResponse.json({ ok: true, mustChangePassword: false });
  next.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return next;
}
