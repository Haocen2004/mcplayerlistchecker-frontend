import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "mc_dashboard_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";
  const isSetupPassword = pathname === "/setup-password";
  const isLoginApi = pathname === "/api/auth/login";
  const isAllowedPasswordApi =
    pathname === "/api/auth/me" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/change-password";
  const isStatic =
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt";

  if (isStatic || isLoginApi) return NextResponse.next();

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const hasSession = Boolean(sessionCookie);
  const mustChangePassword = getMustChangePassword(sessionCookie);

  if (!hasSession && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && mustChangePassword && !isSetupPassword && !isAllowedPasswordApi) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "password_change_required" },
        { status: 403 }
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/setup-password";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (hasSession && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = mustChangePassword ? "/setup-password" : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"]
};

function getMustChangePassword(token: string | undefined): boolean {
  if (!token) return false;
  const payload = token.split(".")[1];
  if (!payload) return false;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return JSON.parse(json).mustChangePassword === true;
  } catch {
    return false;
  }
}
