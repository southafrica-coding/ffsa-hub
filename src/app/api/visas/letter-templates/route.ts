import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveVisaLetterTemplate } from "@/services/visas";
import { cleanNote, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";
import { isLetterKind, templateProblems } from "@/lib/visas/letters";

// POST — global legal saves the draft of a letter template (a new version
// if there's no draft yet). { kind, program_id, title, body, change_note? }
// A draft may still have problems; publishing refuses until it has none.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;

  const body = await request.json().catch(() => ({}));
  const { kind, program_id, title } = body;
  const text: unknown = body.body;
  if (!isLetterKind(kind)) return NextResponse.json({ error: "Unknown letter" }, { status: 400 });
  if (program_id !== null && program_id !== undefined && !isUuid(program_id)) {
    return NextResponse.json({ error: "Unknown school" }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim() || title.length > 200) {
    return NextResponse.json({ error: "Give the letter a title (up to 200 characters)" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim() || text.length > 20000) {
    return NextResponse.json({ error: "The letter needs some text (up to 20,000 characters)" }, { status: 400 });
  }

  const { data, error } = await saveVisaLetterTemplate(supabase, {
    kind,
    program_id: program_id ?? null,
    title: title.trim(),
    body: text.replace(/\r\n/g, "\n"),
    change_note: cleanNote(body.change_note, 500),
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true, id: data, problems: templateProblems(kind, text) });
}
