import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessRecordsLibrary } from "@/lib/auth/records-library-access";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: importId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { failed?: boolean; errorLog?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminSupabase: any = createAdminClient();

  // Authz — same gate as the create and rows endpoints.
  const allowed = await canAccessRecordsLibrary(adminSupabase, user.id);
  if (!allowed) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Run matching: every newly-imported person may match an
  // existing user. We loop over users with linkable matches via
  // a single SQL pass so newly-created persons are picked up.
  if (!body.failed) {
    const { data: candidateUsers } = await adminSupabase
      .from("users")
      .select("id, email, last_name")
      .not("email", "is", null)
      .not("last_name", "is", null);

    let autoLinkedTotal = 0;
    let queuedTotal = 0;

    if (candidateUsers) {
      for (const u of candidateUsers) {
        const { data: rpcData } = await adminSupabase.rpc(
          "auto_link_library_records_for_user",
          { p_user_id: u.id }
        );
        if (Array.isArray(rpcData) && rpcData[0]) {
          autoLinkedTotal += rpcData[0].auto_linked ?? 0;
          queuedTotal += rpcData[0].queued ?? 0;
        }
      }
    }

    await adminSupabase
      .from("library_imports")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        auto_linked_count: autoLinkedTotal,
        queued_count: queuedTotal,
      })
      .eq("id", importId);

    return NextResponse.json({
      success: true,
      auto_linked: autoLinkedTotal,
      queued: queuedTotal,
    });
  }

  await adminSupabase
    .from("library_imports")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_log: body.errorLog ?? null,
    })
    .eq("id", importId);

  return NextResponse.json({ success: true });
}
