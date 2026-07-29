import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getLabelById,
  updateLabel,
  deleteLabel,
} from "@/services/labels";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";
import { LABEL_PALETTE } from "@/lib/label-color";
import { revalidateLabelsCache } from "@/lib/cached-reads";

const PALETTE_BGS = new Set(LABEL_PALETTE.map((p) => p.bg.toLowerCase()));

type LabelPatch = {
  name?: string;
  color?: string;
  description?: string | null;
  is_active?: boolean;
};

// PATCH — rename / recolor / description / hide-unhide. Slug is intentionally
// NOT editable: it's referenced by find-or-create (CSV imports), form config,
// and workflow config, so renaming the display name must not move the slug.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id, ["communications.manage_labels"]))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const existing = await getLabelById(supabase, id);
  if (!existing.data) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  let body: LabelPatch;
  try {
    body = (await request.json()) as LabelPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate touched fields only, then build the patch from what was sent.
  const patch: LabelPatch = {};

  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return NextResponse.json(
        { error: "Label name cannot be empty" },
        { status: 400 }
      );
    }
    patch.name = body.name.trim();
  }

  if (body.color !== undefined) {
    if (!PALETTE_BGS.has(body.color.toLowerCase())) {
      return NextResponse.json(
        { error: "Pick a colour from the palette" },
        { status: 400 }
      );
    }
    patch.color = body.color;
  }

  if (body.description !== undefined) {
    patch.description = body.description?.trim() || null;
  }

  if (body.is_active !== undefined) {
    patch.is_active = body.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await updateLabel(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidateLabelsCache();
  return NextResponse.json({ label: data });
}

// DELETE — hard delete with guardrails. Preset labels are the centrally
// managed library and can't be deleted (hide instead). Labels still wired to
// a form or campaign are protected by ON DELETE RESTRICT; we pre-flight those
// counts to return a clear message rather than a raw FK error.
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id, ["communications.manage_labels"]))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const existing = await getLabelById(supabase, id);
  if (!existing.data) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }
  if (existing.data.is_preset) {
    return NextResponse.json(
      { error: "Preset labels can't be deleted — hide it instead." },
      { status: 409 }
    );
  }

  const [{ count: formCount }, { count: campaignCount }] = await Promise.all([
    supabase
      .from("forms")
      .select("id", { count: "exact", head: true })
      .eq("label_id", id),
    supabase
      .from("campaign_labels")
      .select("label_id", { count: "exact", head: true })
      .eq("label_id", id),
  ]);

  if ((formCount ?? 0) > 0 || (campaignCount ?? 0) > 0) {
    const parts: string[] = [];
    if (formCount) parts.push(`${formCount} form${formCount === 1 ? "" : "s"}`);
    if (campaignCount)
      parts.push(`${campaignCount} campaign${campaignCount === 1 ? "" : "s"}`);
    return NextResponse.json(
      {
        error: `This label is used by ${parts.join(
          " and "
        )} — hide it instead, or detach it there first.`,
      },
      { status: 409 }
    );
  }

  const { error } = await deleteLabel(supabase, id);
  if (error) {
    // Fallback: a RESTRICT foreign key we didn't pre-check.
    if ((error as { code?: string }).code === "23503") {
      return NextResponse.json(
        { error: "This label is still referenced elsewhere — hide it instead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidateLabelsCache();
  return NextResponse.json({ success: true });
}
