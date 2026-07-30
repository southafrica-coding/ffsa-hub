import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getMembers,
  getContactCard,
  listEvaluators,
  setMemberStatus,
  setCoordinator,
} from "@/services/prayer-room-members";
import { isPrayerRoomStaff, isApprovedMember, canViewDirectory } from "@/lib/auth/prayer-room-access";

// GET — the team directory. Names + skills are for staff and approved members
// (not the public schedule). Contact details require the same and are returned
// only when explicitly requested for one person.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const staff = await isPrayerRoomStaff(supabase, user.id);
  const trusted =
    staff ||
    (await isApprovedMember(supabase, user.id)) ||
    (await canViewDirectory(supabase, user.id));
  if (!trusted) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const url = new URL(request.url);
  const admin = createAdminClient();

  // contact card for a single person (sensitive)
  const contactFor = url.searchParams.get("contactFor");
  if (contactFor) {
    const { data, error } = await getContactCard(admin, contactFor);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // evaluator picker (staff only)
  if (url.searchParams.get("evaluators") === "true") {
    if (!staff) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    const { data, error } = await listEvaluators(admin);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await getMembers(admin, {
    status: url.searchParams.get("status") ?? undefined,
    labelId: url.searchParams.get("labelId") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PUT — staff manage a member's status / evaluator / coordinator flags.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await isPrayerRoomStaff(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { user_id, action, value } = body as { user_id?: string; action?: string; value?: unknown };
  if (!user_id || !action) return NextResponse.json({ error: "user_id and action are required" }, { status: 400 });

  let result;
  if (action === "status") {
    result = await setMemberStatus(supabase, user_id, String(value));
  } else if (action === "coordinator") {
    result = await setCoordinator(supabase, user_id, value === true);
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 403 });
  return NextResponse.json(result.data);
}
