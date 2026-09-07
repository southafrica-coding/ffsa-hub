import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsSuperAdmin } from "@/lib/auth/check-role-grant";
import { ALL_MODULES, UNGATEABLE_MODULE_IDS } from "@/config/modules";

// Super-admin-only switch for module rollout state (migration 207).

const VALID = ["live", "beta", "hidden"] as const;
type Visibility = (typeof VALID)[number];

// POST /api/admin/module-visibility  { key, visibility?, note? }
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await callerIsSuperAdmin(supabase, user.id))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const key = body?.key;

  // Only accept ids that exist in code — this table drives what the whole Hub
  // can see, so it should not accumulate typo'd keys that quietly do nothing.
  if (typeof key !== "string" || !ALL_MODULES.some((m) => m.id === key)) {
    return NextResponse.json({ error: "Unknown module" }, { status: 400 });
  }

  if (UNGATEABLE_MODULE_IDS.has(key)) {
    return NextResponse.json(
      { error: "This module can't be switched off — it's how you switch the others back on." },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = { key, updated_by: user.id, updated_at: new Date().toISOString() };

  if (body.visibility !== undefined) {
    if (!VALID.includes(body.visibility as Visibility)) {
      return NextResponse.json({ error: "Bad visibility" }, { status: 400 });
    }
    patch.visibility = body.visibility;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== "string" || body.note.length > 500) {
      return NextResponse.json({ error: "Bad note" }, { status: 400 });
    }
    patch.note = body.note.trim() || null;
  }

  // module_visibility postdates the generated Database types, so the admin
  // client is widened here — the same pattern the OKR services use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin
    .from("module_visibility")
    .upsert(patch, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
