import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveScanLink } from "@/services/event-scan-links";
import {
  checkInTicket,
  undoCheckIn,
  getDoorStats,
  searchGuests,
} from "@/services/ticket-check-in";

// The public door. Token-authorised twin of /api/events/[id]/check-in:
// same check-in rules (both call services/ticket-check-in), but the caller
// is a welcome-team volunteer with no Hub account, so the token in the URL
// is the entire credential and every response is scoped hard to the one
// event that token belongs to.

// Guessing a 24-byte token is not a realistic attack; hammering a token
// someone leaked is. The cap is generous enough that a fast door never
// trips it, tight enough that the link is not a bulk data tap.
const RATE = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 120;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hit = RATE.get(key);
  if (!hit || now > hit.resetAt) {
    RATE.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  hit.count += 1;
  return hit.count > MAX_PER_WINDOW;
}

function clientKey(request: Request, token: string): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return `${token}:${ip}`;
}

const DEAD_LINK = {
  error:
    "This scanning link is no longer active. Ask the event organiser for a current one.",
};

async function openDoor(request: Request, token: string) {
  if (rateLimited(clientKey(request, token))) {
    return {
      error: NextResponse.json(
        { error: "Too many requests. Wait a moment and try again." },
        { status: 429 }
      ),
    };
  }
  const admin = createAdminClient();
  const link = await resolveScanLink(admin, token);
  if (!link) return { error: NextResponse.json(DEAD_LINK, { status: 404 }) };
  return { admin, link };
}

// GET ?stats=1 → door tally; GET ?q=name → guest lookup.
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const door = await openDoor(request, token);
  if ("error" in door) return door.error;
  const { admin, link } = door;

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (q !== null) {
    return NextResponse.json({
      guests: await searchGuests(admin, link.event_id, q),
    });
  }
  return NextResponse.json(await getDoorStats(admin, link.event_id));
}

// POST { code, scannerName } → check in.
// POST { undo: ticketId }    → reverse a check-in.
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const door = await openDoor(request, token);
  if ("error" in door) return door.error;
  const { admin, link } = door;

  let body: { code?: string; undo?: string; scannerName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.undo) {
    const res = await undoCheckIn(admin, link.event_id, body.undo);
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 });
    return NextResponse.json({ result: "undone" });
  }

  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  // Trimmed and capped: this is free text typed by a stranger and it is
  // rendered back to staff on the attendance roster.
  const name = body.scannerName?.trim().slice(0, 60) || null;

  try {
    const outcome = await checkInTicket(admin, link.event_id, code, {
      kind: "link",
      linkId: link.id,
      name,
    });
    return NextResponse.json(outcome);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Check-in failed" },
      { status: 500 }
    );
  }
}
