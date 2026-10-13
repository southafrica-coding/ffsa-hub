// When an accepted applicant gets their HUB setup link (migration 230).
//
// Students accepted months ahead shouldn't have a working HUB account long
// before they arrive, so a NEW account's setup link is held back until one
// month before the school starts — or until the date the school set on its
// Emails tab (programs.setup_invite_date), which wins. The daily cron
// /api/cron/send-setup-invites sends what's due.
//
// No start date known, or the date has already arrived → send now, exactly
// as before. Accounts that already exist are never affected.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Today as YYYY-MM-DD (UTC — the cron runs at 06:00 UTC, 08:00 SAST). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** One calendar month before a YYYY-MM-DD date, clamped to month end
 *  (31 Mar → 28/29 Feb). */
export function oneMonthBefore(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const prevMonthEnd = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 2, Math.min(d, prevMonthEnd)))
    .toISOString()
    .slice(0, 10);
}

/**
 * The date setup links go out for a program, or null when it can't be
 * worked out (no override and no dated course).
 */
export function setupInviteDateFor(program: {
  setup_invite_date?: string | null;
  start_date?: string | null;
}): string | null {
  if (program.setup_invite_date) return program.setup_invite_date;
  if (program.start_date) return oneMonthBefore(program.start_date);
  return null;
}

/**
 * The date a new account's setup link should be held until, or null to send
 * it immediately.
 */
export async function resolveSetupInviteDueDate(
  admin: Client,
  programId: string,
  today: string = todayIso()
): Promise<string | null> {
  const [{ data: program }, { data: courses }] = await Promise.all([
    admin
      .from("programs")
      .select("setup_invite_date")
      .eq("id", programId)
      .maybeSingle(),
    admin
      .from("billing_courses")
      .select("start_date")
      .eq("program_id", programId)
      .not("start_date", "is", null)
      .order("start_date", { ascending: true })
      .limit(1),
  ]);

  const due = setupInviteDateFor({
    setup_invite_date: program?.setup_invite_date ?? null,
    start_date: courses?.[0]?.start_date ?? null,
  });

  return due && due > today ? due : null;
}

/** "15 January 2027" — for emails and the admin UI. */
export function formatInviteDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
