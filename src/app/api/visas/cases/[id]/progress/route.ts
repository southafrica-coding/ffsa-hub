import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordVisaProgress } from "@/services/visas";
import { cleanNote, isIsoDate, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";

// POST — record what happened after approval: lodged, granted, refused,
// arrived. { status, ...details }. Only known fields are passed on; the
// database checks the order (approved → lodged → granted/refused → arrived).
const STATUSES = ["lodged", "granted", "refused", "arrived"] as const;
type Progress = (typeof STATUSES)[number];
const DATE_FIELDS = ["lodged_on", "decided_on", "visa_valid_to", "arrived_on"] as const;
const TEXT_FIELDS = ["lodged_where", "embassy_reference", "refusal_reason"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;

  const body = await request.json().catch(() => ({}));
  if (!isUuid(caseId) || !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const details: Record<string, string | boolean | null> = {};
  for (const f of DATE_FIELDS) {
    if (body[f] == null || body[f] === "") continue;
    if (!isIsoDate(body[f])) return NextResponse.json({ error: `${f} must be a date` }, { status: 400 });
    details[f] = body[f];
  }
  for (const f of TEXT_FIELDS) {
    const v = cleanNote(body[f], 200);
    if (v) details[f] = v;
  }
  if (typeof body.entry_stamp_ok === "boolean") details.entry_stamp_ok = body.entry_stamp_ok;

  const { error } = await recordVisaProgress(supabase, caseId, body.status as Progress, details);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
