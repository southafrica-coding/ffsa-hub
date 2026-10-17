import { NextResponse } from "next/server";
import {
  authorizeDonorStatements,
  deliverStatement,
  dsDb,
  loadRunReview,
  loadSends,
  loadSettings,
  loadStatementImages,
  sendBlocker,
  sentKeys,
} from "@/lib/finance/donor-statements-server";
import { planSends } from "@/lib/finance/donor-statements";

// POST { donors: [key, …], resend?: true }
//   → emails those donors their statement (PDF attached), saving each PDF
//     and logging each send. Donors already sent this year are skipped
//     unless resend is set; left-out, zero-total and email-less donors are
//     always skipped. The page sends in small batches and shows progress,
//     so one request never outlives a function timeout.

export const maxDuration = 60;
const MAX_PER_REQUEST = 8;
// Resend allows ~2 requests a second; stay under it.
const GAP_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ctx = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { donors?: unknown; resend?: unknown };
  const keys = Array.isArray(body.donors) ? body.donors.map(String) : [];
  if (keys.length === 0) return NextResponse.json({ error: "Choose who to send to" }, { status: 400 });
  if (keys.length > MAX_PER_REQUEST) {
    return NextResponse.json({ error: `Send at most ${MAX_PER_REQUEST} at a time` }, { status: 400 });
  }

  const admin = dsDb();
  const [review, settings] = await Promise.all([loadRunReview(admin, runId), loadSettings(admin)]);
  if (!review) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!settings) return NextResponse.json({ error: "Settings missing" }, { status: 500 });
  const blocker = sendBlocker(settings);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 400 });

  const year = review.run.tax_year;
  const already = sentKeys(await loadSends(admin, year));
  const resend = body.resend === true;
  const { send, skipped } = planSends(review.build.donors, keys, already, { resend });

  const images = await loadStatementImages(admin, settings);
  const results: { key: string; name: string; status: string; error: string | null }[] = [];
  for (let i = 0; i < send.length; i++) {
    if (i > 0) await sleep(GAP_MS);
    const donor = send[i];
    try {
      const { row } = await deliverStatement(admin, {
        runId, year, donor, settings, images, userId: auth.user.id, channel: "email",
        isResend: already.has(donor.key),
      });
      results.push({ key: donor.key, name: donor.name, status: row.status, error: row.error });
    } catch (err) {
      results.push({ key: donor.key, name: donor.name, status: "failed", error: err instanceof Error ? err.message : "Send failed" });
    }
  }
  return NextResponse.json({ results, skipped });
}
