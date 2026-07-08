import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { getDataBounds } from "@/lib/history";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const url = new URL(request.url);
    const server = url.searchParams.get("server");
    const data = await getDataBounds(server);
    return NextResponse.json({ ok: true, server, data });
  } catch (error) {
    return errorResponse(error);
  }
}
