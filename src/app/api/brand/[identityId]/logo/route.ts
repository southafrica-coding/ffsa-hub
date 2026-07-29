import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export async function POST(
  request: Request,
  context: { params: Promise<{ identityId: string }> }
) {
  const { identityId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id, ["communications.manage_brand_kits"]))) {
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
    return NextResponse.json(
      { error: "Logo must be 3 MB or smaller" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const path = `${identityId}/${Date.now()}.${EXT[file.type] ?? "png"}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const upload = await admin.storage
    .from("brand-assets")
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }

  const { data: pub } = admin.storage.from("brand-assets").getPublicUrl(path);
  return NextResponse.json({ logoUrl: pub.publicUrl });
}
