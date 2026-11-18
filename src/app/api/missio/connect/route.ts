import { NextResponse } from "next/server";
import { connectClientIp, readCappedBody, submitConnectCard } from "@/lib/missio/connect";

// POST /api/missio/connect
//
// Public. No session. Service-role insert, source qr, campus potch, org missio.
// Success is exactly { ok: true }. Honeypot, duplicate phone, and a failed
// match all still return that. Nothing here creates org_people.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const read = await readCappedBody(request);
  if (!read.ok) return NextResponse.json(read.body, { status: read.status });

  const result = await submitConnectCard({ body: read.value, ip: connectClientIp(request) });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status, headers: result.headers });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
