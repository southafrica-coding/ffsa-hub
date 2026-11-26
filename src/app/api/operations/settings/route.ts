import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AREA_KEYS } from "@/lib/operations/areas";
import { DAY_NAMES, hoursFrom } from "@/lib/operations/maintenance";
import { updateSettings } from "@/services/operations";

// PATCH /api/operations/settings — Slack channel ids, and how maintenance
// requests work (rules, out of hours, who sets statuses). Admins only (RLS).
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

  // Maintenance requests (migration 405)
  const m = body.maintenance ?? {};
  const buttonChannel = clean(m.button_channel);
  const followupChannel = clean(m.followup_channel);
  if (bad(buttonChannel) || bad(followupChannel)) {
    return NextResponse.json({ error: "A channel id looks like C0123ABCD" }, { status: 400 });
  }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const statusUsers = Array.isArray(m.status_user_ids) ? [...new Set(m.status_user_ids.filter((v: unknown) => typeof v === "string" && UUID.test(v)))] as string[] : [];
  const rules = typeof m.rules === "string" ? m.rules.trim().slice(0, 2500) || null : null;
  const notice = typeof m.hours_notice === "string" ? m.hours_notice.trim() : "";
  if (!notice || notice.length > 500) return NextResponse.json({ error: "The out-of-hours message is needed (up to 500 characters)" }, { status: 400 });
  // Crew hours: { "1": { open, close }, … }; a day left out is closed.
  const hoursIn = m.hours && typeof m.hours === "object" && !Array.isArray(m.hours) ? m.hours : {};
  const hours = hoursFrom(hoursIn);
  for (const [d, h] of Object.entries(hoursIn as Record<string, { open?: string; close?: string } | null>)) {
    if (h && !(d in hours)) {
      return NextResponse.json({ error: `${DAY_NAMES[Number(d)] ?? "A day"}: opening must be before closing (HH:MM)` }, { status: 400 });
    }
  }

  const { error } = await updateSettings(supabase, {
    maintenance_intake_channel: intake,
    ops_channel: ops,
    area_channels: areaChannels,
    maintenance_button_channel: buttonChannel,
    maintenance_followup_channel: followupChannel,
    maintenance_status_user_ids: statusUsers,
    maintenance_rules: rules,
    maintenance_hours_notice: notice,
    maintenance_hours: hours,
  });
  if (error) {
    const denied = error.code === "PGRST116" || error.code === "42501";
    return NextResponse.json({ error: denied ? "Admins only" : error.message }, { status: denied ? 403 : 500 });
  }
  return NextResponse.json({ success: true });
}
