# HUB-PLAN: bringing FFSA Fleet into the Hub as "Fleet"

Written 17 Nov 2026 on branch `vehicles-module`. Step 1 only: no Hub code has been changed.

## Decisions already made (Gideon)

1. **Native, not embedded.** The Fleet app is rebuilt in the Hub's own stack (Next.js App Router pages, Supabase tables with RLS, services, route handlers, Tailwind and the Hub's components), not served as the old HTML file with a shim. `app/ffsa-fleet.html` stays in this folder as the **reference**: same flow, same rules, same text (SPEC section 1, "Copy the flow, the rules and the content. Don't redesign them.").
2. **Hub look.** Fonts, colours and components are the Hub's ("Movement, Quiet": Roboto / Roboto Condensed / Roboto Mono, bone and black, hairline rules, no rounded corners, one yellow band per screen). The app's own fonts (Barlow Condensed, IBM Plex) and dark theme are dropped.
3. **It lives in the existing "Fleet" area** of Bookings → Vehicles (`/bookings/vehicles/fleet`, today the "Manage fleet" page). Code is named `fleet` throughout.

What doesn't change: the rules (SPEC section 6, exact), the checklist and help text, the screens and their order of work, phone-first at 390 px, one tap per point, the confirm step in Ask, and the 4–5 hours a week budget.

## What the Hub already has (and we build on)

| Already in the Hub | Where | How Fleet uses it |
|---|---|---|
| The six vehicles, same registrations as the seed | `vehicles` table (migration 103) | The one vehicle list. Fleet adds a 1:1 details table; no second list |
| Vehicle bookings with approval, drivers, payments, agreements | `vehicle_bookings` + `vehicle_booking_assignments` (103 onwards) | **Replace the app's `trips` from day one** (approved bookings = trips) |
| Collection and return handover forms with **mileage** and fuel | `vehicle_inspections` (104, 197), `/bookings/vehicles/[id]/collect` and `/return` | Handover km becomes odometer readings (SPEC 7.2) with no extra form |
| "Manage fleet" page + Slack booking alerts | `/bookings/vehicles/fleet` | Becomes Fleet → Settings |
| `vehicle_manager` role (view / approve / manage bookings) | migration 131 | Kept for bookings. No Vehicle Co-ordinator role exists yet |
| Private storage bucket for vehicle files, served by signed URLs | `vehicle-inspections` (104) | Pattern reused; Fleet gets its own private bucket |
| Slack bot ("FFSA Hub Activity"), `users.slack_user_id` per person | `src/lib/slack/*`, migrations 069 / 187 | The 07:00 reminder by DM to the role holder |
| Email through Resend with a ledger | `src/lib/email/send-transactional.ts` | The 07:00 reminder by email |
| Vercel crons (UTC), `CRON_SECRET` | `vercel.json`, `src/app/api/cron/*` | `0 5 * * *` = 07:00 Johannesburg |
| Claude (`@anthropic-ai/sdk`), a per-user daily token budget, a DB rate limiter | `src/lib/ai/assistant/*`, `src/lib/rate-limit.ts` | Ask, later |
| PDFs with `@react-pdf/renderer` | `package.json` | In-car guide, manual and Guide PDFs (replacing pdfmake from a CDN) |
| Vitest, in-memory Supabase fake | `src/lib/testing/memory-supabase.ts` | Tests for services, rules and routes |

What the Hub does **not** have: a document-style store, Supabase Realtime (no use anywhere), a Guide / What's new pattern, a global "don't send email from dev" switch, a separate test database (Vercel previews share the production database), and CI (only the Vercel build runs on a PR).

## The `window.claude.use()` contract: what replaces each part

| Part | In the Fleet app | In the Hub |
|---|---|---|
| **db** | Firestore-style collections, `set` / deep-merge `update`, where/orderBy/limit, live `onSnapshot` | Real Supabase tables (below), one service file `src/services/fleet.ts`, route handlers under `src/app/api/vehicles/fleet/*`. Server components read; client forms POST to routes. **Live:** a small client hook subscribes to Supabase Realtime on the fleet tables and calls `router.refresh()`, so every open page updates within about a second. Nested objects the app merges (`cardPrinted`, `lastService`, `condition`) become columns or jsonb fields updated explicitly, so "update keeps `cardPrinted.date` and `.sig`" holds by construction. |
| **assets** | `upload / list / delete`, served at `/_blob/<id>` | New private bucket `fleet-files`. Upload through `/api/vehicles/fleet/files` (role check, type and size check, as `api/vehicles/inspections/upload` does). Read through `/api/vehicles/fleet/files/<id>`, which checks the role and redirects to a short-lived signed URL. A `fleet_files` table keeps id, path, type, size, who, and what it belongs to. Seed file ids are kept. |
| **user** | id, name, `can('data.write')`, profiles | Supabase Auth session + Hub roles. `getFleetAccess()` next to `getVehicleAccess()`. Names from `users`. The co-ordinator's name, phone, email and Slack come from the role holder's profile (SPEC 4, 7.5). |
| **downloads** | `save({filename, data})` in the browser | PDFs rendered server-side with `@react-pdf/renderer` from a route; "Copy report text" stays a client copy. |
| **sample** (Ask) | Tool loop in the page, `/api/claude` holds the key | Later phase: `/api/vehicles/fleet/ask`. The key stays in Vercel env. The same 14 tools as server-side functions that **propose** a change; the page shows it and the user confirms before anything is written. Rate limit with `getRateLimiter()`, token budget like `ai_assistant_queries`. Off until then. |
| **dictation** | Web Speech API where present | Same browser API in a client component, hidden where missing. |
| *(localStorage)* | Inspection drafts, chat, tutorial progress per device | Drafts: kept per device in `localStorage` (they must survive with no signal in a car park) **and** saved to `fleet_inspection_drafts` when online, so a draft can be finished on another device. Tutorial progress: per user in the database (SPEC 8). |

## Data model (new tables, prefix `fleet_`)

All in new append-only migrations (schema, then RLS, then seed, the Hub's split). Every table has RLS on. Field names follow SPEC section 4; where a column is snake_case, the mapping is written down in `src/lib/fleet/mapping.ts` so the rules still read the SPEC names.

- `fleet_vehicle_details` (1:1 with `vehicles.id`): year, colour, transmission, vin, engine_no, insurer, policy_no, tracker, base, photo_file_id, fleet_status (the six SPEC statuses), status_since, licence_expiry, odometer_km, odometer_date, odo_prev jsonb, last_service jsonb, last_b2b jsonb, service_km, service_months, inspection_day, tyres, where_text, watch jsonb, condition jsonb, last_inspection / last_check / last_monthly / last_post jsonb, card_printed jsonb, notes. (Registration, name, make/model, fuel, seats stay on `vehicles`.)
- `fleet_inspections`: vehicle_id, type (pre/post/weekly/monthly/workshop), date, odometer_km (required), fuel, inspector, provider_id, booking_id, docs, results jsonb (one entry per point, with the point text at the time), walk jsonb, extra, summary, counts jsonb, mins, started_at, created_by.
- `fleet_inspection_drafts`: user_id, vehicle_id, data jsonb, updated_at.
- `fleet_workshop_visits` (the app's `records`): vehicle_id, status (booked/done), kind, date, until, provider_id, odometer_km, cost, ref, description, work jsonb, warranty_until, checked_by, files, next_date, next_km.
- `fleet_providers` (workshops): name, services, phone, phone2, email, website, address, hours, notes.
- `fleet_odometer_readings`: vehicle_id, km, date, note, source (inspection, post-trip, workshop, km-log, handover), source_id.
- `fleet_time_logs`: date, week, kind, type, vehicle_id, mins, user_id.
- `fleet_settings` (one row): days, max_per_day, budget_hours, weekly_only, checklist jsonb, notify jsonb.
- `fleet_guide_progress`: user_id, step, done_at.
- `fleet_files`: id (the 32-hex id, kept from the seed), bucket path, content_type, size, owner_type, owner_id, created_by.

**Access (RLS):** `is_admin() OR has_permission('fleet.manage')` for everything; `fleet.view` for read-only (leadership, SPEC 3, optional). Settings and checklist editing: admins, as in SPEC 3.

**Trips:** no `fleet_trips` table. The rules read approved `vehicle_bookings` (with their assigned vehicles) as trips: `from` = checkout_date, `to` = return_date. The two seeded rentals (Almera and CR-V, 19 Nov – 13 Dec) are checked against the Hub's bookings and created as bookings only if missing.

## Where the code goes

```
src/app/(admin)/bookings/vehicles/fleet/
  page.tsx                 Today (landing)
  vehicles/page.tsx        Vehicles + Needs attention
  [vehicleId]/page.tsx     Vehicle page: Overview · Condition · History · Photos · Manual
  [vehicleId]/inspect/     Inspection: step by step (default) and full list
  inspections/[id]/        Inspection detail
  calendar/  schedule/  workshops/  checklist/  guide/
  settings/                Today's "Manage fleet" list + Slack alerts, inspection days, budget, reminder
src/app/api/vehicles/fleet/...   route handlers (auth check, validate, call a service)
src/services/fleet.ts            data access only
src/lib/fleet/rules/*.ts         SPEC 6 as pure functions (ported from server/reminder.js and the app)
src/lib/fleet/content/*.json     docs/content/*.json, as-is
src/lib/fleet/reminder.ts        the 07:00 message (later phase)
scripts/fleet-import.ts          one-off seed import
```

The Bookings → Vehicles sub-navigation gets a **Fleet** link for people with `fleet.manage` or admin. A "Fleet" item in the sidebar's Bookings panel, visible only to them (via `permittedModules`, not to everyone with `vehicles.view`).

## Plan, as pull requests (each one: Guide + What's new updated, tests, checked at 390 px and desktop)

**PR 1 – Foundations** (nothing visible yet)
1. `vitest.config.ts`: exclude `vehicles-module/**` (today the Hub's `npm test` picks up `vehicles-module/test/api.test.js` and fails on it).
2. Migrations: Vehicle Co-ordinator role + `fleet.view` / `fleet.manage` permissions; the tables above with RLS; the `fleet-files` bucket; add the fleet tables to the `supabase_realtime` publication.
3. `src/lib/fleet/rules`: port `weekly`, `kmPlan`, `kmAlerts`, `vehicleAlerts`, `attentionFor`, `odoPatch`, `kmRate`, `clashList`, `alternatives`, `suggestGap`, `todayTasks` and the reminder exactly. Vitest tests for every SPEC 10 case that is a rule (1–9, 13, 14), using the seed data, with the date fixed to Tue 17 Nov 2026.
4. `src/services/fleet.ts`, `getFleetAccess()`, content files.
5. `scripts/fleet-import.ts`: providers → vehicle details (matched by registration) → workshop visits → files (ids kept) → settings and checklist. Refuses to run unless the Supabase URL is the test project's, or `--production` is passed.
6. Hub `CLAUDE.md`: the rule that every Fleet change updates the Guide and What's new.

**PR 2 – Core** (SPEC build order 1): Vehicles, Vehicle page with tabs, Inspection (step by step + full list, photos, drafts, measurements graded, N/A by model), Inspection detail, Log km, Workshops, Checklist (view + edit, sort weekly/monthly), Guide rendered from `guide-hub.json` with per-user tutorial progress.

**PR 3 – Daily work** (build order 2): Today, Schedule, Calendar (4 weeks, clashes, move buttons, 48-hour finder), time tracker, Settings (with the old Manage fleet list moved in).

At this point Fleet matches the Fleet app. **Check against SPEC 10 on the test project, side by side with the old app on the same seed data.** Then Jack merges, runs the import on production with a fresh export, and the co-ordinator switches.

**PR 4 – 07:00 reminder**: by email to the Vehicle Co-ordinator, and on Slack inside the existing 07:00 `vehicle-slack-digest` (Jack, 18 Nov: one message, not two), link to Fleet → Today; nothing sent when empty; admin preview for any date; a send guard so local and preview runs never send. Then the old Cowork task is switched off.

**PR 5 – Bookings** (SPEC 7): booked workshop visits block the vehicle in the booking calendar and in `vehicle_availability`; renter notices with a one-tap switch to a similar free vehicle (using `requester-notify.ts`); bookings within 7 days get a heads-up; handover mileage from `vehicle_inspections` saved as odometer readings.

**PR 6 – Print**: in-car guide, full manual and Guide as PDFs with `@react-pdf/renderer`.

**PR 7 – Ask** (optional): as in the contract table above.

`CLAUDE-CODE-PROMPTS.md` Steps 2–6 were written for the embed approach. Once Jack agrees, rewrite them to match PRs 1–7.

## Risks

- **It's a bigger job than the embed.** The app is about 3 700 lines; PRs 2 and 3 are most of it. The old app stays in use until PR 3 passes the side-by-side check, so nothing is lost meanwhile.
- **Rules drifting in the port.** Mitigated by porting the functions line by line and testing against the same seed data and SPEC 10 numbers; any rule that looks wrong goes to Gideon, not "fixed".
- **Phone use.** The Hub's admin layout has a mobile tab bar; every Fleet screen, especially the inspection, must still work one-handed at 390 px.
- **Offline in the yard.** Drafts stay in the browser so an inspection survives no signal; saving waits for a connection.

## Jack's answers (18 Nov 2026)

- **No staging database.** Fleet goes up as a draft PR; Jack's review team checks the migrations and applies them to the live Hub after Jack OKs it. Migrations stay additive.
- **GitHub:** ffsa-hub is public. Fork it on GBotha13 and open the draft PR from the fork into `main`; no write access needed.
- **Real data:** scrub VINs, insurer details and workshop reports from the history before pushing; seeds hold no real vehicle data. Done: `vehicles-module/seed` was removed from every Fleet commit and is ignored; it stays on Gideon's Mac only.
- **Migration numbers:** main ends at 330; 331–333 (Missio drafts) and 316–326 (Departments) are taken. Fleet is **350–353** (350 schema, 351 RLS + Realtime, 352 seed, 353 reminder log); the bookings migration (PR 5) is 354.
- **Realtime** on the fleet tables is fine, as long as 351's RLS covers them (it does: every fleet table has RLS on and policies).
- **Vehicle Coordinator:** Gideon holds the role for now, so he gets the 07:00 reminder.
- **Supabase password** shared in Slack: not used; Jack is changing it.

Later the same day:

- **Vehicle names: the Hub's win** (H1 / H2 / H3). Fleet reads `vehicles.name` and can't rename a vehicle; renaming is done in the Hub's vehicle list (Fleet → Settings). `fleet_vehicle_details.display_name` is gone.
- **Slack: one message, not two.** The Fleet reminder's sections go inside the existing 07:00 `vehicle-slack-digest`, to its alert list plus the Vehicle Coordinator. The email still goes on its own. `/api/cron/fleet-reminder` and its cron entry are removed; the digest cron runs Fleet first, and a Fleet failure never stops the bookings digest. This also settles the sender name: it's whatever the digest uses.
- **Status mapping:** Jack asked for a proposal in the PR description, to be checked in review (below).

### Status mapping (proposal for review)

Fleet's six statuses stay in `fleet_vehicle_details.fleet_status`. The Hub's `vehicles.status` decides whether a vehicle can be booked, so it should follow Fleet:

| Fleet status | Hub status | Why |
|---|---|---|
| In service | active | |
| On a trip | active | A trip is a Hub booking; the vehicle is still in the fleet. |
| Booked for workshop | active | Bookable until the visit; the visit's own dates block it (PR 5, migration 354). |
| In workshop | maintenance | Not bookable while it's there. |
| Off the road | maintenance | Not bookable, but still ours. |
| For sale | retired | Leaving the fleet. |

Fleet writes the Hub status when its status changes, never the other way. The reverse is only for the first seed (352): active → In service, maintenance → Off the road, retired → For sale. Today 352 maps retired → Off the road and maintenance → In service; it changes to this once review agrees. The sync itself comes after review.

### Review of #623 (18 Nov), and what changed

- **Calendar crash:** `bookPrefill` moved out of the client file into `calendar/model.ts`; a test now fails if any Fleet/Vehicles server file calls a function from a `"use client"` file.
- **Fake data for CI:** `src/lib/fleet/testing/fixture` replaces the real export in every test, so all Fleet tests run in CI. VINs, engine numbers, insurer, report and invoice numbers, workshop contacts, notes, costs and files are made up.
- **Grants:** 351 revokes every fleet table from PUBLIC, anon and authenticated, then gives authenticated only SELECT/INSERT/UPDATE/DELETE (no TRUNCATE); 353 the same for the reminder log. The helpers run with `search_path = ''` and anon can't execute them.
- **Re-runnable:** 350–353 use IF NOT EXISTS / DROP … IF EXISTS / ON CONFLICT, and each is one transaction. Checked by running all four twice on a local Postgres.
- **Cron:** `vehicle-slack-digest` refuses every call when `CRON_SECRET` isn't set, and compares it timing-safely (`src/lib/cron-auth.ts`).
- **Insurer:** its name is gone from the checklist, vehicle profiles and the reference app; the workshop that keeps the Kombi's service record is unnamed too.
- **Vercel preview:** not authorised (production secrets); review happens on the branch.

### Gideon, 18 Nov: messages off, no bookings carried over

- **No Fleet messages for now.** Fleet sends nothing (no reminder email, nothing in the Slack digest) unless `FLEET_MESSAGES_ENABLED=1` is set on the live site. It replaces the old opt-out `FLEET_REMINDER_DISABLED`. The old claude.ai routine "FFSA vehicle inspection reminders" is paused too. Gideon will review the messages before anything is switched on.
- **No bookings from the old app.** The import never brings in the Fleet app's trips and rentals; they're only listed. Bookings will be uploaded into the Hub separately.

Still open below: the Ask API key (9).

## What we need from Jack

1. **Agree to this plan**, including: native rebuild, Fleet under `/bookings/vehicles/fleet`, trips replaced by Hub bookings from the start.
2. **Role:** add a new **Vehicle Co-ordinator** role (one holder; gets the reminder; printed on in-car guides) with `fleet.manage` plus the booking permissions of `vehicle_manager`, or tell us to reuse `vehicle_manager`. Who holds it today? Spelling in the Hub is "Coordinator"; fine to use that.
3. **A test database.** Vercel previews share production, and there's no local Postgres. Either a second Supabase project (staging) with its URL and keys in `.env.local` and Vercel Preview, or the OK to run Supabase locally in Docker. The import never runs against production until he does it at go-live.
4. **Migration numbers:** the newest file is `328_…`, but code comments mention 342. Which number should Fleet's migrations start at?
5. **Realtime:** OK to add the fleet tables to Supabase Realtime (first use in the Hub)?
6. **Vehicle names:** the Hub calls them Hyundai H1 / H2 / H3 and VW Bus (Kombi); the app calls them H1 #1 / #2 / #3 and VW Kombi. Which names win?
7. **Vehicle status:** the Hub's `active / maintenance / retired` vs Fleet's six statuses. Proposal: Fleet's status lives in `fleet_vehicle_details`; "For sale" and "Off the road" also set the Hub status to `retired` / `maintenance` so they drop out of booking availability. OK?
8. **Later (PR 4):** whether the reminder can post from the Hub bot under the name "FFSA Fleet" (needs the `chat:write.customize` scope) or comes from "FFSA Hub Activity"; and whether it should replace or sit next to the existing `vehicle-slack-digest` (also 05:00 UTC).
9. **Later (PR 7):** OK to use the Hub's existing `ANTHROPIC_API_KEY` for Ask.
10. **Repo privacy:** confirm the Hub repo on GitHub is private before this branch is pushed (`vehicles-module/seed` holds VINs, insurer details and workshop reports).
