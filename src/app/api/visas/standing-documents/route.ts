import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createVisaStandingDocument } from "@/services/visas";
import { getVisaAccess } from "@/lib/visas/access";
import { refusePreviewWrite, tableErrorResponse } from "@/lib/visas/api";
import { cleanStandingDocument } from "@/lib/visas/standing";

// POST — global legal adds one of FFSA's standing documents (500). The
// file is uploaded separately (./[id]/file); until then it can't be marked
// for students.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!(await getVisaAccess(supabase, user.id)).globalLegal) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const cleaned = cleanStandingDocument(await request.json().catch(() => ({})));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  if (cleaned.data.for_students) {
    return NextResponse.json({ error: "Upload the file before giving it to students" }, { status: 400 });
  }

  const { data, error } = await createVisaStandingDocument(supabase, { ...cleaned.data }, user.id);
  if (error) return tableErrorResponse(error, "There's already a document with that name");
  return NextResponse.json({ success: true, id: data.id });
}
