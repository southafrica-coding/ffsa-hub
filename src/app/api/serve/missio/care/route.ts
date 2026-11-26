import { NextResponse } from "next/server";
import { connectClientIp, readCappedBody } from "@/lib/missio/connect";
import { submitCareForm } from "@/lib/missio/care";

// POST /api/serve/missio/care
//
// Public, no session: the care link (connect card thanks, website, QR on the
// seats). Rate-limited per IP; service-role insert; only an HMAC of the IP
// is kept. Success is { ok: true, first }.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const read = await readCappedBody(request);
  if (!read.ok) return NextResponse.json(read.body, { status: read.status });
  const result = await submitCareForm(read.value, connectClientIp(request));
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status, headers: result.headers });
  }
  return NextResponse.json({ ok: true, first: result.first }, { status: 201 });
}
