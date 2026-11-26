import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getVisaCaseById,
  getVisaCaseSchools,
  getVisaLetterStudent,
  getVisaLetterTemplateById,
  issueVisaLetter,
} from "@/services/visas";
import { isIsoDate, isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";
import {
  LETTER_FIELDS,
  cleanInputs,
  letterValues,
  renderLetter,
  type LetterSchool,
  type LetterStudent,
} from "@/lib/visas/letters";

// POST — legal issues a letter on a case from the current version of a
// template. { template_id, letter_date, inputs, preview? }
// The Hub fills in the student's details; legal only enters the fields
// the template asks for (addressee, extra dates) and ticks its optional
// paragraphs. With preview: true, nothing is issued and the filled-in text
// comes back so legal can read it first. The passport number stays a
// {{passport_number}} token here; it's filled in when the PDF is opened.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isUuid(caseId)) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const preview = body.preview === true;
  if (!preview) {
    const refusal = refusePreviewWrite();
    if (refusal) return refusal;
  }
  if (!isUuid(body.template_id)) return NextResponse.json({ error: "Choose a letter" }, { status: 400 });
  if (!isIsoDate(body.letter_date)) return NextResponse.json({ error: "Give the letter a date" }, { status: 400 });
  const cleaned = cleanInputs(body.inputs);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  const inputs = cleaned.inputs;

  const { data: visaCase } = await getVisaCaseById(supabase, caseId);
  if (!visaCase) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  // RLS: only visas.manage holders read templates.
  const { data: template } = await getVisaLetterTemplateById(supabase, body.template_id);
  if (!template) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (template.status !== "current") {
    return NextResponse.json({ error: "Use the current version of the letter" }, { status: 409 });
  }

  // Refused for anyone but legal for this case.
  const { data: student, error: studentErr } = await getVisaLetterStudent(supabase, caseId);
  if (studentErr) return rpcErrorResponse(studentErr);
  if (!student) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const { data: schoolRows } = await getVisaCaseSchools(supabase, caseId);
  const rows = (schoolRows ?? []) as Array<{
    program_id: string;
    start_date: string | null;
    end_date: string | null;
    programs: { name: string } | null;
  }>;
  // An invitation is for its school; the other letters cover the whole stay.
  const schools: LetterSchool[] = rows
    .filter((r) => !template.program_id || r.program_id === template.program_id)
    .map((r) => ({ name: r.programs?.name ?? "", start_date: r.start_date, end_date: r.end_date }));
  if (template.program_id && schools.length === 0) {
    return NextResponse.json({ error: "That letter is for a school this case doesn't cover" }, { status: 409 });
  }

  const values = letterValues({
    letterDate: body.letter_date,
    student: student as LetterStudent,
    stay: { from: visaCase.stay_from, to: visaCase.stay_to },
    schools,
    inputs,
  });
  const { text, missing } = renderLetter(template.body, values, inputs);
  if (missing.length > 0) {
    const label = new Map(LETTER_FIELDS.map((f) => [f.key, f.label]));
    return NextResponse.json(
      { error: "Some details are missing", missing: missing.map((k) => label.get(k) ?? k) },
      { status: 400 }
    );
  }
  if (preview) return NextResponse.json({ success: true, text });

  const { data: letterId, error } = await issueVisaLetter(supabase, {
    case_id: caseId,
    template_id: template.id,
    letter_date: body.letter_date,
    body: text,
    inputs,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true, letter_id: letterId });
}
