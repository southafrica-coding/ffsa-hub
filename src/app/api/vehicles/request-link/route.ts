import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess } from "@/services/vehicles";

// GET / PATCH the public vehicle-request link settings (singleton). Manager-
// gated; the public page/submit endpoint read the same row via the admin
// client. Reads/writes go through the session client (RLS allows
// vehicles.manage on vehicle_request_link_settings).

async function requireManager() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return {
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.isAdmin || access.canManage)) {
    return {
      error: NextResponse.json({ error: "Not authorized" }, { status: 403 }),
    };
  }
  return { supabase, user };
}

export async function GET() {
  const ctx = await requireManager();
  if ("error" in ctx) return ctx.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.supabase as any)
    .from("vehicle_request_link_settings")
    .select("slug, enabled, intro_note, updated_at")
    .eq("id", 1)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const ctx = await requireManager();
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    intro_note?: string | null;
  };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: ctx.user.id,
  };
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.intro_note !== undefined) {
    const note = (body.intro_note ?? "").trim();
    patch.intro_note = note.length ? note : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.supabase as any)
    .from("vehicle_request_link_settings")
    .update(patch)
    .eq("id", 1)
    .select("slug, enabled, intro_note, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
