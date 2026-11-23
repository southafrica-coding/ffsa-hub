# "Hub" — the private Slack assistant for ministry leaders

A separate Slack app, named **Hub**, that ministry leaders DM about their team's Hub access,
bookings, approvals, contacts and Hub how-to questions. It sits alongside the two existing
apps ("FFSA Hub Activity" and "Outreach Finance") and does not share their keys.

**Status: built, switched off.** Nothing happens until the steps at the bottom are done.

- Code: `src/lib/slack/assistant/hub-leader/`, routes `src/app/api/slack/assistant/{events,interactions}/route.ts`
- Slack app manifest: `docs/slack/hub-assistant-manifest.json` (unchanged by the second slice: no new scopes)
- Migrations: `supabase/migrations/392_hub_slack_assistant.sql` and `393_hub_slack_assistant_v2.sql`
  (rollbacks in `supabase/rollbacks/`)

## What it can do

In a direct message, a leader can ask it to do any of these. Each one is only allowed if the
leader could do the same thing in the Hub themselves.

**Team access (ministry leaders only)**

1. **List their team's Hub access**: everyone in the ministries they lead, with roles and permissions.
2. **Look up one person's access**: by name or email, only among people in the ministries they lead.
3. **Give or remove a Hub permission** for someone in a ministry they lead.
4. **Resend the Hub invite** to someone in a ministry they lead who hasn't set up their account.

**Hub how-to**

5. **Answer how-to questions** (`search_hub_help`), only from the help bundled in
   `knowledge.ts`: topics written from the Hub's own in-app copy, plus the Fleet Guide
   (`src/lib/fleet/content/guide-hub.json`), which is read live so it never drifts. If the help
   has no answer the bot says so and offers a problem report. The model is told never to answer
   how-to questions from memory.

**Vehicles (Rent a Vehicle)**

6. **Check vehicle availability** (`check_vehicle_availability`): free vans and cars per day, and which vehicles are free for the whole window. Needs any vehicles permission.
7. **Request a vehicle** (`request_vehicle_booking`): needs `vehicles.request`, `.approve` or `.manage` (the same `getVehicleAccess` rule as `POST /api/vehicles/bookings`). It runs the route's own checks, now shared in `src/lib/vehicles/booking-request.ts`:
   - the required fields;
   - vehicle clashes;
   - every driver's licence, against the database;
   - plus the form's "describe the purpose" rule.

   Drivers must be Hub users, because outside drivers need licence and passport photos that Slack can't take. The bot sends people to the Hub form for those. Writes go through the same insert and notifications as the route: the vehicle managers are told, and the requester gets their "submitted" Slack DM and email.
8. **List vehicle bookings** (`list_vehicle_bookings`): their own requests; everyone's only for vehicle approvers or managers (since migration 222 requesters can't see other bookings in the Hub).

**Space bookings (read-only)**

9. **List space bookings** (`list_space_bookings`) if `getBookingAccess.canView`. Creating space bookings from Slack is out of scope.

**Approvals**

10. **List pending approvals** (`list_pending_approvals`): only what this leader may approve in the Hub:
    - vehicle requests: `getVehicleAccess` `isAdmin` / `canApprove` / `canManage`, as the decision route;
    - space bookings: `getBookingAccess.canApprove`, as the decision route.
11. **Approve or decline one** (`decide_request`): an optional reason is passed to the requester, as both Hub routes allow. The bot posts an **Approve** or a red **Decline** button and Cancel. Pressing it re-checks permission and that the request is still pending, then:
    - **Vehicles** go through `decideVehicleBooking`, the same function the Hub route and the Fleet Slack buttons use. It re-checks licences and tells the requester by Slack DM and email. Then `refreshVehicleRequestAlerts` runs, so the co-ordinator's existing Slack DM shows the request as decided.
    - **Spaces** follow the single-booking branch of `POST /api/bookings/[id]/decision`: `updateBooking`, then `syncBookingAlerts` and `notifyBookingDecision`. A whole recurring series is still decided in the Hub; the bot says so.

**Contacts**

12. **Find a contact** (`find_contact`) by name, email or phone (the contacts list's own search), or open one by id.
    - The bot uses the contacts SELECT policy (migration 087): the `super_admin`, `admin`, `staff` or `events_admin` roles, or `contacts.view` / `contacts.read`.
    - `canViewContacts` also lets in `comms_admin` and `contacts_admin`. The bot leaves those out, because RLS would show them nothing on the contact page.
13. **Edit a contact's details** (`update_contact`). The bot applies the contact page's own `canEdit` check: the `super_admin`, `admin` or `events_admin` roles, or `contacts.edit` / `contacts.write`. The leader must also be able to read contacts.
    - **Fields:** the same as the Edit dialog: name, demographics and address. Emails, phones and labels can't be changed here, matching the dialog, which manages those elsewhere.
    - **Validation:**
      - values are trimmed and empty means cleared;
      - marital status and gender come from the dialog's choices;
      - date of birth must be a real date and not in the future;
      - first name can't be cleared (the column is NOT NULL);
      - only changed fields are written.
    - It goes through `updateContact`, behind a **Save** button.
    - Archive, merge, import and export are not available.

**Forms and hire gear**

14. **List Hub forms** (`list_forms`) with response counts, if `canManageHubForms` (the `/forms` page's gate).
15. **Check hire stock** (`check_hire_stock`): what the public `/hire` page shows for the dates (listed gear only, read-only). Hiring is a quote request on the public Hire page; there is no staff booking path (see Gaps).

**Problem reports**

16. **Report a problem** (`report_problem`). Before filing, the bot looks into whatever the report is about. It only reads, and only what the leader could see in the Hub:
    - **A team member** (ministry leaders, among their team): whether the account is active, has a password and has Slack linked. Also the last five emails to them from `email_messages` (category and status only), if the leader may read the email log under its SELECT policy.
    - **A vehicle booking** (their own, or any if they approve vehicles): status, dates and vehicles, plus contradictions such as approved with no vehicle, pending past its date, or return before collection. It also flags anything that would block approval: no drivers, an outside driver missing photos, or a driving test pending or failed.
    - **A space booking** (if they can see space bookings): status, venue and times, plus contradictions such as an end before its start, or pending past its date.
    - **A contact** (if they can see contacts): whether it exists, its status, and whether it has an email or phone.

    The bot tells the leader what it found and what it couldn't check, and files a ticket in `slack_assistant_tickets` with the checks as `evidence` (393), plus a short copy under the message. It **never changes anything** to fix a problem. Server error logs are not readable from inside the app, so every report says the Hub team will check those.

Every write (grant, revoke, resend, vehicle request, contact edit, approve, decline) is only
*proposed*: the bot posts it with a button (Confirm / Request vehicle / Save / Approve /
Decline) and Cancel, and nothing is written until the leader presses it within 10 minutes.
Problem reports are filed straight away; filing changes nothing else.

## What it can't do

- Anything not in the list above. It has no general data access, never writes SQL, never
  fetches a URL, and asked for something else it says so and offers to file a problem report.
- Change roles (job titles, admin tiers). Only individual permission keys.
- Change the leader's own access, or an admin's.
- Reply in channels. It is **DM-only**: @mentions and channel messages are ignored silently.
  Don't add it to public channels.

## Gaps (not built, on purpose)

| Asked for | Why not |
|---|---|
| **Leave requests** | There is no leave module in the Hub. A search of `src` and `supabase/migrations` for leave tables, routes and services found nothing; staff leave lives in Kay's Google sheet. The bot says leave isn't in the Hub. |
| **Budget / team-to-budget requests** | The Hub has no budget request or approval flow. `finance.approve` is seeded, but no code uses it; outreach closeouts are a status flow, not requests. Nothing to hook. |
| **Reading outreach budgets** | The Hub's outreach access check (`loadOutreachViewer`) runs database functions bound to the signed-in session (`auth.uid()`). The bot has no session, and re-implementing that rule outside the database would risk showing more than the Hub does. Left out. |
| **Booking hire gear as staff** | No signed-in staff path exists to book, reserve or check out gear. The equipment admin is a register, its Orders and Calendar tabs aren't built, and `equipment.request` is unused by the app. The bot offers a stock check, plus the public Hire page or a problem report. |
| **Creating space bookings** | Out of scope for this slice (read and approve only). |
| **Deciding a whole recurring series** | The Hub's `applyToSeries` path stays in the Hub; the bot decides one date at a time and says so. |
| **Outside (non-Hub) drivers** | They need licence and passport photos, which can't be attached in Slack. The bot points to the Hub form. |
| **Server error logs** | Not readable from inside the app; no Vercel or Sentry access was added. Every report notes that the Hub team checks those. |
| **Proactive "a request is waiting" DMs** | Not built. Vehicle co-ordinators already get a Slack DM per request from the FFSA Hub Activity bot, with Approve/Deny buttons. A second DM from this bot would duplicate it. The leader asks "what's waiting for me?" instead. |
| **Leadership Track "staff decisions"** | That page decides about students, not staff requests, so it isn't an approval flow for this bot. |

## Who can use it

The bot answers a Hub user whose Slack is linked (`users.slack_user_id`) and who has **at least
one active row in `staff_ministry_members` (`status = 'active'`) where any of these holds:**

- `member_role = 'leader'`: a ministry leader (this includes the ministry's point leader, whose row is a leader row with `is_point_leader`);
- `is_point_leader = true`;
- `is_category_point_leader = true`: a category (subcategory) point leader. The column is kept in step with `staff_ministry_member_subcategories.is_point_leader` by the trigger from migration 205, and it's the same flag `lib/users/derive-title.ts` reads for "{Dept} Point Leader".

Nothing else counts. `users.department` (for example `leadership_team`) is only a label, and pending memberships don't count. No new role was added.

**Team tools** (list and look up team access, grant, revoke, resend invite) are for **ministry
leaders only**: their team is the active members of the ministries where they hold an active
`leader` membership, as before. A category point leader who doesn't lead a ministry gets no
team, so they can't grant or revoke anything. They can still use every other tool their own Hub
permissions allow.

- Slack account not linked to a Hub account: *"Your Slack isn't linked to a Hub account yet.
  Link it on your Hub profile, or ask a Hub admin."*
- Linked, but none of the above: *"Sorry, this assistant is only available to ministry leaders."*

## Safety model

Every check runs on the server, on every tool call, and **again when the button is pressed**.
Nothing the model says, nothing in a message, and nothing a button carries is trusted.

| Rule | How |
|---|---|
| Who is asking | Slack signature checked with the Hub app's own signing secret; Slack user → Hub user via `users.slack_user_id`. Fixed by the server for the whole run; no tool argument or message text can change whose permissions are checked |
| Leader | `loadLeadership` (rule above), re-read on every tool call and every button press |
| Allowlist | Only the named tools run. An unknown tool name gets "That isn't something I can do." There is no SQL tool, no raw-query tool and no URL fetch; extra arguments (e.g. "as_user", "confirmed") are ignored |
| Arguments | Ids must be UUIDs, dates real ISO dates (with a maximum range), free text trimmed and capped, names matched only against lists the asker may see, contact search reduced to plain characters |
| Hub permissions | Each tool calls the Hub's own helper for the asker: `getVehicleAccess`, `getBookingAccess`, the contacts RLS-equivalent and the contact page's `canEdit`, `canManageHubForms`, the email-log policy. Refusals never say whether a record exists ("not one you can see", "not among the ones waiting for you") |
| Team | Active members of the ministries they lead. Anyone else gets the same "couldn't match that name there" as a name that doesn't exist |
| Permission changes | Only permission keys (never roles). The leader must hold the key themselves (`getEffectivePermissionKeys`), and with the same reach: an everywhere grant needs the leader to hold it everywhere; a scoped grant needs the leader to hold that exact scope |
| Blocked keys | Never from Slack, even if held: `records_library.manage`, anything in `administration.*`, `legal.access`, `imports.run`, `contacts.export`, `okrs.manage_all`, `finance.approve`, `unsubscribes.manage`. Legacy duplicate keys are hidden |
| Writes | Only through existing Hub services and checks: `booking-request.ts` (shared with the vehicles route), `decideVehicleBooking`, `updateBooking` + the route's notifications, `updateContact`, `grantPermission` / `revokePermission`, `sendSetupLink` |
| Buttons | Carry only the pending action id. Only the Slack user who asked can press them. The row is closed with a conditional update before the write, so a double click or replay does nothing. Expired or cancelled rows do nothing |
| Prompt injection | User text, DM history, contact fields, booking text and tool results are data. The prompt says so, but the guarantees don't depend on the model: the allowlist, argument checks, permission checks and buttons all live in server code. Stored values in button messages are escaped so they can't become a mention or link |
| Investigation | Read-only. No writes, no fixes, no URL fetches; only what the asker could see |
| Audit | Every executed change and problem report goes to `audit_logs` (`user_id` = the leader, `changes.source = 'slack_hub_assistant'`). Every proposal, execution, refusal, failure and cancel goes to `slack_assistant_audit_log`. Questions are logged to `slack_bot_queries` like the other bots |
| Off by default | All of these must hold: `HUB_SLACK_ASSISTANT_ENABLED` is `1`/`true`; `VERCEL_ENV=production`; not `PREVIEW_WRITES_DISABLED`; the app's token and signing secret are set. Otherwise every event is acknowledged and nothing else happens: no reply, no database write, no approval DM, no button action. Slack's `url_verification` handshake is always answered, so the app can be set up first |
| Model | Anthropic SDK, `claude-haiku-4-5-20251001` (same pin as the other Slack assistant), eight turns max within 45 seconds. If the key is missing a leader gets "not available right now"; setting names are never shown in Slack |

A Hub admin who also leads a ministry can use it. Team grants are limited to keys they hold
directly or through a role (the `admin` role carries no permission rows), so admins should keep
using the Users page for anything wider. For bookings, contacts and forms an admin gets what the
Hub gives admins.

Each DM is answered with the last few messages of that DM as context (so "the second one"
works); authorization never depends on that context.

### Before migration 393 is applied

The 392 tools keep working. The new write actions can't be set up: the pending row fails 392's
CHECK, and the leader is told to try again later. Problem reports are filed without the
`evidence` column, with the checks still copied under the message.

## Switch-on steps (Jack)

Do these in order. **Previews share the production database, so the flag stays off on Preview.**

1. **Create the Slack app.** <https://api.slack.com/apps> → *Create New App* → *From an app manifest* →
   pick the **FFSA** workspace → paste `docs/slack/hub-assistant-manifest.json`. Slack will check the
   events URL; the route answers that handshake even before the secret is set.
   - Don't distribute it and don't enable org-wide deploy (the manifest already has
     `org_deploy_enabled: false`).
2. **Install it to the FFSA workspace only** (*Install App*). If the workspace needs admin
   approval for new apps, approve it as a Slack admin. Don't invite it to any public channel.
3. **Copy two values** (don't paste them anywhere but Vercel):
   - *OAuth & Permissions* → Bot User OAuth Token (`xoxb-…`)
   - *Basic Information* → Signing Secret
4. **Vercel → Project → Settings → Environment Variables, Production only** (untick Preview and Development):
   - `SLACK_ASSISTANT_BOT_TOKEN` = the bot token
   - `SLACK_ASSISTANT_SIGNING_SECRET` = the signing secret
   - optional `SLACK_ASSISTANT_TICKET_CHANNEL_ID` = a **private** channel id (`C…`) for problem-report
     notes; invite the Hub app to that channel. Leave it unset and reports are only saved in the Hub.
   - `ANTHROPIC_API_KEY` is already set for the other assistant; check it's present in Production.
   - Don't set `HUB_SLACK_ASSISTANT_ENABLED` yet.
5. **Merge and deploy** the PR as normal.
6. **Apply migrations 392 and then 393** in the Supabase Dashboard → SQL Editor:
   1. Paste and run `supabase/migrations/392_hub_slack_assistant.sql`. Check the validation queries at the bottom return 0.
   2. Paste and run `supabase/migrations/393_hub_slack_assistant_v2.sql`. Check its validation queries: the CHECK lists seven types, and the `evidence` column exists.
   3. Regenerate types if you want them (`supabase gen types …`); the code doesn't need them.
7. **Turn it on:** add `HUB_SLACK_ASSISTANT_ENABLED=1` in Vercel, **Production only**, then redeploy
   Production so the function picks it up.
8. **Try it:** as a ministry leader whose Slack is linked on their Hub profile, open the Hub app's
   *Messages* tab in Slack and try:
   - "who's on my team?"
   - "how do I request a vehicle?"
   - "what's waiting for me to approve?"
   - "is a van free next Friday?"

   Then ask someone who isn't a leader to DM it; they should get the polite refusal.

To switch it off, remove `HUB_SLACK_ASSISTANT_ENABLED` (or set it empty) and redeploy. The tables can stay.
Rollbacks for the schema: `supabase/rollbacks/393_hub_slack_assistant_v2.sql`, then
`supabase/rollbacks/392_hub_slack_assistant.sql`.
