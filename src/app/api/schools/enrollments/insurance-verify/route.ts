import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setEnrollmentInsuranceVerified } from "@/services/schools";

// Record or clear the arrival-day health-insurance check on an enrollment.
// Body: { id: string, verified: boolean }. Runs under RLS as the logged-in
// user, so the existing program-scoped enrollments UPDATE policy authorizes it.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { id, verified } = body as { id?: string; verified?: boolean };

  if (!id || typeof verified !== "boolean") {
    return NextResponse.json(
      { error: "id and verified (boolean) are required" },
      { status: 400 }
    );
  }

  const { data, error } = await setEnrollmentInsuranceVerified(
    supabase,
    id,
    verified ? user.id : null
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, enrollment: data });
}
