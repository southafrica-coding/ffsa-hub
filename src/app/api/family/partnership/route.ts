import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  createPartnership,
  updatePartnership,
  deletePartnership,
  FamilyError,
  type PartnerStatus,
} from "@/services/family";

function fail(e: unknown) {
  if (e instanceof FamilyError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  try {
    const result = await createPartnership(createAdminClient(), user.id, {
      partnerUserId: body.partnerUserId ?? null,
      partnerName: body.partnerName ?? null,
      anniversaryDate: body.anniversaryDate ?? null,
      status: body.status as PartnerStatus | undefined,
    });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    await updatePartnership(createAdminClient(), user.id, body.id, {
      anniversaryDate: body.anniversaryDate,
      status: body.status as PartnerStatus | undefined,
      partnerName: body.partnerName,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    await deletePartnership(createAdminClient(), user.id, body.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
