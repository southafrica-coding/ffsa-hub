import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  attachVisaLetterScan,
  canManageVisaCase,
  getVisaCaseById,
  getVisaLetterById,
  logVisaCaseEvent,
} from "@/services/visas";
import {
  SIGNED_URL_TTL,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  VISA_BUCKET,
  isUuid,
  ownStoragePath,
  refusePreviewWrite,
  rpcErrorResponse,
  sniffUploadType,
} from "@/lib/visas/api";

// The signed, stamped scan of a letter. It shows the passport number, so
// only legal for the case and the student open it; school leaders see that
// it's signed, not the letter. Files live at '<case id>/<letter id>.<ext>'
// in the private bucket.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Legal for the case, or the student it's for. */
async function mayOpen(supabase: Client, caseId: string, userId: string) {
  const { data: visaCase } = await getVisaCaseById(supabase, caseId);
  if (!visaCase) return false;
  if (visaCase.user_id === userId) return true;
  const { data: legal } = await canManageVisaCase(supabase, caseId);
  return legal === true;
}

// GET — a short-lived link to the scan. Logged.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(id)) return NextResponse.json({ error: "Letter not found" }, { status: 404 });

  const { data: letter } = await getVisaLetterById(supabase, id);
  const path = letter ? ownStoragePath({ id: letter.id, case_id: letter.case_id, storage_path: letter.scan_path }) : null;
  if (!letter || !path) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
  if (!(await mayOpen(supabase, letter.case_id, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: signed, error } = await admin.storage.from(VISA_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !signed?.signedUrl) return NextResponse.json({ error: "File not available" }, { status: 500 });

  await logVisaCaseEvent(admin, {
    case_id: letter.case_id,
    actor_id: user.id,
    kind: "letter_scan_downloaded",
    detail: { letter_id: letter.id },
  });
  return NextResponse.json({ url: signed.signedUrl, expires_in: SIGNED_URL_TTL });
}

// POST — legal uploads the scan (multipart: file). The file is stored
// first; visa_attach_letter_scan, called as the user, decides whether it
// counts (legal for the case, the student has confirmed). If it refuses,
// the file is removed again.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(id)) return NextResponse.json({ error: "Letter not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
  }
  const mimeType = sniffUploadType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  // A scan is a PDF or a photo; HEIC and WEBP don't print reliably at embassies.
  if (mimeType !== "application/pdf" && mimeType !== "image/jpeg" && mimeType !== "image/png") {
    return NextResponse.json({ error: "The scan must be a PDF, JPG or PNG" }, { status: 400 });
  }

  const { data: letter } = await getVisaLetterById(supabase, id);
  if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
  const { data: legal } = await canManageVisaCase(supabase, letter.case_id);
  if (legal !== true) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (letter.status !== "confirmed") {
    return NextResponse.json(
      { error: letter.status === "signed" ? "This letter is already signed" : "The student has to confirm the details first" },
      { status: 409 }
    );
  }

  const path = `${letter.case_id}/${letter.id}.${UPLOAD_TYPES[mimeType]}`;
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await admin.storage
    .from(VISA_BUCKET)
    .upload(path, file, { contentType: mimeType, upsert: false });
  if (upErr) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const { error } = await attachVisaLetterScan(supabase, letter.id, path, mimeType);
  if (error) {
    await admin.storage.from(VISA_BUCKET).remove([path]);
    return rpcErrorResponse(error);
  }
  return NextResponse.json({ success: true });
}
