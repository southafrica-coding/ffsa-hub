import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanEditKeyResult } from "@/lib/auth/check-okr-access";
import { createCheckin, hydrateUserNames, listCheckins } from "@/services/okrs";
import { OKR_STATUSES, type OkrCheckin } from "@/types/okrs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  // Read the log with the CALLER's client, so RLS decides whether they may see
  // this key result at all...
  const { data, error } = await listCheckins(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const checkins = (data ?? []) as OkrCheckin[];

  // ...then resolve only the NAMES with the admin client. public.users is
  // own-row-or-admin, so an embedded users(...) join would hand a ministry
  // leader a list of nulls and every author would read "Unknown".
  const names = await hydrateUserNames(checkins.map((c) => c.author_id));

  return NextResponse.json({
    checkins: checkins.map((c) => ({ ...c, author_name: names[c.author_id] ?? null })),
  });
}

export async function POST(request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  if (!(await callerCanEditKeyResult(supabase, user.id, id))) {
    return NextResponse.json({ error: "You cannot check in on this key result" }, { status: 403 });
  }

  const body = await request.json();
  if (!OKR_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "A valid status is required" }, { status: 400 });
  }

  const hasValue = body.value !== null && body.value !== undefined && body.value !== "";
  if (hasValue && !Number.isFinite(Number(body.value))) {
    return NextResponse.json({ error: "The figure must be a number" }, { status: 400 });
  }

  const { data, error } = await createCheckin(supabase, {
    key_result_id: id,
    status: body.status,
    value: hasValue ? Number(body.value) : null,
    comment: body.comment?.trim() || null,
    ...(body.checkin_on ? { checkin_on: body.checkin_on } : {}),
    author_id: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The key result's current_status is now updated by the okr_checkins trigger.
  return NextResponse.json({ success: true, checkin: data });
}
