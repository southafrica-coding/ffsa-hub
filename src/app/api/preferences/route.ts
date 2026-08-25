import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrefsToken } from "@/lib/tokens/unsubscribe";
import {
  recordConsentEvent,
  evidenceFromRequest,
} from "@/lib/consent/record";

// POST /api/preferences — public, token-authorized.
// Body: { token, keepLabelIds: string[] }  — labels NOT kept get unsubscribed.
//   or  { token, all: true }               — global opt-out.
export async function POST(request: Request) {
  let body: { token?: string; keepLabelIds?: string[]; all?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const v = verifyPrefsToken(body.token);
  if (!v.valid || !v.contactId) {
    return NextResponse.json(
      { error: `This link is ${v.reason ?? "invalid"}` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  if (body.all) {
    await admin.from("unsubscribes").upsert(
      {
        contact_id: v.contactId,
        label_id: null,
        source: "preferences_page",
        reason: "unsubscribed from all via preferences",
      },
      { onConflict: "contact_id", ignoreDuplicates: true }
    );
    await admin.from("activity_events").insert({
      contact_id: v.contactId,
      event_type: "email_unsubscribed",
      related_campaign_id: v.campaignId ?? null,
      payload: { scope: "all", source: "preferences_page" },
    });
    // The evidenced record beside the operational one (migration 187).
    await recordConsentEvent(admin, {
      contactId: v.contactId,
      kind: "unsubscribed",
      source: "preferences_page",
      labelId: null,
      evidence: {
        ...evidenceFromRequest(request),
        campaignId: v.campaignId ?? null,
      },
    });
    return NextResponse.json({ ok: true, scope: "all" });
  }

  const keep = new Set(body.keepLabelIds ?? []);

  const { data: current } = await admin
    .from("contact_labels")
    .select("label_id")
    .eq("contact_id", v.contactId);

  const toRemove = (current ?? [])
    .map((r: { label_id: string }) => r.label_id)
    .filter((id: string) => !keep.has(id));

  for (const labelId of toRemove) {
    await admin.from("unsubscribes").upsert(
      {
        contact_id: v.contactId,
        label_id: labelId,
        source: "preferences_page",
        reason: "updated email preferences",
      },
      { onConflict: "contact_id,label_id", ignoreDuplicates: true }
    );
    await admin.from("activity_events").insert({
      contact_id: v.contactId,
      event_type: "email_unsubscribed",
      related_label_id: labelId,
      related_campaign_id: v.campaignId ?? null,
      payload: { scope: "label", source: "preferences_page" },
    });
    await recordConsentEvent(admin, {
      contactId: v.contactId,
      kind: "muted_topic",
      source: "preferences_page",
      labelId,
      evidence: {
        ...evidenceFromRequest(request),
        campaignId: v.campaignId ?? null,
      },
    });
  }

  return NextResponse.json({ ok: true, removed: toRemove.length });
}
