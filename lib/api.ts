import { NextResponse } from "next/server";
import { getSessionFromCookies } from "./auth";

export async function requireSession(options: { allowPasswordChange?: boolean } = {}) {
  const session = await getSessionFromCookies();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    };
  }

  if (session.mustChangePassword && !options.allowPasswordChange) {
    return {
      session,
      response: NextResponse.json(
        { ok: false, error: "password_change_required" },
        { status: 403 }
      )
    };
  }

  return { session, response: null };
}

export function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : "unexpected error" },
    { status }
  );
}
