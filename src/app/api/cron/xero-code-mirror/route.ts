import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncXeroMirror } from "@/lib/finance/xero-mirror-sync";

export const maxDuration = 60;

// GET /api/cron/xero-code-mirror — daily Vercel cron (02:30 UTC = 04:30 SAST).
//
// Mirrors both Xero files (chart of accounts, tracking categories and
// options, items) and keeps finance projects in step with each org's
// Ministries options (migrations 275, 290, 291). Read-only toward Xero.
//
// DAILY, not every 15 minutes: this project is on Vercel Hobby, where any
// sub-daily cron fails the whole production build (see check-sending-domains).
// The Hub still stays current without anyone pressing a button: finance
// pages that show this data refresh it whenever it is over 5 minutes old,
// and reconnecting an organisation syncs it straight away. This cron is the
// backstop for days nobody opens those pages.
//
// Auth mirrors the other crons: `Authorization: Bearer ${CRON_SECRET}`.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await syncXeroMirror(createAdminClient(), { trigger: "cron" });
  for (const r of results) {
    if (r.status === "failed" || r.status === "partial") {
      console.error("[cron/xero-code-mirror]", r.region, r.status, r.error ?? "");
    }
  }
  return NextResponse.json({
    results: results.map((r) => ({ region: r.region, status: r.status, error: r.error ?? null, counts: r.counts ?? null })),
  });
}
