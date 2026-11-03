import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import { deletionContactEmail } from "@/lib/account-deletion/config";
import {
  notifyAdminsOfCancel,
  notifyAdminsOfRequest,
  sendDeletionConfirmation,
} from "@/lib/account-deletion/notify";
import type { DeletionPerson } from "@/lib/account-deletion/emails";
import {
  cancelDeletionRequest,
  getOpenDeletionRequest,
  getRequesterProfile,
  insertDeletionRequest,
  isMissingTableError,
  isUniqueViolation,
  type DeletionRequestRow,
} from "@/services/account-deletion";

// ────────────────────────────────────────────────────────────
// /api/account/deletion-request: the CALLER asks for their own account to be
// deleted (Apple 5.1.1(v), Google Play account deletion). Used by the phone
// app (bearer) and /legal/delete-account (cookie).
//
// It never deletes anything. It records the request and emails the people
// who can act on it (admins, or ACCOUNT_DELETION_NOTIFY_EMAIL); an admin then
// deletes the user with the existing Users tooling. It never takes a user id:
// every query is for auth.uid(), on the caller's RLS client.
//
// Migration 289 (account_deletion_requests) may not be applied yet:
//   POST   → the emails still go out; 202 {recorded:false, notified:true}.
//            If no admin could be emailed either: 503 with the contact address.
//   GET    → {request:null}
//   DELETE → 409 "contact the office"
// ────────────────────────────────────────────────────────────

const NO_STORE = { "Cache-Control": "no-store" };

const postSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(1000, "Please keep the reason under 1000 characters.")
    .nullish()
    .transform((v) => (v ? v : null)),
  confirm: z.literal(true, { error: "Please confirm that you want your account deleted." }),
  source: z.enum(["app", "web"]).optional(),
});

// Five requests an hour per person is plenty for a real person (request,
// cancel, change their mind) and stops a loop from flooding admin inboxes.
const RATE_LIMIT = { limit: 5, windowSeconds: 60 * 60 };

function toRequest(row: DeletionRequestRow) {
  return { id: row.id, status: row.status, reason: row.reason, requestedAt: row.requested_at };
}

function notAuthenticated() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

function serverError(contactEmail: string) {
  return NextResponse.json(
    {
      error: `Something went wrong on our side. Please try again, or email ${contactEmail}.`,
      contactEmail,
    },
    { status: 500 }
  );
}

async function loadPerson(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string | null }
): Promise<DeletionPerson> {
  const { data } = await getRequesterProfile(supabase, user.id);
  const row = (data ?? {}) as {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    display_name?: string | null;
  };
  const email = row.email || user.email || null;
  const name =
    row.display_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    email ||
    "A Hub user";
  return { userId: user.id, name, email };
}

// GET: the caller's open request, or null.
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  const contactEmail = deletionContactEmail();

  const { data, error } = await getOpenDeletionRequest(supabase, user.id);
  if (error && !isMissingTableError(error)) {
    console.error("[account-deletion] read failed", error);
    return serverError(contactEmail);
  }
  return NextResponse.json(
    { request: data && !error ? toRequest(data as DeletionRequestRow) : null, contactEmail },
    { headers: NO_STORE }
  );
}

// POST {reason?, confirm: true, source?}: file a request for the caller.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  const contactEmail = deletionContactEmail();

  const raw = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { reason } = parsed.data;
  const source = parsed.data.source ?? "web";

  const limit = await getRateLimiter().hit(`account-deletion:${user.id}`, RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "You've tried this a few times already. Please wait an hour and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit)) } }
    );
  }

  // Idempotent: an open request already exists → hand it back, send nothing.
  const existing = await getOpenDeletionRequest(supabase, user.id);
  let tableMissing = isMissingTableError(existing.error);
  if (existing.error && !tableMissing) {
    console.error("[account-deletion] read failed", existing.error);
    return serverError(contactEmail);
  }
  if (existing.data) {
    return NextResponse.json(
      { request: toRequest(existing.data as DeletionRequestRow), recorded: true, alreadyRequested: true, contactEmail },
      { status: 200, headers: NO_STORE }
    );
  }

  const person = await loadPerson(supabase, user);
  let row: DeletionRequestRow | null = null;

  if (!tableMissing) {
    const inserted = await insertDeletionRequest(supabase, {
      user_id: user.id,
      email: person.email,
      full_name: person.name,
      reason,
      source,
    });
    if (isUniqueViolation(inserted.error)) {
      // Two taps at once: the other one won. Return it.
      const again = await getOpenDeletionRequest(supabase, user.id);
      if (again.data) {
        return NextResponse.json(
          { request: toRequest(again.data as DeletionRequestRow), recorded: true, alreadyRequested: true, contactEmail },
          { status: 200, headers: NO_STORE }
        );
      }
      console.error("[account-deletion] unique clash but no open row", again.error);
      return serverError(contactEmail);
    }
    if (isMissingTableError(inserted.error)) {
      tableMissing = true;
    } else if (inserted.error || !inserted.data) {
      console.error("[account-deletion] insert failed", inserted.error);
      return serverError(contactEmail);
    } else {
      row = inserted.data as DeletionRequestRow;
    }
  }

  const requestedAt = row?.requested_at ?? new Date().toISOString();
  const { sent } = await notifyAdminsOfRequest({ person, reason, requestedAt, source, recorded: !!row });
  const notified = sent > 0;

  if (!row && !notified) {
    // Neither saved nor sent: nobody knows. Say so, with a way forward.
    return NextResponse.json(
      {
        error: `We couldn't send your request just now. Please email ${contactEmail} and ask for your account to be deleted.`,
        contactEmail,
      },
      { status: 503, headers: NO_STORE }
    );
  }
  if (!notified) {
    console.error("[account-deletion] request saved but no admin was emailed", row?.id);
  }

  const confirmationSent = await sendDeletionConfirmation({ person, requestedAt });

  const requestBody = row
    ? toRequest(row)
    : { id: null, status: "open" as const, reason, requestedAt };
  return NextResponse.json(
    { request: requestBody, recorded: !!row, notified, confirmationSent, contactEmail },
    { status: row ? 201 : 202, headers: NO_STORE }
  );
}

// DELETE: the caller cancels their own open request.
export async function DELETE() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  const contactEmail = deletionContactEmail();

  const existing = await getOpenDeletionRequest(supabase, user.id);
  if (isMissingTableError(existing.error)) {
    return NextResponse.json(
      {
        error: `We can't cancel this here yet. Please email ${contactEmail} and say you want to keep your account.`,
        contactEmail,
      },
      { status: 409 }
    );
  }
  if (existing.error) {
    console.error("[account-deletion] read failed", existing.error);
    return serverError(contactEmail);
  }
  if (!existing.data) {
    return NextResponse.json(
      { error: "You don't have an open request to cancel." },
      { status: 404 }
    );
  }

  const open = existing.data as DeletionRequestRow;
  const { data, error } = await cancelDeletionRequest(supabase, user.id, open.id);
  if (error || !data) {
    console.error("[account-deletion] cancel failed", error);
    return serverError(contactEmail);
  }

  const person = await loadPerson(supabase, user);
  await notifyAdminsOfCancel(person);

  return NextResponse.json({ request: null, cancelled: true, contactEmail }, { headers: NO_STORE });
}
