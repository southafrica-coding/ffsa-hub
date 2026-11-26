/**
 * What the "Hub" assistant may say about how the Hub works. The model has
 * to call search_hub_help for any how-to answer and may only pass on what
 * comes back; if nothing matches, it says so and offers a problem report.
 *
 * Written from help that already ships in the Hub: the in-app copy of the
 * booking pages and forms, the Fleet Guide (src/lib/fleet/content/
 * guide-hub.json, read live below so it never drifts), the profile's Slack
 * card, and docs/slack/hub-assistant.md. No internal design notes, no
 * settings names, no secrets. Add a topic here when the Hub gains a
 * feature people ask about — never describe something the Hub doesn't do.
 */

import guide from "@/lib/fleet/content/guide-hub.json";

export type HelpTopic = { id: string; title: string; keywords: string[]; body: string };

const CURATED: HelpTopic[] = [
  {
    id: "assistant",
    title: "What this assistant can do",
    keywords: ["assistant", "help", "can you", "what can", "bot", "hub"],
    body: [
      "In this DM I can: show your team's Hub access and give or remove a permission you hold yourself (ministry leaders only); check vehicle availability and request a vehicle; list your vehicle requests and, if you can see them in the Hub, vehicle and space bookings; show approvals waiting on you and approve or decline them; look up and edit contacts if your Hub permissions allow it; list Hub forms if you manage them; check what hire gear is free; answer how-to questions from the Hub's help; and look into a problem and file it for the Hub team.",
      "Anything that changes something waits for you to press a button. I can't do anything in Slack that you couldn't do in the Hub yourself.",
    ].join("\n"),
  },
  {
    id: "vehicle-request",
    title: "Requesting a vehicle",
    keywords: ["vehicle", "car", "van", "book", "request", "rent", "trip", "airport", "borrow", "drive"],
    body: [
      "Bookings → Rent a Vehicle → New request (/bookings/vehicles/new). You need a booking name (team or person), a point person the co-ordinator can contact, where you plan to go, collection and return dates, the purpose (describe it if you pick Other), and at least one driver. You can pick specific vehicles; ones already booked for those dates can't be chosen.",
      "The request goes to the vehicle co-ordinators for approval, and you get a confirmation on Slack and by email. Your requests and their status are under My requests (/bookings/vehicles/my-requests).",
      "I can check availability and set up a request here too, for drivers who are in the Hub. Drivers from outside the Hub need their licence and passport photos attached, so use the form in the Hub for them.",
    ].join("\n"),
  },
  {
    id: "vehicle-drivers",
    title: "Drivers, licences and the driving test",
    keywords: ["driver", "licence", "license", "passport", "expired", "driving test", "first time", "first-time"],
    body: [
      "Every driver needs a driver's licence and a passport page photo. Hub users' come from their Hub profile; for someone not in the Hub you attach them on the request.",
      "A driver's licence must be valid for the whole trip: one that has expired, or expires before the return date, can't be added.",
      "A first-time driver can be added to a request, but must pass the base-vehicle driving test before the booking is approved. The co-ordinator records the result.",
      "Approval checks every driver again, so a licence that expired while the request waited will stop it.",
    ].join("\n"),
  },
  {
    id: "vehicle-approval",
    title: "Approving vehicle requests",
    keywords: ["approve", "approval", "deny", "decline", "pending", "co-ordinator", "coordinator", "vehicle"],
    body: [
      "People with the vehicles approve or manage permission (the vehicle co-ordinators) approve or deny requests under Bookings → Rent a Vehicle → Requests, or from the Slack message they get for each new request. A reason is optional and is sent to the requester.",
      "Approval re-checks every driver's licence and needs every outside driver's licence and passport photo on the booking. The requester gets a Slack message and an email either way.",
    ].join("\n"),
  },
  {
    id: "space-bookings",
    title: "Booking a space",
    keywords: ["space", "room", "venue", "auditorium", "hall", "book", "booking", "calendar", "clash"],
    body: [
      "Bookings → Space Bookings (/bookings/spaces): see the day across every venue, spot a clash, and request or approve a space, with month, week and list views. New request is under /bookings/spaces/new and your requests under My requests.",
      "People with the bookings approve permission review requests under Requests. A recurring series can be approved or declined all at once from the Hub. Here I can approve or decline one booking at a time.",
      "I can't create space bookings from Slack. Use the Hub.",
    ].join("\n"),
  },
  {
    id: "equipment-hire",
    title: "Equipment and hiring gear",
    keywords: ["equipment", "hire", "gear", "sound", "speaker", "mic", "stage", "lighting", "quote", "kit"],
    body: [
      "Bookings → Equipment is the register of the sound, visual and stage gear FFSA owns: every unit by its tag, what can be booked and what's in for repair.",
      "Hiring is done through the public Hire page (/hire): pick the dates, choose the gear and send a quote request, or use the helper (/hire/helper) to describe the event. The rental manager replies.",
      "There's no way yet for staff to book or reserve gear inside the Hub. I can tell you what's free on the Hire page for your dates.",
    ].join("\n"),
  },
  {
    id: "slack-link",
    title: "Linking Slack to your Hub account",
    keywords: ["slack", "link", "connect", "notifications", "dm", "messages"],
    body: "Open your Hub Profile and use Connect Slack in the Slack messages section. Once linked you get Hub notifications in Slack and can use this assistant. You can mute notifications per module there too.",
  },
  {
    id: "invite-password",
    title: "Hub invites, setup links and passwords",
    keywords: ["invite", "invitation", "setup", "set up", "password", "login", "log in", "sign in", "locked out", "reset"],
    body: [
      "New people get an email invite with a setup link. If it's lost, a ministry leader can ask me to resend it (to someone in their ministry who hasn't set up their account yet), or a Hub admin can resend it from the Users page.",
      "Someone who has already set up their account and can't get in should use Forgot password on the login page.",
    ].join("\n"),
  },
  {
    id: "permissions-roles",
    title: "Permissions and roles",
    keywords: ["permission", "access", "role", "grant", "revoke", "admin", "can't see", "cannot see", "missing"],
    body: [
      "What you can see and do in the Hub comes from your roles (job-level bundles set by a Hub admin on the Users page) and individual permissions (like events.view or vehicles.request).",
      "A ministry leader can ask me to give or remove a permission for someone in a ministry they lead, but only one they hold themselves, with the same reach. Roles, and admin-only permissions, go through a Hub admin.",
      "If a page is missing for you, you probably don't have its permission. Ask your ministry leader or a Hub admin.",
    ].join("\n"),
  },
  {
    id: "contacts",
    title: "Contacts",
    keywords: ["contact", "contacts", "person", "people", "address", "edit", "details", "email", "phone", "label"],
    body: [
      "Contacts (/contacts) is the directory of everyone FFSA is in touch with. Open a contact to see their details; people who may edit contacts get an Edit button for name, demographics and address.",
      "Email addresses and phone numbers are managed under Identifiers on the contact's page, and labels in the Labels card. I can edit the same details as the Edit button (not emails, phones or labels), and only if you can in the Hub.",
    ].join("\n"),
  },
  {
    id: "forms",
    title: "Hub forms",
    keywords: ["form", "forms", "survey", "submissions", "responses", "sign up"],
    body: "Hub forms are under Forms (/forms), for Hub admins and comms admins: create a form, share its link and read the responses. Event forms live with their event. I can list forms and their response counts for people who manage them.",
  },
  {
    id: "problems",
    title: "Reporting a problem",
    keywords: ["problem", "bug", "broken", "error", "not working", "issue", "report", "wrong"],
    body: "Tell me what's wrong, with the person, booking or page it's about. I'll check what I can see (I never change anything to fix it), tell you what I found, and file it for the Hub team.",
  },
];

// ── The Fleet Guide, read live ──────────────────────────────

type GuideBlock = { h?: string; p?: string; ul?: string[] };
type GuidePage = { id: string; title: string; blocks: GuideBlock[] };

/** {tokens} are live settings in the Guide; here they're just "set in Fleet". */
const untoken = (s: string) => s.replace(/\{[a-zA-Z]+\}/g, "(set in Fleet)");

function fleetTopics(): HelpTopic[] {
  const out: HelpTopic[] = [];
  for (const page of (guide as { pages: GuidePage[] }).pages) {
    if (!["start", "how", "help"].includes(page.id)) continue;
    let title = page.title;
    let lines: string[] = [];
    const flush = () => {
      if (lines.length === 0) return;
      out.push({
        id: `fleet-${page.id}-${out.length}`,
        title: `Fleet: ${title}`,
        keywords: ["fleet", "inspection", "co-ordinator", "coordinator", ...title.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 3)],
        body: lines.map(untoken).join("\n"),
      });
      lines = [];
    };
    for (const b of page.blocks) {
      if (b.h) {
        flush();
        title = b.h;
      }
      if (b.p) lines.push(b.p);
      if (b.ul) lines.push(...b.ul.map((x) => `- ${x}`));
    }
    flush();
  }
  return out;
}

export const HELP_TOPICS: HelpTopic[] = [...CURATED, ...fleetTopics()];

const STOP = new Set(["the", "and", "how", "can", "what", "where", "when", "why", "does", "with", "for", "you", "your", "this", "that", "from", "into", "about", "have", "has", "are", "our", "who", "get", "use", "need", "want", "please", "hub"]);

/** The best few topics for a question, by keyword and word overlap. Empty if nothing fits. */
export function searchHelp(question: string, limit = 3): HelpTopic[] {
  const q = question.toLowerCase();
  const words = q.split(/[^a-z0-9-]+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (words.length === 0) return [];
  const scored = HELP_TOPICS.map((t) => {
    let score = 0;
    for (const k of t.keywords) if (q.includes(k)) score += k.includes(" ") ? 3 : 2;
    const hay = `${t.title} ${t.body}`.toLowerCase();
    for (const w of words) if (hay.includes(w)) score += 1;
    return { t, score };
  });
  return scored
    .filter((s) => s.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.t);
}
