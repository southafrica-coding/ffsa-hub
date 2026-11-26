import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVisaDocumentById, logVisaCaseEvent } from "@/services/visas";
import { SIGNED_URL_TTL, VISA_BUCKET, isUuid, ownStoragePath, refusePreviewWrite } from "@/lib/visas/api";

// GET — a short-lived link to one document. Whoever can see the row
// (RLS: legal, the case's school leaders, the student) gets a link; every
// download is logged. Logging is a write to the live database, so previews
// can't open documents at all. Only the row's own file
// ('<case_id>/<id>.<ext>') is ever signed.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(id)) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { data: doc } = await getVisaDocumentById(supabase, id);
  const path = doc ? ownStoragePath(doc) : null;
  if (!doc || !path) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: signed, error } = await admin.storage
    .from(VISA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !signed?.signedUrl) return NextResponse.json({ error: "File not available" }, { status: 500 });

  await logVisaCaseEvent(admin, {
    case_id: doc.case_id,
    actor_id: user.id,
    kind: "document_downloaded",
    detail: { document_id: doc.id },
  });
  return NextResponse.json({ url: signed.signedUrl, expires_in: SIGNED_URL_TTL });
}
