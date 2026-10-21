import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  HUB_FEEDBACK_BUCKET,
  countHubFeedbackFiles,
  getHubFeedbackAccess,
  getHubFeedbackById,
  insertHubFeedbackFile,
  type HubFeedbackRow,
} from "@/services/hub-feedback";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket limit.
const MAX_FILES = 5;

// POST /api/hub-feedback/[id]/files — multipart screenshot upload into the
// private 'hub-feedback' bucket. The submitter (own item) or the team.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!EXT[file.type]) {
    return NextResponse.json({ error: "Screenshots must be PNG, JPG, WEBP, GIF or HEIC" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Screenshots must be 10 MB or smaller" }, { status: 400 });
  }

  const { data: row } = await getHubFeedbackById(supabase, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { canView } = await getHubFeedbackAccess(supabase);
  if (!canView && (row as HubFeedbackRow).submitted_by !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { count } = await countHubFeedbackFiles(supabase, id);
  if ((count ?? 0) >= MAX_FILES) {
    return NextResponse.json({ error: `Up to ${MAX_FILES} screenshots per item` }, { status: 400 });
  }

  const admin = createAdminClient();
  const path = `${id}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${EXT[file.type]}`;
  const upload = await admin.storage
    .from(HUB_FEEDBACK_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });

  const { error } = await insertHubFeedbackFile(supabase, {
    feedback_id: id,
    file_path: path,
    file_name: file.name || null,
    content_type: file.type,
    uploaded_by: user.id,
  });
  if (error) {
    // Roll back the orphaned object if the metadata insert fails.
    await admin.storage.from(HUB_FEEDBACK_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
