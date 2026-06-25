import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  addChild,
  updateChild,
  removeChild,
  FamilyError,
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
    const result = await addChild(createAdminClient(), user.id, {
      fullName: body.fullName ?? "",
      birthDate: body.birthDate ?? null,
      notes: body.notes ?? null,
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
    await updateChild(createAdminClient(), user.id, body.id, {
      fullName: body.fullName,
      birthDate: body.birthDate,
      notes: body.notes,
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
    await removeChild(createAdminClient(), user.id, body.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
