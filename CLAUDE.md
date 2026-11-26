# FFSA Hub — Project Context for Claude Code

This file is the standing context for Claude Code working in this repo. Read it first on every task.

---

## What this project is

**FFSA Hub** is the internal platform for **Fire and Fragrance South Africa**, a nonprofit Christian ministry running training schools (DTS, DBS, SBS, Leadership Track, LEAD, FFX), outreach campaigns (The Send, Send Night, Ministry Night), and donor-development operations.

The platform replaces a sprawl of point tools: HubSpot (CRM + marketing), spreadsheets, separate student systems, ad-hoc finance trackers. Today it covers schools, finance (outreach + school fees), prayer room scheduling, events, and user management. **Phase 2** is replacing HubSpot's marketing/outreach functionality (contact directory, lead-capture forms, channel-scoped broadcast email, donations) — see `FFSA_Hub_Phase2_Spec.md` if present.

---

## Tech stack

- **Next.js 15** with the **App Router** and **TypeScript**
- **Supabase** for Postgres, Auth, RLS, and Storage
- **Tailwind** + **shadcn/ui** components (already installed under `src/components/ui/`)
- **Lucide** icons
- **React Email** (Phase 2, for transactional + broadcast templates)
- **Resend** (Phase 2, single ESP for all email)
- **Stripe** (Phase 2, for donations; already partially scaffolded for school fees)
- **Xero** OAuth integration (existing, at `src/services/xero.ts`)
- **Tiptap** (Phase 2, broadcast composer)

Node 20+. Package manager: npm (the lockfile is `package-lock.json`).

---

## File layout

```
src/
  app/
    (auth)/           — auth callbacks, login routes
    (admin)/          — staff-facing admin pages (require login + role)
    (portal)/         — student/staff personal pages (profile, my-schools, my-finance, etc.)
    (public)/         — public pages (Phase 2: form runtime at /f/[slug])
    api/              — route handlers; mirror the (admin) path structure
    auth/             — public auth pages (confirm, etc.)
  components/
    ui/               — shadcn primitives, do not edit by hand
    *.tsx             — feature components shared across pages
  config/
    modules.ts        — single source of truth for admin nav + portal nav + RBAC gates
  lib/
    supabase/
      client.ts       — browser Supabase client (use in 'use client' components only)
      server.ts       — server Supabase client (use in server components + route handlers)
      admin.ts        — service-role client (bypasses RLS; admin operations only)
    email/            — email helpers (templates live here in Phase 2)
    utils/cn.ts       — Tailwind class merger
  services/           — pure data-access functions, one file per domain
  types/
    database.ts       — auto-generated from `supabase gen types`; do NOT edit by hand
supabase/
  migrations/         — numbered SQL files; run via Supabase SQL Editor
    001_phase1_schema.sql
    002_rls_policies.sql
    003_seed_data.sql
    (Phase 2 adds 004_phase2_marketing_schema.sql, 005_phase2_rls_policies.sql, 006_phase2_seed.sql)
```

---

## Patterns and conventions

### Supabase client — pick the right one

- **`createClient()` from `@/lib/supabase/server`** — use in server components, server actions, and route handlers (API routes). Respects RLS as the logged-in user.
- **`createClient()` from `@/lib/supabase/client`** — use in `'use client'` components only. Same RLS scope as the logged-in user.
- **`createAdminClient()` from `@/lib/supabase/admin`** — service-role client; **bypasses RLS**. Only use for genuinely admin operations (user invitation, cross-user reporting, system jobs). Never expose this client's results to a client component.

### Services

Every domain has a service file in `src/services/<domain>.ts`. Services are pure data-access:

```typescript
// src/services/school-fees.ts (existing — follow this style)
type Client = any; // eslint-disable-line — the Supabase generic is heavy

export async function getCountryTiers(
  supabase: Client,
  options?: { tier?: string; search?: string }
) {
  let query = supabase.from("country_tiers").select("*").order("country_name");
  if (options?.tier) query = query.eq("tier", options.tier);
  if (options?.search) query = query.ilike("country_name", `%${options.search}%`);
  return query;
}
```

Rules:

- Services accept a `Client` as their first parameter — never instantiate one inside.
- Return Supabase's raw `{ data, error }` response; let callers decide how to handle errors.
- One file per domain. New domain = new file (e.g. `src/services/channel-handlers.ts` for Phase 2).
- Section dividers with comment lines for readability — match the existing style.
- No business logic beyond query construction. Business logic (sending an email, creating a Stripe session) belongs in route handlers or dedicated business-logic modules.

### API route handlers

Route handlers under `src/app/api/<domain>/<resource>/route.ts` follow this shape:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCourse } from "@/services/schools";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { program_id, name, code } = body;
  if (!program_id || !name || !code) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { data, error } = await createCourse(supabase, { program_id, name, code });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, course: data });
}
```

Rules:

- Always auth-check at the top. Return 401 if no user.
- Validate input. Return 400 on bad input.
- Delegate work to a service. Return 500 on service errors with `error.message`.
- Public endpoints (Phase 2 form submissions at `/api/f/[slug]/submit`) skip the auth check but **must** validate input strictly and rate-limit.

### Pages

- **Admin pages** live under `src/app/(admin)/<module>/...` and are server components by default. Pull data via `createClient()` + service functions.
- **Portal pages** under `src/app/(portal)/...` follow the same pattern.
- Forms that POST are split: server component renders the page, `'use client'` form component handles the submit and calls an API route handler.
- **Module visibility is enforced in `src/config/modules.ts`** via `requiredRoles`. Adding a new admin page = adding a new entry to `ADMIN_MODULES` and (if needed) gating it with the right roles.

### Module config (`src/config/modules.ts`)

This file is the single source of truth for:

- Admin sidebar (`ADMIN_MODULES`)
- System management section (`SYSTEM_MODULES`)
- Personal portal tabs (`PORTAL_TABS`)
- Role-based visibility via `getAccessibleModules()`

Roles defined: `super_admin`, `admin`, `staff`, `events_admin`, `program_leader`, `team_leader`, `finance_admin`, `comms_admin`, `mission_leader`. Phase 2 marketing work attaches to the existing `comms_admin` role for module gating.

### Migrations

- Migrations live in `supabase/migrations/` and are numbered `NNN_description.sql`.
- They are run **by hand** in the Supabase SQL Editor (Dashboard → SQL Editor). Do not write a script to apply them via the CLI unless explicitly asked.
- Phase 1 split: `001` = schema, `002` = RLS, `003` = seed. Phase 2 follows: `004` = schema, `005` = RLS, `006` = seed.
- Every new table needs RLS enabled and at least one policy per `select`, `insert`, `update`, `delete` the app needs.
- Generated columns and indexes go in the same migration that creates the table.
- After applying any migration that changes schema, regenerate types: `supabase gen types typescript --project-id <id> > src/types/database.ts`.

### Types

- `src/types/database.ts` is **auto-generated** by `supabase gen types`. Do not edit by hand. If a table is missing from the types, regenerate before continuing.
- `src/types/supabase.ts` re-exports a typed client helper. Leave alone.

### Styling

- Tailwind for everything. No CSS modules, no styled-components.
- shadcn/ui components are pre-installed in `src/components/ui/`. Use them via direct imports (`import { Button } from "@/components/ui/button"`).
- New shadcn components added via `npx shadcn@latest add <component>`. The config is in `components.json`.

### Auth + RBAC

- Supabase Auth handles login. Magic-link / email-link is the default flow. Admins invite users via `/api/admin/invite-user/route.ts`.
- Every page that needs auth calls `supabase.auth.getUser()` and redirects to `/login` if absent.
- Roles are stored in the `user_roles` table (see `001_phase1_schema.sql`). Look up a user's roles, pass to `getAccessibleModules` for nav.

---

## Environment variables

Required (existing):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Phase 2 adds:

```
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
HUBSPOT_ACCESS_TOKEN              # migration only — remove after cutover
NEXT_PUBLIC_APP_URL               # e.g. https://www.ffsahub.com — used for unsubscribe links
UNSUBSCRIBE_TOKEN_SECRET          # HMAC secret for signed unsubscribe tokens
TURNSTILE_SECRET_KEY              # Cloudflare Turnstile for public form spam protection
NEXT_PUBLIC_TURNSTILE_SITE_KEY
```

Xero env vars already exist in the codebase (see `src/services/xero.ts`).

When adding a new env var, also add it to `.env.local.example` with a placeholder.

---

## Common gotchas

- **Do not call `createClient()` from `@/lib/supabase/server` inside a `'use client'` component.** It will not work — server-only APIs (`cookies()`) are imported transitively.
- **Do not pass service-role data to client components.** `createAdminClient()` bypasses RLS and its results must not leak to the browser. Filter / project the data server-side first.
- **RLS by default.** When adding a new table, RLS is OFF until you `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. The migration must enable it and add policies, or the table will appear empty to anyone but service-role.
- **Migration order matters.** Don't reorder existing migrations. Append-only.
- **Server actions vs. API routes.** This codebase uses route handlers (`route.ts`) more than server actions. Follow the route-handler pattern unless a form clearly benefits from a server action (e.g. progressive enhancement is critical).
- **Existing `users` table is linked to `auth.users` 1:1.** When inserting a `people` row that should also be a login user, use the admin invite flow at `/api/admin/invite-user/route.ts` — don't manually create rows in `users`.
- **The `(admin)` and `(portal)` route groups don't share layouts.** `(admin)` uses `AdminSidebar`, `(portal)` uses `PortalNav`. Adding a page in the wrong group means the user sees the wrong nav.
- **Currency.** Money is stored in cents (integer) where new (Phase 2 `donations.amount_cents`). Older tables store ZAR amounts as decimals (`tuition_zar numeric`) — match the table you're working with.

---

## How to run the project

```bash
npm install
npm run dev          # localhost:3000
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (if defined; otherwise `npx tsc --noEmit`)
```

Supabase runs in the cloud (no local Postgres). Migrations are applied via the Supabase Dashboard SQL Editor.

---

## When in doubt

- Match an existing pattern. Examples to imitate by domain:
  - **Services**: `src/services/school-fees.ts`, `src/services/outreach-finance.ts`
  - **API routes**: `src/app/api/schools/courses/route.ts`, `src/app/api/finance/school-fees/payments/route.ts`
  - **Admin pages**: `src/app/(admin)/finance/school-fees/page.tsx`
  - **Admin form components**: `src/app/(admin)/users/invite-user-form.tsx`
  - **Migrations**: `supabase/migrations/001_phase1_schema.sql`, `002_rls_policies.sql`
- Prefer additive changes (new files, new tables) over edits to existing modules.
- If a task is ambiguous, ask before assuming. Especially around RLS policy shape, role gates, and migration ordering.

---

## Fleet (vehicle inspections) — standing rules

Fleet is the FFSA Fleet app rebuilt in the Hub, under Bookings → Vehicles → Fleet. The plan is `vehicles-module/HUB-PLAN.md`; the spec is `vehicles-module/docs/SPEC.md`; `vehicles-module/app/ffsa-fleet.html` is the reference for flow, rules and text.

- **Every change to Fleet updates its Guide and What's new.** Change the Guide text in `src/lib/fleet/content/guide-hub.json` to match, and add a dated line to What's new. A Fleet change isn't done until the Guide matches it.
- **Rules don't change silently.** `src/lib/fleet/rules/` is SPEC section 6, ported line by line and checked against the reference app by `parity.test.ts`. If a rule looks wrong, ask Gideon; don't "fix" it.
- **Messages are off.** Fleet sends no email or Slack unless `FLEET_MESSAGES_ENABLED=1` (live site only). Don't switch it on, or add another sender, until Gideon has reviewed the messages. The exceptions are Move and Let them know on the Calendar, and Put on hold, Resume booking and Cancel: vehicle broke down for a vehicle out of action: when the co-ordinator taps them, they tell the person who booked through the Hub's own booking notice (`notifyVehicleRequester`, "changed" / "message"), as the booking page does (Gideon and Jack, 19 Nov 2026). Nothing is sent without a tap.
- **No bookings from the old app.** The Fleet app's trips and rentals are never imported; bookings are uploaded separately.
- **Phone first:** every Fleet screen works at 390 px wide with no sideways scrolling; one tap per checklist point.
- **Field names:** the rules use the Fleet app's names (SPEC section 4); `src/lib/fleet/mapping.ts` is the only place that maps them to columns.
- `vehicles-module/seed` is FFSA's real data (VINs, insurer details, workshop reports). It is **not committed** (it's in `vehicles-module/.gitignore` and was removed from the branch history): it lives only on Gideon's Mac, for the one-off import. Never commit it, copy it anywhere public or put it in a migration. Tests use the fake data set in `src/lib/fleet/testing/fixture` (same shape, ids, dates and km; every identifying value made up), so they run everywhere, CI included. Never copy real values into the fixture.

## Visas — standing rules

Visa applications for international students, linked to school applications. Migrations 360+ (`360_visa_schema`, `361_visa_rls`, `362_visa_seed`, `363_visa_workflow`, `366_visa_letters`); rules in `src/lib/visas/`; data access in `src/services/visas.ts`. Built in small steps, each a draft PR from a `visa-*` branch.

- **Every change to the visa process updates the FFSA Visa Process Guide** (a shared doc; ask Gideon for the link) and adds a dated line to its What's new. A visa change isn't done until the guide matches it.
- **Roles:** legal (the visa officer) holds `visas.manage`, granted globally, and approves, signs and manages everything; a `visas.manage` grant scoped to a program manages only cases covering it. RLS and APIs check `has_permission_for(key, program_id)`; plain `has_permission()` is only for module visibility. School leaders hold `visas.follow_up`, **granted scoped to their program**, and only see cases covering their schools. Students see their own case. Nobody else sees anything.
- **Documents (legal's POPIA ruling, 23 Nov 2026):** school leaders see their students' documents only while the case is open and the stay hasn't ended. Police clearances and medical reports (`is_restricted`) are special personal information: only global legal (FFSA's information officer) and the student see them, never leaders or legal scoped to one school. Leaders check documents against objective points (`leader_checks`) and flag problems; they don't reject anything. Whether a document is acceptable is legal's call.
- **The visa route comes from the real arrival and departure days**, never the school's name: a 90-day school plus a few buffer days is over 90 days.
- **Status moves go through SECURITY DEFINER functions** that check the actor and the case's status, never through direct table updates by leaders or students.
- **One case per student per stay.** The stay runs from the first school's arrival day to the last school's departure day (`computeStay`). Over 90 days always needs a visa, even for a visa-exempt passport (`visaNeed`).
- **Passport data:** passport numbers stay on `users` / `household_members` (RLS "own row + admins", never widened; staff read them only through the visa API after a scoped `visas.*` check) and are never copied into visa tables, URLs, emails, logs or `visa_case_events.detail`. Files live in the private `visa-documents` bucket at `<case id>/<document id>.<ext>` (enforced by a CHECK), downloaded only through a checked route that logs the download and signs a short-lived URL.
- **Letters (366):** legal writes each letter as a template in the Hub (Visas → Letter templates); every save is a new version, used only once published, and a published version never changes. The Hub fills in the student's details from `src/lib/visas/letters.ts`; nobody edits the wording of a single letter. The student checks the details before legal signs. Legal signs and stamps by hand and uploads the scan: no digital signatures. An issued letter keeps `{{passport_number}}` as a token; the PDF route fills it in for legal and the student only (`visa_letter_passport`), never school leaders. `visa_text_has_passport` refuses the number (any case, spaces ignored) in a letter's text, its inputs, the student's "something's wrong" note and legal's withdraw note, because leaders can read those notes. A correction is a re-issue, which replaces the old letter.
- **The repo is public:** no real student data, letters or names in code, seeds, tests or fixtures. Document types and letter wording are draft until legal confirms them, and legal edits them in the Hub, not in migrations.

---

# FFSA Hub — redesign context

Redesign of the FFSA Hub (Next.js admin platform in the attached `ffsa-platform` folder)
for Fire & Fragrance South Africa. All work lives in `FFSA Hub Redesign.dc.html`,
newest turn at the top of the canvas.

## The committed direction — "MOVEMENT, QUIET" (option 2a)

Light, editorial, hard-edged. Official and premium, with brand energy carried by
type and structure rather than colour volume.

- **Frame**: 74px black icon rail · 212px bone module panel (#F4F2EA) · white content
- **Type**: Roboto Condensed Black (900, uppercase) for mastheads and numerals ·
  Roboto for body · Roboto Mono for labels, all-caps, wide tracking (0.1–0.2em)
- **Colour**: black #0A0A0A · bone #F4F2EA / #F1EFE7 · white · yellow #FFB801 ·
  green #3E7F2B (positive) · amber #8A6400 (attention). Blue #000DE5 is brand but
  mostly unused in-app.
- **No rounded corners. No cards with shadows.** Hairline rules (#E7E4D9 / #DEDACE),
  black bars for section headers, borders not elevation.
- **Numerals** are Roboto Condensed 900 with `font-variant-numeric: tabular-nums`.
- **One yellow "NEEDS YOU" band per screen**, never two — it stops working if repeated.
- Masthead pattern: yellow tick + mono context line + huge condensed uppercase H1.

Rejected: 1a PRESS (light editorial, too quiet), 1b MIDNIGHT (refined dark),
1c MOVEMENT (the loud original — right bones, too much colour).

## Brand rules

- **The FFX logo is ONLY for FFX schools** (Fire and Fragrance Experience). Everywhere
  else use the FF wordmark or mark (`brand/ff-wordmark-white.png`, `ff-mark-white.png`,
  black variants alongside).
- Photography is dropped in by the user via `<image-slot>` components — never invent
  or reuse the FFX collage as texture. Existing slot ids: photo-login, photo-event-hero,
  photo-event-hero-mobile, photo-prayer-room-*, photo-outreach-*, photo-dash-1b,
  photo-email-nepal.
- Voice: plain and direct, "friend talking to a friend" but not hip. "4 staff members
  are waiting on approval" — not "4 people are waiting on your yes."

## Screens built

Dashboard (2a) · Events (3a) · Training (3b) · Bookings (3c) · Login (4b) ·
Public event page + form (4c) · Mobile portal (4d) · Finance (5a) ·
Communications (5b) · Prayer Room (8a, 9a, 9b, 10a, 10b).

## Prayer Room — the most-iterated area, current state

**8a is the wall.** Monday–Friday only (weekends removed). Coverage measured against
120 hours.

- Continuous **time axis**, not an hour grid: blocks are drawn to their real duration,
  so 30-minute and 90-minute sets need no special row. Axis runs 05:00–24:00 with a
  collapsed overnight strip per day.
- **MORNING (08:00–09:30) / NOON (12:00–14:00) / NIGHT (17:30–20:00)** are the anchor.
  Named in black in the gutter, tinted band across all days with 2px black rules,
  sets inside them are **solid yellow with heavy black borders**. These will eventually
  be curated centrally and not bookable.
- Ordinary booked sets are **bone cards** (#F1EFE7) with time, duration, title, type
  and lead.
- **Unbooked time renders as nothing — white is the only "nobody has this" signal.**
- Card layout is chosen by duration: ≥135min full (4 rows, title clamped to 2 lines),
  ≥85min mid (title nowrap+ellipsis), <85min tight (time + title only). Column width
  is ~127px, so titles wrap easily — always constrain them, and budget rows against
  ~0.72px/min.
- Blocks are inset 1.5px top/bottom so no two ever touch.

**36a–36e — PRACTICE** (handoff 17, migration 224). A bone lane named PRACTICE
between the ordinary sets and NIGHT: 16:00–17:30 Mon/Wed/Thu/Fri in 30-minute rows,
Tuesday hatched shut ("MINISTRY NIGHT, NO PRACTICE"). Seven stations, one person each
(vocals is one booking for up to 4); a full band takes the whole room, only on an empty
row; only admins move people, with a reason and a per-person message. Bookings open
Sunday 00:00 SAST for that Mon–Fri only, 60 minutes max. **Practice is not coverage** —
it lives in `practice_*` tables and never creates a `prayer_room_sets` row. Every rule is
enforced in the database (exclusion constraints + trigger + RPCs), not the UI.

**9a** — clicking a set slides a 470px drawer over the wall; the source block inverts
to black with a yellow border. Drawer content is driven from the same block data
(never hardcoded strings). **9b** — the curated-band state and the empty-slot claim flow.

**11a/11b** — person profile with per-seat qualification; mobile prayer room (day as a
vertical run, set lineup, "Mine"). Phone lists scroll; rows are two lines, 46px+ targets.

**12a/12b** — **evaluators are a role, not a capability.** The permission is granted on the
hub profile (Users & Roles) and can be scoped (all seats / worship / intercession / sound).
Evaluators get a fourth tab in the prayer room holding the evaluation queue, booked
sessions, and the evaluator list — and they are also the people who curate the Morning /
Noon / Night bands (time, lead, weekly focus). **Evaluation notes are visible ONLY to
evaluators and to the person they are about** — a set lead filling a seat sees the state
(signed off / in training / not evaluated) and nothing more.

**13a/13b** — every set carries a **PRAYER LEAD** and a **WORSHIP LEAD** seat. Neither is
mandatory alone, but a set with neither is **not live**: it holds its slot on the wall as a
dashed white block reading "NEEDS A LEAD", and its other seats are locked until someone
leads. The two lead seats sit above the rest of the lineup, separated by a 2px black rule.
**The two are separately evaluated qualifications** — holding worship lead says nothing
about prayer lead.

Evaluators write **two notes** per evaluation: feedback for the person (yellow left rule,
labelled "she reads this") and an evaluators-only note (black panel, labelled "she can't
see this"). The two look completely different on purpose. The person sees only the
feedback, with no hint the second note exists.

Wall vocabulary, complete: bone = set running · yellow = curated band · dashed white =
set waiting on a lead · plain white = nothing there.

**10a/10b** — a set is a **lineup of named seats** (set lead, co-lead, keys, acoustic,
vocals, sound, scribe). People are evaluated and signed off per seat; the seat-filling
picker only offers qualified people, sorted by lowest load, with clash detection.
Members can request a specific open seat; leads get a requests inbox. A People tab
sits beside Week and Day.

## Working notes

- Icons are local Lucide SVGs in `icons/`, applied as CSS masks. No CDN.
- Density: real tables for list views, spacious mastheads. Never a card grid where a
  table would do.
- Mobile matters (students and volunteers) — 44px+ targets, bottom tab bar, one big
  number per screen.

## Redesign — rulings made while migrating screens

- **What "one yellow per screen" means.** It governs *bands*: there is at most one
  `<NeedsYou>` per page, and it is the only large yellow area. The hairline yellow
  ticks (the masthead's rule, a lead KPI's 3px mark) are structural accents, not
  bands, and may coexist with one. On a screen where the tick would compete with a
  band, pass `tick={false}` to `Kpi` — finance does this.
- **Never invent a signal to fill a band.** A `NeedsYou` must be driven by data the
  page already fetches (or a count that already exists). Several screens correctly
  have no band at all. Same rule for progress bars: no ratio, no bar.
- **`.ffsa-screen`** on a page root opts it into the full-bleed workspace. Anything
  without it keeps the old centred page box — see the transition rule in globals.css
  and delete it once every screen is migrated.
- **Event brand kits are out of scope.** Storefronts, email templates/chrome, brand
  editors and per-brand fonts keep their own identity; only the admin chrome around
  them was restyled.
