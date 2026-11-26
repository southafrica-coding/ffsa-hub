import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AREA_KEYS } from "@/lib/operations/areas";
import { updateSettings } from "@/services/operations";

// PATCH /api/operations/settings — Slack channel ids. Admins only (RLS).
const CHANNEL = /^[CG][A-Z0-9]{6,}$/;

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const bad = (v: string | null) => v !== null && !CHANNEL.test(v);

  const intake = clean(body.maintenance_intake_channel);
  const ops = clean(body.ops_channel);
  const areaChannels: Record<string, string> = {};
  for (const key of AREA_KEYS) {
    const v = clean(body.area_channels?.[key]);
    if (bad(v)) return NextResponse.json({ error: `${key}: a channel id looks like C0123ABCD` }, { status: 400 });
    if (v) areaChannels[key] = v;
  }
  if (bad(intake) || bad(ops)) return NextResponse.json({ error: "A channel id looks like C0123ABCD" }, { status: 400 });

  const { error } = await updateSettings(supabase, {
    maintenance_intake_channel: intake,
    ops_channel: ops,
    area_channels: areaChannels,
  });
  if (error) {
    const denied = error.code === "PGRST116" || error.code === "42501";
    return NextResponse.json({ error: denied ? "Admins only" : error.message }, { status: denied ? 403 : 500 });
  }
  return NextResponse.json({ success: true });
}
