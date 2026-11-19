import { NextResponse } from "next/server";
import { legalGate } from "@/lib/legal/api";
import { loadReminder } from "@/lib/legal/reminder-data";
import { reminderEmail, shouldSend } from "@/lib/legal/reminders";
import { isRealDate } from "@/lib/legal/reading";
import { todayInSA } from "@/lib/legal/status";

// GET /api/legal/reminder-preview[?date=YYYY-MM-DD] — the 07:00 email as it
// would go out, for anyone on the access list. Sends nothing. Built from
// what THIS person may see (RLS), which for the owner and reviewers is
// everything. ?date= shows another day, for checking the milestones.
export async function GET(request: Request) {
  const gate = await legalGate();
  if (gate.error) return gate.error;

  const asked = new URL(request.url).searchParams.get("date");
  const today = asked && isRealDate(asked) ? asked : todayInSA();
  const reminder = await loadReminder(gate.supabase, today);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const email = reminderEmail(reminder, today, appUrl);
  const goes = shouldSend(reminder, today);

  const banner = `<div style="background:#FFB801;border-bottom:1px solid #0A0A0A;padding:12px 16px;font:600 14px/1.4 Roboto,Arial,sans-serif;">
Preview only — nothing is sent from this page. For ${today}: ${
    goes ? `the email <strong>would go out</strong> with the subject “${email.subject}”.` : "<strong>no email</strong> (nothing hits a milestone today, and it isn't a Monday with anything open)."
  } Try another day with <code>?date=YYYY-MM-DD</code>.<br>${
    process.env.LEGAL_REMINDERS_ACTIVE === "1"
      ? "Reminders are <strong>switched on</strong>: this goes to the owner at 07:00."
      : "Reminders are <strong>switched off</strong>: nothing is emailed until they are activated."
  }</div>`;

  return new NextResponse(email.html.replace("<body style=\"margin:0;background:#F4F2EA;\">", `<body style="margin:0;background:#F4F2EA;">${banner}`), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
