/**
 * Per-event ticketing-report subscription for the calling user.
 *
 *   GET  → the caller's subscription for this event, or sensible defaults
 *          (defaulting destinations from the user's account email/phone).
 *   PUT  → upsert the caller's subscription (validated).
 *
 * Rows are self-scoped by RLS (migration 111). This route additionally gates
 * on canAccessEventReports so only event managers can subscribe at all.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canAccessEventReports } from "@/lib/api-auth";
import { normalizePhoneE164 } from "@/lib/phone";

const VALID_CADENCE = new Set(["daily", "weekly"]);

type SubRow = {
  enabled: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  cadence: string;
  weekly_weekday: number;
  send_hour_utc: number;
  dest_email: string | null;
  dest_whatsapp: string | null;
  last_sent_at: string | null;
  last_status: string | null;
};

function mapRow(row: Record<string, unknown> | null): SubRow | null {
  if (!row) return null;
  return {
    enabled: Boolean(row.enabled),
    email_enabled: Boolean(row.email_enabled),
    whatsapp_enabled: Boolean(row.whatsapp_enabled),
    cadence: String(row.cadence ?? "daily"),
    weekly_weekday: Number(row.weekly_weekday ?? 1),
    send_hour_utc: Number(row.send_hour_utc ?? 6),
    dest_email: (row.dest_email as string | null) ?? null,
    dest_whatsapp: (row.dest_whatsapp as string | null) ?? null,
    last_sent_at: (row.last_sent_at as string | null) ?? null,
    last_status: (row.last_status as string | null) ?? null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canAccessEventReports(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const [{ data: account }, { data: row }] = await Promise.all([
    supabase.from("users").select("email, phone").eq("id", user.id).maybeSingle(),
    supabase
      .from("event_report_subscriptions")
      .select("*")
      .eq("event_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const accountEmail = (account?.email as string | null) ?? null;
  const accountPhone = (account?.phone as string | null) ?? null;
  const existing = mapRow(row as Record<string, unknown> | null);

  const subscription: SubRow =
    existing ?? {
      enabled: false,
      email_enabled: true,
      whatsapp_enabled: false,
      cadence: "daily",
      weekly_weekday: 1,
      send_hour_utc: 6,
      dest_email: accountEmail,
      dest_whatsapp: normalizePhoneE164(accountPhone) ?? "",
      last_sent_at: null,
      last_status: null,
    };

  return NextResponse.json({
    exists: Boolean(existing),
    subscription,
    account: { email: accountEmail, phone: accountPhone },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canAccessEventReports(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const enabled = Boolean(body.enabled);
  const emailEnabled = Boolean(body.email_enabled);
  const whatsappEnabled = Boolean(body.whatsapp_enabled);
  const cadence = String(body.cadence ?? "daily");
  const weekday = Number(body.weekly_weekday ?? 1);
  const hour = Number(body.send_hour_utc ?? 6);
  const destEmailRaw = (body.dest_email as string | null) ?? null;
  const destWhatsappRaw = (body.dest_whatsapp as string | null) ?? null;

  // ── Validation ──────────────────────────────────────────────
  if (!VALID_CADENCE.has(cadence)) {
    return NextResponse.json({ error: "Invalid cadence" }, { status: 400 });
  }
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return NextResponse.json({ error: "Invalid weekday" }, { status: 400 });
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return NextResponse.json({ error: "Invalid send hour" }, { status: 400 });
  }
  if (!emailEnabled && !whatsappEnabled) {
    return NextResponse.json(
      { error: "Choose at least one channel (email or WhatsApp)." },
      { status: 400 }
    );
  }

  let destEmail: string | null = destEmailRaw ? destEmailRaw.trim() : null;
  if (emailEnabled) {
    if (!destEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destEmail)) {
      return NextResponse.json(
        { error: "A valid email address is required for the email channel." },
        { status: 400 }
      );
    }
  } else {
    destEmail = destEmail || null;
  }

  let destWhatsapp: string | null = null;
  if (whatsappEnabled) {
    destWhatsapp = normalizePhoneE164(destWhatsappRaw);
    if (!destWhatsapp) {
      return NextResponse.json(
        {
          error:
            "A valid phone number (e.g. +27821234567) is required for WhatsApp.",
        },
        { status: 400 }
      );
    }
  } else if (destWhatsappRaw) {
    // Keep a normalised copy even when WhatsApp is off, so toggling it back on
    // doesn't lose the number.
    destWhatsapp = normalizePhoneE164(destWhatsappRaw);
  }

  const { data: saved, error } = await supabase
    .from("event_report_subscriptions")
    .upsert(
      {
        event_id: id,
        user_id: user.id,
        enabled,
        email_enabled: emailEnabled,
        whatsapp_enabled: whatsappEnabled,
        cadence,
        weekly_weekday: weekday,
        send_hour_utc: hour,
        dest_email: destEmail,
        dest_whatsapp: destWhatsapp,
      },
      { onConflict: "event_id,user_id" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, subscription: mapRow(saved) });
}
