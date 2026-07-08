import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { getEvents, normalizeTimeWindow } from "@/lib/history";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const url = new URL(request.url);
    const window = normalizeTimeWindow(url.searchParams);
    const server = url.searchParams.get("server");
    const data = await getEvents({ window, server });
    return NextResponse.json({
      ok: true,
      range: window.range,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      server,
      data
    });
  } catch (error) {
    return errorResponse(error);
  }
}
