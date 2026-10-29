import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentConsentAgreement,
  recordConsent,
  asConsentKind,
  getUserAcceptance,
} from "@/services/consent";

// GET /api/consent?kind=privacy|child_protection|nda — the current agreement
// for a policy kind (defaults to privacy). Backs the onboarding fetch and any
// "current version" lookup.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const kind = asConsentKind(searchParams.get("kind"));
  const { data, error } = await getCurrentConsentAgreement(supabase, kind);
  if (error || !data) {
    return NextResponse.json({ error: "Agreement not found" }, { status: 404 });
  }
  return NextResponse.json({ agreement: data });
}

// POST /api/consent — record an acceptance. Body: { kind?, agreement_version,
// source }. Validates the version against the current agreement for that kind.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { agreement_version, source } = body;
  const kind = asConsentKind(body.kind);

  if (!source || (source !== "onboarding" && source !== "application")) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }

  // Validate version matches the current published agreement FOR THIS KIND.
  const { data: current } = await getCurrentConsentAgreement(supabase, kind);
  if (!current) {
    return NextResponse.json(
      { error: "Consent agreement is not configured" },
      { status: 500 }
    );
  }
  if (!agreement_version || agreement_version !== current.version) {
    return NextResponse.json(
      { error: "Agreement version mismatch. Please reload the page." },
      { status: 400 }
    );
  }

  // Idempotent: already signed this exact version → report the existing
  // signature instead of adding a duplicate. Makes "Try again" after a
  // timed-out save safe.
  const { data: existing } = await getUserAcceptance(
    supabase,
    user.id,
    agreement_version
  );
  if (existing) {
    return NextResponse.json({
      success: true,
      version: agreement_version,
      accepted_at: existing.accepted_at,
      alreadyAccepted: true,
    });
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  const userAgent = request.headers.get("user-agent");

  const { data: record, error } = await recordConsent(supabase, {
    agreement_version,
    source,
    user_id: user.id,
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    version: agreement_version,
    accepted_at: record?.accepted_at ?? null,
  });
}
