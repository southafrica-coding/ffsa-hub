# Bringing the FFSA Fleet app into the FFSA Hub with Claude Code

The app is being **rebuilt inside the Hub, in the Hub's own way** (Next.js pages, Supabase tables, Hub login and roles, the Hub's fonts and look), in the existing **Fleet** area: Bookings → Vehicles → Fleet (`/bookings/vehicles/fleet`). The plan is `vehicles-module/HUB-PLAN.md`. The old app (`vehicles-module/app/ffsa-fleet.html`) is the reference for the rules, the checklist, the help text and the order of work; keep using it day to day until Step 4.

Do one step at a time. After each step, read what Claude Code says, try it, and only then go on. Each step ends in a pull request into `main`, so nothing reaches the live Hub until Jack has reviewed and merged it.

## Done already

- **Step 0:** the `vehicles-module` folder is on the `vehicles-module` branch. Check that the Hub repo on GitHub is **private** before pushing it: `vehicles-module/seed` holds VINs, insurer details and workshop reports.
- **Step 1:** `vehicles-module/HUB-PLAN.md` is written. Send it to Jack and get his answers to "What we need from Jack" (the role, a test database, migration numbers, Realtime, vehicle names, statuses) before Step 2.

## Before every step

Start Claude Code on the FFSA Hub repo. Each step works on its own branch, cut from the previous step's branch until that one is merged, then from `main`.

## Step 2: foundations (PR 1, nothing visible yet)

> This is the Fleet module. Read `vehicles-module/HUB-PLAN.md`, `vehicles-module/CLAUDE.md` and `vehicles-module/docs/SPEC.md` first. Jack's answers to the plan's questions: <paste them here>.
>
> Do "PR 1 – Foundations" from the plan:
> 1. Exclude `vehicles-module/**` in `vitest.config.ts`.
> 2. Write the migrations (schema, RLS, seed, following the Hub's style and Jack's numbering): the Vehicle Co-ordinator role and `fleet.view` / `fleet.manage` permissions, the `fleet_` tables, the private `fleet-files` bucket, and the fleet tables in the Realtime publication. Don't apply them; tell me what to run in the Supabase SQL Editor, on the test project first.
> 3. Port the rules in SPEC section 6 to `src/lib/fleet/rules/` as pure TypeScript functions, line by line from `server/reminder.js` and the functions named in the SPEC inside `app/ffsa-fleet.html`. Don't change any rule; if one looks wrong, ask me. Add Vitest tests with the seed data and the date fixed to Tue 17 Nov 2026 for SPEC section 10 tests 1–9, 13 and 14.
> 4. Add `src/services/fleet.ts`, `getFleetAccess()` and copy `docs/content/*.json` into `src/lib/fleet/content/`.
> 5. Write `scripts/fleet-import.ts` for `vehicles-module/seed` (providers, vehicle details matched to Hub vehicles by registration, workshop visits, files with their ids, settings and checklist). Approved Hub bookings replace `trips`: only report which of the two seeded rentals are missing; don't create them. It must refuse to run unless the Supabase URL is the test project's, or `--production` is passed. Run it on the test project only.
> 6. Add a rule to the Hub's `CLAUDE.md`: every change to Fleet must update its Guide and add a dated line to What's new.
>
> Run `npm test`, `npm run lint` and `npx tsc --noEmit`. Commit, open a pull request titled "Fleet: foundations (tables, rules, import)" and don't merge it. Tell me in plain language what changed and what Jack has to run.

## Step 3: the core screens (PR 2)

> This is the Fleet module. Follow `vehicles-module/HUB-PLAN.md` "PR 2 – Core" and SPEC section 5 screens 2, 3, 4, 5, 8, 9 and 10, using the Hub's components and the "Movement, Quiet" look in the Hub's `CLAUDE.md`, under `src/app/(admin)/bookings/vehicles/fleet/`. Add a Fleet link to the Bookings → Vehicles navigation and the sidebar, only for people with `fleet.manage` and admins.
>
> Copy the flow and the text from `app/ffsa-fleet.html`; don't redesign them. Phone first: every screen at 390 px with no sideways scrolling, one tap per checklist point, help on every point, nothing typed twice. Inspection drafts must survive closing the page and having no signal. Photos go to `fleet-files` through the route handlers. Every open page updates within about a second when someone else saves (Realtime).
>
> Render the Guide from `src/lib/fleet/content/guide-hub.json` with tutorial progress per user, and add a What's new line: "Fleet is now part of the FFSA Hub".
>
> Add tests for the route handlers. Run the Hub's tests, lint and type check. Check every new screen at 390 px and on desktop against the test project. Commit, open a pull request titled "Fleet: vehicles, inspections, workshops, checklist, Guide" and don't merge it. Tell me how Jack and I can try it on the preview.

## Step 4: daily work, then switch over (PR 3)

> This is the Fleet module. Follow `vehicles-module/HUB-PLAN.md` "PR 3 – Daily work" and SPEC section 5 screens 1, 6 and 7: Today (the Fleet landing page), Calendar, Schedule, the time tracker, Log a km reading, and Settings (move today's "Manage fleet" list and Slack alerts card into it). Trips are approved Hub vehicle bookings; "Add trip or rental" opens a new Hub booking.
>
> Then, on the test project with the seed data, go through every acceptance test in SPEC section 10 at 390 px and on desktop, side by side with the old app (`cd vehicles-module && npm run seed && npm start`). Also run a full weekly inspection on one vehicle from start to finish, with a photo, and check it shows on the vehicle page, Today and the Calendar. Fix what fails. Update the Guide and What's new.
>
> Commit, open a pull request titled "Fleet: Today, Calendar, Schedule, settings" and don't merge it. Give me a short pass/fail list, old app against Fleet.

Then Jack merges Steps 2–4 and applies the migrations on the live Hub. Ask Claude in Cowork for a fresh export of the old app, copy it over `vehicles-module/seed`, and have Jack run `scripts/fleet-import.ts --production`. From that day, use Fleet in the Hub, and keep the old app as an archive.

## Step 5: the 7am reminder (PR 4)

> This is the Fleet module. Follow `vehicles-module/HUB-PLAN.md` "PR 4" and SPEC 6.11. Add a Vercel cron at `0 5 * * *` (07:00 Africa/Johannesburg) calling `/api/cron/fleet-reminder`, checked with `CRON_SECRET` like the other crons. It builds the message with the rules in `src/lib/fleet/` (the same result as `vehicles-module/server/reminder.js` and its tests) and sends it to whoever holds the Vehicle Co-ordinator role, by Slack DM through the Hub's Slack bot (<name Jack chose>) and by email through `sendTransactional`, with a link to Fleet → Today. Nothing is sent when every section is empty. Add an admin preview for any date that sends nothing. Make sure local runs, previews and tests can never send. Update the Guide and What's new. Open a pull request and don't merge it.

When it's live, tell Claude in Cowork to switch off the old "FFSA vehicle inspection reminders" scheduled task.

## Step 6: bookings (PR 5)

> This is the Fleet module. Implement SPEC section 7 as in `vehicles-module/HUB-PLAN.md` "PR 5": booked workshop visits block the vehicle in the Hub's booking calendar and in `vehicle_availability`; when a workshop visit is booked or moved, everyone with an overlapping booking is told (using `src/lib/vehicles/requester-notify.ts`) and offered a similar free vehicle with one tap, or told to wait until it's back or make other plans, with the co-ordinator copied; bookings starting within 7 days after it get a heads-up; the mileage and fuel from the existing collection and return forms are saved as odometer readings. No real messages from tests or previews. Update the Guide and What's new. Open a pull request and don't merge it.

## Step 7: PDFs (PR 6)

> This is the Fleet module. Build the in-car guide, the full manual and the Guide PDF with `@react-pdf/renderer`, matching the content of `cardDoc()` in `vehicles-module/app/ffsa-fleet.html` and SPEC 6.9 (printed status, out of date when the co-ordinator changes). Update the Guide and What's new. Open a pull request and don't merge it.

## Step 8: Ask (PR 7, optional)

> This is the Fleet module. Add Ask as in `vehicles-module/HUB-PLAN.md` "PR 7" and SPEC 5.11: `/api/vehicles/fleet/ask` keeps the API key on the server; offer the 14 tools in `chatTools()` of `app/ffsa-fleet.html`; every change is shown to the user and confirmed before anything is written, and Ask can't delete anything; rate-limit per user with `getRateLimiter()` and a daily token budget; dictation with the browser's speech recognition where it exists. Test with `vehicles-module/test/mock-claude.js` instead of the real API. Update the Guide and What's new. Open a pull request and don't merge it.

## Any later change

Start every request with: "This is a change to the Fleet module. Follow `vehicles-module/CLAUDE.md` and the Hub's `CLAUDE.md`, and update the Guide and What's new."
