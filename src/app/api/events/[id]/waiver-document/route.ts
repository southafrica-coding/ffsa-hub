import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_CREATE_GATE } from "@/lib/auth/event-access";

const BUCKET = "waiver-documents";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket limit.

// POST /api/events/[id]/waiver-document
// Admin-only multipart upload of the blank waiver form (a PDF) for a tier.
// Stores it in the private waiver-documents bucket and returns the path +
// original filename, which the admin editor then saves onto the tier's
// waiver config (ticket_types.waiver). The actual sign happens at checkout.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageEvent(supabase, user.id, EVENT_CREATE_GATE.keys, eventId, EVENT_CREATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart form data" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  const ticketTypeId = (form.get("ticket_type_id") as string | null)?.trim();
  if (!ticketTypeId) {
    return NextResponse.json(
      { error: "ticket_type_id is required" },
      { status: 400 }
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "The waiver form must be a PDF." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File must be 10 MB or smaller." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const path = `blank/${eventId}/${ticketTypeId}/${Date.now()}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const upload = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: false });
  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }

  return NextResponse.json({
    document_path: path,
    document_name: file.name,
  });
}

// GET /api/events/[id]/waiver-document?tier=<ticketTypeId>
// Public — streams the blank waiver PDF for a tier so a parent can read it
// at checkout before signing. Only serves a tier that actually has an
// enabled waiver + uploaded document; never exposes arbitrary bucket paths.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const url = new URL(request.url);
  const ticketTypeId = url.searchParams.get("tier")?.trim();
  if (!ticketTypeId) {
    return NextResponse.json({ error: "Missing tier" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: tier } = await admin
    .from("ticket_types")
    .select("id, event_id, waiver")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .maybeSingle();

  const waiver = (tier?.waiver ?? null) as {
    enabled?: boolean;
    document_path?: string | null;
    document_name?: string | null;
  } | null;
  if (!waiver || waiver.enabled !== true || !waiver.document_path) {
    return NextResponse.json({ error: "No waiver document" }, { status: 404 });
  }

  const { data: blob, error } = await admin.storage
    .from(BUCKET)
    .download(waiver.document_path);
  if (error || !blob) {
    return NextResponse.json({ error: "Document unavailable" }, { status: 404 });
  }

  const arrayBuffer = await blob.arrayBuffer();
  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${(waiver.document_name ?? "waiver").replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
