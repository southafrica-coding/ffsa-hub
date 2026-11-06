import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditFinanceProjects, canReadFinanceXero } from "@/lib/finance/orgs";
import { XERO_MIRROR_MAX_AGE_MS, XERO_REGIONS, syncXeroMirror } from "@/lib/finance/xero-mirror-sync";
import type { XeroRegion } from "@/services/xero";

export const maxDuration = 60;

// POST /api/finance/xero/sync { mode?: "if_stale" | "now", region?: "za" | "us" }
//
// Brings the Hub's copy of Xero (accounts, tracking options, items, projects)
// up to date. Read-only toward Xero.
//
//   if_stale (default) — what finance pages call on their own when they open:
//     syncs a region only if its last attempt is over 5 minutes old. Anyone
//     who can read the Xero lists may ask (it never runs more often than that).
//   now — the optional "Sync now" button: skips the 5-minute wait. Finance
//     editors only (admin / finance_admin / finance.edit).
//
// Either way a region already syncing is not started twice (migration 291).
// The work runs with the service role; the caller's session only decides
// whether they may ask. The daily cron uses /api/cron/xero-code-mirror.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { mode?: unknown; region?: unknown } = {};
  const text = await request.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode ?? "if_stale";
  if (mode !== "if_stale" && mode !== "now") {
    return NextResponse.json({ error: "mode must be if_stale or now" }, { status: 400 });
  }
  if (body.region !== undefined && !XERO_REGIONS.includes(body.region as XeroRegion)) {
    return NextResponse.json({ error: "region must be za or us" }, { status: 400 });
  }

  const allowed =
    mode === "now"
      ? await canEditFinanceProjects(supabase, user.id)
      : await canReadFinanceXero(supabase, user.id);
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          mode === "now"
            ? "You don't have permission to sync from Xero"
            : "You don't have permission to see finance data from Xero",
      },
      { status: 403 }
    );
  }

  const results = await syncXeroMirror(createAdminClient(), {
    regions: body.region ? [body.region as XeroRegion] : XERO_REGIONS,
    trigger: mode === "now" ? "manual" : "view",
    startedBy: user.id,
    maxAgeMs: mode === "now" ? undefined : XERO_MIRROR_MAX_AGE_MS,
  });

  // Only outcomes go back: counts and Xero data stay server-side.
  return NextResponse.json({
    results: results.map((r) => ({ region: r.region, status: r.status, error: r.error ?? null })),
  });
}
