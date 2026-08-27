import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  recordConsentEvent,
  evidenceFromRequest,
} from "@/lib/consent/record";

// POST /api/public/subscribe — public, unauthenticated.
// Body: { slug, email, firstName?, lastName? }
//
// Joins one public label (migration 196). Single opt-in: submitting the form
// IS the consent, recorded with IP + user agent in consent_events beside the
// operational contact_labels row.
//
// Only labels flagged public_subscribe are joinable, so this endpoint can
// never be used to walk someone into an internal segment.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v: unknown, max = 120): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  let body: {
    slug?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = clean(body.slug, 80);
  const email = clean(body.email).toLowerCase();
  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 80);

  if (!slug) return NextResponse.json({ error: "Missing list" }, { status: 400 });
  if (!firstName) {
    return NextResponse.json(
      { error: "Please enter your first name." },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: label } = await admin
    .from("labels")
    .select("id, name")
    .eq("slug", slug)
    .eq("public_subscribe", true)
    .eq("is_active", true)
    .maybeSingle();
  if (!label) {
    return NextResponse.json(
      { error: "This sign-up link is no longer available." },
      { status: 404 }
    );
  }

  // Existing contact wins — never create a duplicate for someone we know.
  const { data: existing } = await admin
    .from("contacts")
    .select("id, first_name, last_name, marketing_status")
    .eq("email_normalized", email)
    .limit(1)
    .maybeSingle();

  let contactId: string;
  if (existing) {
    contactId = existing.id;
    const patch: Record<string, unknown> = {};
    // Fill blanks only; a name they typed here doesn't overwrite our record.
    if (!existing.first_name && firstName) patch.first_name = firstName;
    if (!existing.last_name && lastName) patch.last_name = lastName;
    // They just asked for email, so an earlier global opt-out or bounce
    // suppression no longer reflects their wishes.
    if (existing.marketing_status !== "subscribed") {
      patch.marketing_status = "subscribed";
    }
    if (Object.keys(patch).length > 0) {
      await admin.from("contacts").update(patch).eq("id", contactId);
    }
  } else {
    const { data: created, error } = await admin
      .from("contacts")
      .insert({
        // first_name/last_name are NOT NULL on contacts; the form requires a
        // first name, a surname is optional.
        first_name: firstName,
        last_name: lastName,
        email,
        source: "public_subscribe",
        marketing_status: "subscribed",
      })
      .select("id")
      .single();
    if (error || !created) {
      return NextResponse.json(
        { error: "Could not complete the sign-up. Please try again." },
        { status: 500 }
      );
    }
    contactId = created.id;
    await admin.from("activity_events").insert({
      contact_id: contactId,
      event_type: "contact_created",
      payload: { source: "public_subscribe", label: label.name },
    });
  }

  // Clear opt-outs BEFORE adding the label: an unsubscribes row (global or for
  // this label) would otherwise have the 046 trigger delete the contact_labels
  // row straight back out again.
  await admin
    .from("unsubscribes")
    .delete()
    .eq("contact_id", contactId)
    .or(`label_id.eq.${label.id},label_id.is.null`);

  const { error: labelErr } = await admin
    .from("contact_labels")
    .upsert(
      {
        contact_id: contactId,
        label_id: label.id,
        added_via: `subscribe:${slug}`,
      },
      { onConflict: "contact_id,label_id", ignoreDuplicates: true }
    );
  if (labelErr) {
    return NextResponse.json(
      { error: "Could not complete the sign-up. Please try again." },
      { status: 500 }
    );
  }

  await admin.from("activity_events").insert({
    contact_id: contactId,
    event_type: "label_added",
    related_label_id: label.id,
    payload: { source: "public_subscribe" },
  });

  await recordConsentEvent(admin, {
    contactId,
    kind: "opted_in",
    source: "web_form",
    labelId: label.id,
    evidence: {
      ...evidenceFromRequest(request),
      note: `Public subscribe form: ${label.name}`,
    },
  });

  return NextResponse.json({ ok: true, label: label.name });
}
