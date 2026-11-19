import { NextResponse } from "next/server";
import { legalGate } from "@/lib/legal/api";
import { loadReminder } from "@/lib/legal/reminder-data";
import { todayInSA } from "@/lib/legal/status";

// GET /api/dashboard/legal-documents — the dashboard card. Same lines as the
// 07:00 email (today's milestones first, then everything else open), read
// as the user, so RLS decides. Not on the access list: 403, and the card
// hides itself.
export async function GET() {
  const gate = await legalGate();
  if (gate.error) return gate.error;
  try {
    const r = await loadReminder(gate.supabase, todayInSA());
    return NextResponse.json({
      counts: r.counts,
      lines: [...r.today, ...r.open].slice(0, 6),
      more: Math.max(0, r.today.length + r.open.length - 6),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
