import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { getFrontendConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const config = getFrontendConfig();
    const upstream = await fetch(`${config.botHttpUrl}/players`, { cache: "no-store" });
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `bot http returned ${upstream.status}` },
        { status: 502 }
      );
    }
    const data = await upstream.json();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error, 502);
  }
}
