import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { getHistory, normalizeBucket, normalizeTimeWindow } from "@/lib/history";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const url = new URL(request.url);
    const window = normalizeTimeWindow(url.searchParams);
    const bucket = normalizeBucket(url.searchParams.get("bucket"), window);
    const server = url.searchParams.get("server");
    const data = await getHistory({ window, bucket, server });
    return NextResponse.json({
      ok: true,
      range: window.range,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      bucket,
      server,
      data
    });
  } catch (error) {
    return errorResponse(error);
  }
}
