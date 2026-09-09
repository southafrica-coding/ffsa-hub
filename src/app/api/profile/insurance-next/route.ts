import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isExpiryDatePast } from "@/lib/users/profile-fields";
import {
  liveInsuranceProviders,
  NO_EXPIRY_NOT_ALLOWED_ERROR,
} from "@/lib/users/insurance-write";
import { providerAllowsNoExpiry } from "@/lib/profile/options";

// Manage the caller's QUEUED (next) health-insurance policy — the successor that
// auto-takes-over the day after their current policy expires (promoted by
// /api/cron/promote-policies). Stored in the next_health_insurance_* columns on
// the user's own row; the live health_insurance_* columns are untouched here.

// PUT — set or replace the queued policy.
// Body: { provider: string, policy_number?: string|null, expiry_date: string }
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const provider = String(body.provider ?? "").trim();
  const policyNumber =
    body.policy_number == null ? null : String(body.policy_number).trim() || null;
  const expiry = String(body.expiry_date ?? "").trim();
  const noExpiry = Boolean(body.no_expiry);

  // Same validity rules as the current policy: a real provider and a future
  // expiry — mirrors src/app/api/profile/update/route.ts.
  if (provider === "" || provider.toLowerCase() === "none") {
    return NextResponse.json(
      { error: "Please select a valid health insurance provider." },
      { status: 400 }
    );
  }
  if (noExpiry) {
    // Listed medical schemes only — same rule, same enforcement point.
    const options = await liveInsuranceProviders(supabase);
    if (!providerAllowsNoExpiry(provider, options)) {
      return NextResponse.json(
        { error: NO_EXPIRY_NOT_ALLOWED_ERROR },
        { status: 400 }
      );
    }
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      return NextResponse.json(
        { error: "Please enter the date the next policy expires." },
        { status: 400 }
      );
    }
    if (isExpiryDatePast(expiry)) {
      return NextResponse.json(
        { error: "The next policy's expiry date can't be in the past." },
        { status: 400 }
      );
    }
  }

  // A successor must outlast the current policy — otherwise it would be promoted
  // already-expired. Compare against the member's live expiry date.
  // next_* / no_expiry columns aren't in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: current } = await db
    .from("users")
    .select("health_insurance_expiry_date, health_insurance_no_expiry")
    .eq("id", user.id)
    .single();

  // An open-ended current policy has no end date to hand over on, and the
  // promotion cron keys off exactly that date — a successor queued behind
  // one would wait forever. Change the current policy instead.
  if (current?.health_insurance_no_expiry === true) {
    return NextResponse.json(
      {
        error:
          "Your current policy doesn't expire, so there's nothing for a next policy to take over from. Update your current policy details instead.",
      },
      { status: 400 }
    );
  }

  const currentExpiry = current?.health_insurance_expiry_date
    ? String(current.health_insurance_expiry_date).slice(0, 10)
    : null;
  if (!noExpiry && currentExpiry && expiry <= currentExpiry) {
    return NextResponse.json(
      {
        error:
          "The next policy should expire after your current one — it takes over when the current policy ends.",
      },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {
    next_health_insurance_provider: provider,
    next_health_insurance_policy_number: policyNumber,
    next_health_insurance_expiry_date: noExpiry ? null : expiry,
    next_health_insurance_no_expiry: noExpiry,
  };
  const { error } = await supabase.from("users").update(updateData).eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE — remove the queued policy.
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const updateData: Record<string, unknown> = {
    next_health_insurance_provider: null,
    next_health_insurance_policy_number: null,
    next_health_insurance_expiry_date: null,
    next_health_insurance_no_expiry: false,
  };
  const { error } = await supabase.from("users").update(updateData).eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
