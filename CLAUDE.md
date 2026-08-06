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
