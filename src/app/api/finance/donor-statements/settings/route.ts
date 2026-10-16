import { NextResponse } from "next/server";
import {
  authorizeDonorStatements,
  dsDb,
  loadSettings,
  DONOR_STATEMENTS_BUCKET,
  EDITABLE_LIST_SETTINGS,
  EDITABLE_TEXT_SETTINGS,
} from "@/lib/finance/donor-statements-server";

// GET                      → settings
// GET ?image=logo|signature → the stored image
// PUT { field: value, … }   → update text / list settings
// POST multipart { kind: logo|signature, file } → replace an image
//
// One row (migration 245). The PDF and the email both read from here, so a
// change is made once.

const IMAGE_KINDS = { logo: "logo_path", signature: "signature_path" } as const;
type ImageKind = keyof typeof IMAGE_KINDS;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export async function GET(request: Request) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const admin = dsDb();
  const settings = await loadSettings(admin);
  if (!settings) return NextResponse.json({ error: "Settings missing — apply migration 245." }, { status: 500 });

  const image = new URL(request.url).searchParams.get("image") as ImageKind | null;
  if (!image) return NextResponse.json({ settings });

  const path = IMAGE_KINDS[image] ? settings[IMAGE_KINDS[image]] : null;
  if (!path) return NextResponse.json({ error: "Not uploaded" }, { status: 404 });
  const { data: blob, error } = await admin.storage.from(DONOR_STATEMENTS_BUCKET).download(path);
  if (error || !blob) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  return new NextResponse(await blob.arrayBuffer(), {
    headers: { "Content-Type": blob.type || "image/png", "Cache-Control": "private, max-age=60" },
  });
}

export async function PUT(request: Request) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_TEXT_SETTINGS) {
    if (k in body) {
      const v = String(body[k] ?? "").trim();
      if (!v) return NextResponse.json({ error: `${k.replace(/_/g, " ")} can't be empty` }, { status: 400 });
      patch[k] = v;
    }
  }
  for (const k of EDITABLE_LIST_SETTINGS) {
    if (k in body) {
      const raw = Array.isArray(body[k]) ? (body[k] as unknown[]) : String(body[k] ?? "").split(/[,\n]/);
      patch[k] = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { data, error } = await dsDb()
    .from("donor_statement_settings")
    .update({ ...patch, updated_by: auth.user.id, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}

export async function POST(request: Request) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const form = await request.formData().catch(() => null);
  const kind = form?.get("kind") as ImageKind | null;
  const file = form?.get("file");
  if (!kind || !IMAGE_KINDS[kind] || !(file instanceof File)) {
    return NextResponse.json({ error: "Send kind (logo or signature) and a file" }, { status: 400 });
  }
  if (!["image/png", "image/jpeg"].includes(file.type)) {
    return NextResponse.json({ error: "Use a PNG or JPEG image" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Image is over 2 MB" }, { status: 400 });

  const admin = dsDb();
  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `settings/${kind}-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(DONOR_STATEMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data, error } = await admin
    .from("donor_statement_settings")
    .update({ [IMAGE_KINDS[kind]]: path, updated_by: auth.user.id, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
