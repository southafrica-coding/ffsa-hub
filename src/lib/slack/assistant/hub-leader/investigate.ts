/**
 * Before a problem report is filed, look at what it's about — read-only,
 * and only what the asker could see in the Hub:
 *
 *   - a team member (ministry leaders only, among their team): account
 *     active, set up, Slack linked; and the last few emails to them from
 *     the email log, if the asker may read that log in the Hub;
 *   - a vehicle booking: their own, or any if they approve vehicles;
 *   - a space booking: if they can see space bookings;
 *   - a contact: if they can see contacts.
 *
 * Anything they can't see is "not one you can see" — the same words
 * whether or not it exists. Nothing here writes, fixes or fetches a URL.
 * Server error logs aren't readable from the app, so every report says so.
 */

import * as hub from "./hub-data";
import { getTeam, matchPerson, type Leader } from "./rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type Evidence = {
  checked_at: string;
  subjects: Record<string, string>;
  findings: string[];
  could_not_check: string[];
};

export type Subjects = {
  person?: unknown;
  user_id?: unknown;
  vehicle_booking_id?: unknown;
  space_booking_id?: unknown;
  contact_id?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
const given = (v: unknown) => typeof v === "string" && v.trim() !== "";
const today = () => new Date().toISOString().slice(0, 10);

export const NO_LOGS = "Server error logs: not readable from inside the Hub, so the Hub team will check those.";

export async function investigate(admin: Client, leader: Leader, s: Subjects): Promise<Evidence> {
  const ev: Evidence = { checked_at: new Date().toISOString(), subjects: {}, findings: [], could_not_check: [] };
  const me = leader.hubUserId;

  // ── A team member ──
  if (given(s.person) || given(s.user_id)) {
    if (leader.ministries.length === 0) {
      ev.could_not_check.push("That person: only ministry leaders can look up people, among their own team.");
    } else {
      const match = matchPerson(await getTeam(admin, leader), { person: s.person, user_id: s.user_id });
      if (match.kind !== "ok") {
        ev.could_not_check.push("That person: not someone in the ministries you lead (or more than one match).");
      } else {
        const p = match.person;
        ev.subjects.person = p.user_id;
        const acct = await hub.accountState(admin, p.user_id);
        if (acct) {
          ev.findings.push(
            `${p.name}: account ${acct.active ? "active" : "DEACTIVATED"}, ${acct.has_password ? "set up (has a password)" : "NOT set up yet (no password)"}, Slack ${acct.slack_linked ? "linked" : "not linked"}.`
          );
        }
        if (!p.email) {
          ev.findings.push(`${p.name} has no email on file.`);
        } else if (await hub.emailLogAccess(admin, me)) {
          const mails = await hub.recentEmailsTo(admin, p.email);
          if (mails.length === 0) ev.findings.push(`No emails to ${p.name} in the email log.`);
          for (const m of mails) ev.findings.push(`Email to ${p.name} (${m.category ?? "email"}) on ${m.at.slice(0, 10)}: ${m.status}${m.failed ? " — did not arrive" : ""}.`);
        } else {
          ev.could_not_check.push("Emails to that person: you can't read the email log in the Hub.");
        }
      }
    }
  }

  // ── A vehicle booking ──
  if (given(s.vehicle_booking_id)) {
    const access = await hub.vehicleAccess(admin, me);
    const bookingId = id(s.vehicle_booking_id);
    const b = bookingId && access.canView ? await hub.vehicleBooking(admin, bookingId) : null;
    const visible = b && (b.requested_by === me || access.isAdmin || access.canApprove || access.canManage);
    if (!b || !visible) {
      ev.could_not_check.push("That vehicle booking: not one you can see.");
    } else {
      ev.subjects.vehicle_booking_id = b.id;
      ev.findings.push(`Vehicle booking "${b.booking_name}": ${b.status}, ${b.checkout_date} → ${b.return_date}, vehicles: ${b.vehicles.join(", ") || "none assigned"}.`);
      if (b.return_date < b.checkout_date) ev.findings.push("Its return date is before its collection date.");
      if (b.status === "approved" && b.vehicles.length === 0) ev.findings.push("It's approved but has no vehicle assigned.");
      if (b.status === "pending" && b.checkout_date < today()) ev.findings.push("It's still pending, but the collection date has passed.");
      if (b.decision_note) ev.findings.push(`Decision note: ${b.decision_note.slice(0, 300)}`);
      const drivers = await hub.vehicleBookingDrivers(admin, b.id);
      if (drivers.length === 0) ev.findings.push("It has no drivers, so it can't be approved.");
      for (const d of drivers) {
        if (!d.user_id && (!d.has_licence_photo || !d.has_passport_photo)) {
          ev.findings.push(`Driver ${d.name} (not in the Hub) is missing ${[!d.has_licence_photo && "a licence photo", !d.has_passport_photo && "a passport photo"].filter(Boolean).join(" and ")}, so it can't be approved.`);
        }
        if (d.driving_test_status === "pending") ev.findings.push(`Driver ${d.name} still needs to pass the driving test before approval.`);
        if (d.driving_test_status === "failed") ev.findings.push(`Driver ${d.name} did not pass the driving test.`);
      }
    }
  }

  // ── A space booking ──
  if (given(s.space_booking_id)) {
    const access = await hub.bookingAccess(admin, me);
    const bookingId = id(s.space_booking_id);
    const b = bookingId && access.canView ? await hub.spaceBooking(admin, bookingId) : null;
    if (!b) {
      ev.could_not_check.push("That space booking: not one you can see.");
    } else {
      ev.subjects.space_booking_id = b.id;
      ev.findings.push(`Space booking "${b.title}": ${b.status}, ${b.venue ?? "no venue"}, ${b.booking_date}${b.end_date ? ` → ${b.end_date}` : ""} ${b.start_time ?? ""}–${b.end_time ?? ""}.`);
      if (b.end_date && b.end_date < b.booking_date) ev.findings.push("Its end date is before its start date.");
      if (!b.end_date && b.start_time && b.end_time && b.end_time <= b.start_time) ev.findings.push("Its end time is not after its start time.");
      if (b.status === "pending" && (b.end_date ?? b.booking_date) < today()) ev.findings.push("It's still pending, but its date has passed.");
    }
  }

  // ── A contact ──
  if (given(s.contact_id)) {
    const contactId = id(s.contact_id);
    const c = contactId && (await hub.contactsReadAccess(admin, me)) ? await hub.contactById(admin, contactId) : null;
    if (!c) {
      ev.could_not_check.push("That contact: not one you can see.");
    } else {
      ev.subjects.contact_id = c.id;
      ev.findings.push(`Contact ${c.name}: status ${c.status ?? "unknown"}, ${c.email ? "has an email" : "NO email"}, ${c.phone ? "has a phone" : "no phone"}.`);
    }
  }

  ev.could_not_check.push(NO_LOGS);
  return ev;
}
