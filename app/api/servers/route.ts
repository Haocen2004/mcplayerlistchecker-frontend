import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { getServers } from "@/lib/history";

export const runtime = "nodejs";

export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const data = await getServers();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
