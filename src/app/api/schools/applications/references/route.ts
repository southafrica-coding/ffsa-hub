import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReferenceRequestsByApplication } from "@/services/schools";
import { canManageSchools } from "@/lib/api-auth";
import {
  editReferenceContact,
  REFERENCE_EDIT_SELECT,
} from "@/lib/references/edit-reference-contact";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get("application_id");

  if (!applicationId) {
    return NextResponse.json(
      { error: "application_id is required" },
      { status: 400 }
    );
  }

  const { data, error } = await getReferenceRequestsByApplication(
    supabase,
    applicationId
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ references: data });
}

// PATCH — swap out a pending reference's contact (name/email). Admin path:
// gated by canManageSchools. A changed email regenerates the invite token
// (old link dies) and re-sends the invite to the corrected address.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!(await canManageSchools(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const reference_request_id = body?.reference_request_id;
  if (!reference_request_id) {
    return NextResponse.json(
      { error: "reference_request_id is required" },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient();
  const { data: ref } = await adminSupabase
    .from("reference_requests")
    .select(REFERENCE_EDIT_SELECT)
    .eq("id", reference_request_id)
    .single();

  if (!ref) {
    return NextResponse.json(
      { error: "Reference request not found" },
      { status: 404 }
    );
  }

  const result = await editReferenceContact(adminSupabase, ref, {
    referee_name: body?.referee_name,
    referee_email: body?.referee_email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    reference: result.data,
    emailed: result.emailed,
    email_changed: result.emailChanged,
  });
}
