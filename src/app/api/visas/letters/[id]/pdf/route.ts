import React from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVisaCaseById, getVisaLetterById, getVisaLetterPassport, logVisaCaseEvent } from "@/services/visas";
import { isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";
import { fillPassport } from "@/lib/visas/letters";
import { VisaLetterDocument } from "@/lib/visas/letter-pdf";

// GET — a letter as a PDF, with the passport number filled in. Legal for
// the case prints it to sign and stamp; the student opens a copy marked
// "for checking" until it's signed. School leaders can't open it
// (visa_letter_passport refuses them). Every opening is logged, so
// previews can't open letters at all. The file name carries no name or
// number.
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
  if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
  const { data: passport, error } = await getVisaLetterPassport(supabase, id);
  if (error) return rpcErrorResponse(error);
  const { data: visaCase } = await getVisaCaseById(supabase, letter.case_id);
  const isStudent = visaCase?.user_id === user.id;

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  await logVisaCaseEvent(admin, {
    case_id: letter.case_id,
    actor_id: user.id,
    kind: "letter_opened",
    detail: { letter_id: letter.id },
  });

  const doc = React.createElement(VisaLetterDocument, {
    text: fillPassport(letter.body, typeof passport === "string" ? passport : null),
    reference: letter.id.slice(0, 8).toUpperCase(),
    forChecking: isStudent && letter.status !== "signed",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await renderToBuffer(doc as any);
  return new NextResponse(Buffer.from(pdf) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="ffsa-letter-${letter.id.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
