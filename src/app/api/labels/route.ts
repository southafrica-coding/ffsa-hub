import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateLabel } from "@/services/labels";
import { revalidateLabelsCache } from "@/lib/cached-reads";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

// Standalone label creation (no contact attachment). Used by the workflow
// builder's inline "+ New label" control and the communications labels page.
// Idempotent on slug — re-posting the same name returns the existing label
// rather than erroring.
//
// Same write gate as PATCH/DELETE on /api/labels/[id]: comms_admin, admin,
// and super_admin, or the communications.manage_labels grant (migration 142
// — create / rename / delete). A signed-in caller without that gate is 403.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id, ["communications.manage_labels"]))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { name?: string; category?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const slug = slugify(name);
  if (!slug) {
    return NextResponse.json({ error: "name produces an empty slug" }, { status: 400 });
  }

  const found = await findOrCreateLabel(supabase, {
    slug,
    name,
    createdBy: user.id,
    category: body.category ?? null,
  });

  if (found.error || !found.data) {
    return NextResponse.json({ error: "Failed to create label" }, { status: 500 });
  }

  revalidateLabelsCache();

  return NextResponse.json({
    id: found.data.id,
    name: found.data.name,
    slug: found.data.slug,
  });
}
