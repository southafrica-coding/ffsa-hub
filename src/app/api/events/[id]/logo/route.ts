import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateEvent } from "@/services/events";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_UPDATE_GATE, writeBlocked } from "@/lib/auth/event-access";

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

// POST /api/events/[id]/logo — multipart upload of an event logo.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_UPDATE_GATE.keys, eventId, EVENT_UPDATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json(
      { error: "Logo must be a PNG, JPG, WEBP, or SVG image" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Logo must be 2 MB or smaller" }, { status: 400 });
  }

  const admin = createAdminClient();
  const path = `${eventId}/${Date.now()}.${EXT[file.type] ?? "png"}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const upload = await admin.storage
    .from("event-logos")
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }

  const { data: pub } = admin.storage.from("event-logos").getPublicUrl(path);
  const logoUrl = pub.publicUrl;

  const { error } = await updateEvent(supabase, eventId, { logo_url: logoUrl });
  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ logoUrl });
}

// DELETE /api/events/[id]/logo — clear the event logo.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_UPDATE_GATE.keys, eventId, EVENT_UPDATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await updateEvent(supabase, eventId, { logo_url: null });
  if (writeBlocked(error, data)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
