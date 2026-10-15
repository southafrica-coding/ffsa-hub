import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_EMAIL_ATTACHMENT_BYTES,
  PROGRAM_EMAIL_DOCUMENTS_BUCKET,
  cleanDocumentFileName,
  isDocumentEmailType,
  listProgramEmailDocuments,
} from "@/lib/email/program-email-documents";

// GET    /api/schools/programs/[programId]/email-documents           → list
// GET    /api/schools/programs/[programId]/email-documents?id=<id>   → download one
// POST   { action: "sign" | "confirm", emailType, … }                → upload
// PATCH  { id, fileName } | { emailType, order: [id, …] }            → rename / reorder
// DELETE ?id=<id>                                                    → remove
//
// Documents attached to a school's onboarding emails (migration 238).
// Gated like the email templates: admins, global schools managers and this
// school's leaders.

async function authorize(programId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };
  if (!(await userCanManageProgram(supabase, user.id, programId))) {
    return { error: "Not authorized", status: 403 as const };
  }
  return { user };
}

type Ctx = { params: Promise<{ programId: string }> };

// program_email_documents (migration 238) isn't in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => createAdminClient() as any;

export async function GET(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const admin = db();
  const id = new URL(request.url).searchParams.get("id");

  if (!id) {
    const documents = await listProgramEmailDocuments(admin, programId);
    return NextResponse.json({ documents });
  }

  const { data: doc } = await admin
    .from("program_email_documents")
    .select("storage_path, file_name, content_type")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { data: blob, error } = await admin.storage
    .from(PROGRAM_EMAIL_DOCUMENTS_BUCKET)
    .download(doc.storage_path);
  if (error || !blob) {
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
  return new NextResponse(await blob.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": doc.content_type,
      "Content-Disposition": `inline; filename="${doc.file_name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function POST(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Two steps, because Vercel caps request bodies at ~4.5 MB: "sign" hands
  // back a signed URL the browser PUTs the file to directly, then "confirm"
  // checks what actually landed in storage and records it.
  const body = (await request.json().catch(() => ({}))) as {
    action?: "sign" | "confirm";
    emailType?: string;
    fileName?: string;
    contentType?: string;
    size?: number;
    path?: string;
  };
  const emailType = String(body.emailType ?? "");
  if (!isDocumentEmailType(emailType)) {
    return NextResponse.json({ error: "Unknown email" }, { status: 400 });
  }
  const contentType = String(body.contentType ?? "");
  const ext = ALLOWED_DOCUMENT_TYPES[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: "Upload a PDF, Word, Excel, PNG or JPG file." },
      { status: 400 }
    );
  }

  const admin = db();
  const bucket = admin.storage.from(PROGRAM_EMAIL_DOCUMENTS_BUCKET);
  const existing = (await listProgramEmailDocuments(admin, programId)).filter(
    (d) => d.email_type === emailType
  );
  const used = existing.reduce((sum, d) => sum + d.size_bytes, 0);
  const sizeError = (size: number) =>
    !size || size > MAX_DOCUMENT_BYTES
      ? "Each file must be 10 MB or smaller."
      : used + size > MAX_EMAIL_ATTACHMENT_BYTES
        ? `That would take this email over 25 MB of attachments (${(used / 1024 / 1024).toFixed(1)} MB already attached).`
        : null;

  if (body.action === "sign") {
    const problem = sizeError(Number(body.size));
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const path = `${programId}/${emailType}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Could not start upload" },
        { status: 500 }
      );
    }
    return NextResponse.json({ path, signedUrl: data.signedUrl });
  }

  if (body.action !== "confirm") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // Only accept a path this route could have signed for this school + email.
  const path = String(body.path ?? "");
  const prefix = `${programId}/${emailType}/`;
  const objectName = path.slice(prefix.length);
  if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\.[a-z]+$/.test(objectName)) {
    return NextResponse.json({ error: "Bad upload path" }, { status: 400 });
  }
  const { data: listed } = await bucket.list(`${programId}/${emailType}`, {
    search: objectName,
  });
  const stored = (listed ?? []).find((o: { name: string }) => o.name === objectName);
  const size = Number(stored?.metadata?.size ?? 0);
  if (!stored) {
    return NextResponse.json({ error: "Upload not found" }, { status: 400 });
  }
  const problem = sizeError(size);
  if (problem) {
    await bucket.remove([path]);
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const { error } = await admin.from("program_email_documents").insert({
    program_id: programId,
    email_type: emailType,
    storage_path: path,
    file_name: cleanDocumentFileName(String(body.fileName ?? ""), contentType),
    content_type: contentType,
    size_bytes: size,
    sort_order: existing.length
      ? Math.max(...existing.map((d) => d.sort_order)) + 1
      : 0,
    uploaded_by: auth.user.id,
  });
  if (error) {
    await bucket.remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    documents: await listProgramEmailDocuments(admin, programId),
  });
}

export async function PATCH(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    fileName?: string;
    emailType?: string;
    order?: string[];
  };
  const admin = db();

  if (body.id && typeof body.fileName === "string") {
    const { data: doc } = await admin
      .from("program_email_documents")
      .select("content_type")
      .eq("id", body.id)
      .eq("program_id", programId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!body.fileName.trim()) {
      return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
    }
    const { error } = await admin
      .from("program_email_documents")
      .update({ file_name: cleanDocumentFileName(body.fileName, doc.content_type) })
      .eq("id", body.id)
      .eq("program_id", programId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.emailType && Array.isArray(body.order)) {
    for (const [i, id] of body.order.entries()) {
      await admin
        .from("program_email_documents")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("program_id", programId)
        .eq("email_type", body.emailType);
    }
  } else {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  return NextResponse.json({
    documents: await listProgramEmailDocuments(admin, programId),
  });
}

export async function DELETE(request: Request, context: Ctx) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = db();
  const { data: doc } = await admin
    .from("program_email_documents")
    .select("storage_path")
    .eq("id", id)
    .eq("program_id", programId)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await admin
    .from("program_email_documents")
    .delete()
    .eq("id", id)
    .eq("program_id", programId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.storage.from(PROGRAM_EMAIL_DOCUMENTS_BUCKET).remove([doc.storage_path]);

  return NextResponse.json({
    documents: await listProgramEmailDocuments(admin, programId),
  });
}
