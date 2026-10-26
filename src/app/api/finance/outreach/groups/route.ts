import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageOutreachTeams } from "@/lib/finance/outreach-team-admin";
import { isUuid } from "@/lib/finance/outreach-access";
import {
  createOutreachGroup,
  deleteOutreachGroup,
  updateOutreachGroup,
} from "@/services/outreach-groups";

// Creating, renaming and deleting outreach groups (migration 273) is for
// outreach administrators only — is_outreach_staff_editor(): Super Admin,
// General Admin, finance_admin, or a finance.edit grant. Checked here and
// again by RLS.

const NAME_MAX = 120;
const TEXT_MAX = 500;

function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!(await canManageOutreachTeams(supabase))) {
    return {
      error: NextResponse.json(
        { error: "Only admins and finance staff can change outreach groups" },
        { status: 403 }
      ),
    };
  }
  return { supabase, user };
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name = cleanText(body?.name, NAME_MAX);
  if (!name) {
    return NextResponse.json({ error: "A group needs a name" }, { status: 400 });
  }

  const { data, error } = await createOutreachGroup(auth.supabase, {
    name,
    category: cleanText(body?.category, NAME_MAX) ?? null,
    description: cleanText(body?.description, TEXT_MAX) ?? null,
    created_by: auth.user.id,
  });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "There is already a group with that name" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, group: data });
}

export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  if (!isUuid(body?.id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: { name?: string; category?: string | null; description?: string | null } = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, NAME_MAX);
    if (!name) return NextResponse.json({ error: "A group needs a name" }, { status: 400 });
    updates.name = name;
  }
  const category = cleanText(body.category, NAME_MAX);
  if (category !== undefined) updates.category = category;
  const description = cleanText(body.description, TEXT_MAX);
  if (description !== undefined) updates.description = description;

  const { data, error } = await updateOutreachGroup(auth.supabase, body.id, updates);
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "There is already a group with that name" }, { status: 409 });
    }
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, group: data });
}

/** Deleting a group only unlinks its teams and managers; no team data goes. */
export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  if (!isUuid(body?.id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await deleteOutreachGroup(auth.supabase, body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
