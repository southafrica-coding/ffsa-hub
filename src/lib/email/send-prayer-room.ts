// Prayer Room transactional email dispatcher.
// Mirrors send-staff-assignment.ts: transactional system email goes through
// Resend, and every send is wrapped so a mail failure never breaks the action.

import { prayerRoomInviteEmailHtml } from "./templates/prayer-room-invite";
import { prayerRoomInviteAcceptedEmailHtml } from "./templates/prayer-room-invite-accepted";
import { prayerRoomApplicationReceivedEmailHtml } from "./templates/prayer-room-application-received";
import { prayerRoomEvaluatorAssignedEmailHtml } from "./templates/prayer-room-evaluator-assigned";
import { prayerRoomDecisionEmailHtml } from "./templates/prayer-room-decision";
import { getResend } from "@/lib/email/resend";

const FROM = `Fire & Fragrance SA <${(process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim()}>`;
const SITE = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://ffsahub.com";

const ROLE_LABELS: Record<string, string> = {
  worship_leader: "Worship Leader",
  vocals: "Vocals / BGV",
  instrument: "Instrument",
  prayer_leader: "Prayer Leader",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sun 22 Jun · 06:00–08:00" from a YYYY-MM-DD date + HH:MM(:SS) times. */
export function formatSetWhen(setDate: string, startTime: string, endTime: string): string {
  const d = new Date(setDate + "T00:00:00");
  const day = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const hm = (t: string) => t.slice(0, 5);
  return `${day} · ${hm(startTime)}–${hm(endTime)}`;
}

function firstNameOf(p?: { first_name?: string | null; preferred_name?: string | null } | null): string {
  return p?.preferred_name || p?.first_name || "there";
}

function fullName(p?: { first_name?: string | null; last_name?: string | null; preferred_name?: string | null } | null): string {
  if (!p) return "Someone";
  const first = p.preferred_name || p.first_name || "";
  return `${first} ${p.last_name || ""}`.trim() || "Someone";
}

type Person = { email?: string | null; first_name?: string | null; last_name?: string | null; preferred_name?: string | null };

export async function sendPrayerRoomInvite(opts: {
  invitee: Person;
  owner: Person;
  role: string;
  setTitle: string;
  setDate: string;
  startTime: string;
  endTime: string;
}) {
  if (!opts.invitee.email) return;
  try {
    await getResend().emails.send({
      from: FROM,
      to: opts.invitee.email,
      subject: `You're invited to a devo set — ${roleLabel(opts.role)}`,
      html: prayerRoomInviteEmailHtml({
        inviteeFirstName: firstNameOf(opts.invitee),
        roleLabel: roleLabel(opts.role),
        setWhen: formatSetWhen(opts.setDate, opts.startTime, opts.endTime),
        setTitle: opts.setTitle || "Devo set",
        ownerName: fullName(opts.owner),
        siteUrl: SITE,
      }),
    });
  } catch {
    console.error("[prayer-room] invite email failed");
  }
}

export async function sendPrayerRoomInviteAccepted(opts: {
  owner: Person;
  accepter: Person;
  role: string;
  setTitle: string;
  setDate: string;
  startTime: string;
  endTime: string;
}) {
  if (!opts.owner.email) return;
  try {
    await getResend().emails.send({
      from: FROM,
      to: opts.owner.email,
      subject: `${fullName(opts.accepter)} accepted your devo set invite`,
      html: prayerRoomInviteAcceptedEmailHtml({
        ownerFirstName: firstNameOf(opts.owner),
        accepterName: fullName(opts.accepter),
        roleLabel: roleLabel(opts.role),
        setWhen: formatSetWhen(opts.setDate, opts.startTime, opts.endTime),
        setTitle: opts.setTitle || "Devo set",
        siteUrl: SITE,
      }),
    });
  } catch {
    console.error("[prayer-room] invite-accepted email failed");
  }
}

export async function sendPrayerRoomApplicationReceived(applicant: Person) {
  if (!applicant.email) return;
  try {
    await getResend().emails.send({
      from: FROM,
      to: applicant.email,
      subject: "We've received your prayer room application",
      html: prayerRoomApplicationReceivedEmailHtml({
        applicantFirstName: firstNameOf(applicant),
        siteUrl: SITE,
      }),
    });
  } catch {
    console.error("[prayer-room] application-received email failed");
  }
}

export async function sendPrayerRoomEvaluatorAssigned(opts: {
  evaluator: Person;
  applicant: Person;
  skills: string[];
}) {
  if (!opts.evaluator.email) return;
  try {
    await getResend().emails.send({
      from: FROM,
      to: opts.evaluator.email,
      subject: `Please evaluate ${fullName(opts.applicant)} for the prayer room`,
      html: prayerRoomEvaluatorAssignedEmailHtml({
        evaluatorFirstName: firstNameOf(opts.evaluator),
        applicantName: fullName(opts.applicant),
        skillsLine: opts.skills.join(", "),
        siteUrl: SITE,
      }),
    });
  } catch {
    console.error("[prayer-room] evaluator-assigned email failed");
  }
}

export async function sendPrayerRoomDecision(opts: {
  applicant: Person;
  approved: boolean;
  note?: string | null;
}) {
  if (!opts.applicant.email) return;
  try {
    await getResend().emails.send({
      from: FROM,
      to: opts.applicant.email,
      subject: opts.approved
        ? "You're approved for the prayer room team"
        : "An update on your prayer room application",
      html: prayerRoomDecisionEmailHtml({
        applicantFirstName: firstNameOf(opts.applicant),
        approved: opts.approved,
        note: opts.note,
        siteUrl: SITE,
      }),
    });
  } catch {
    console.error("[prayer-room] decision email failed");
  }
}
