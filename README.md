# FFSA Hub

The internal platform for Fire & Fragrance South Africa — CRM, events & ticketing,
schools & applications, bookings, prayer room, org chart, and more.

Built with **Next.js 15 (App Router)**, **Supabase** (Postgres + Auth), and
**Tailwind**, deployed on **Vercel**.

---

## Getting started (new developers)

### 1. Prerequisites
- **Node.js 20 LTS** (see [`.nvmrc`](.nvmrc) — run `nvm use` if you use nvm)
- **npm** (this repo uses `package-lock.json` — don't switch to pnpm/yarn)
- A **GitHub account** that has been invited to this repo as a collaborator

### 2. Clone
```bash
git clone https://github.com/southafrica-coding/ffsa-hub.git
cd ffsa-hub
```

### 3. Install dependencies
```bash
npm install
```

### 4. Set up environment variables
```bash
cp .env.local.example .env.local
```
Then fill in `.env.local`. The **`[REQUIRED]`** block (Supabase + app URLs) is the
minimum to boot the app — the `[OPTIONAL]` blocks (payments, email, Slack, Xero…)
only matter when you work on those features.

Get the real values from an existing team member via a **password manager**, or
pull them straight from Vercel:
```bash
vercel env pull .env.local
```
> Never paste secrets into chat, tickets, or commits. `.env.local` is git-ignored.

### 5. Run the dev server
```bash
npm run dev
```
Open **http://localhost:3000**.

---

## Scripts

| Command         | What it does                                  |
|-----------------|-----------------------------------------------|
| `npm run dev`   | Start the local dev server (localhost:3000)   |
| `npm run build` | Production build (what Vercel runs)           |
| `npm run start` | Serve a production build locally              |
| `npm run lint`  | Run ESLint                                     |

---

## How the pieces fit together

- **Frontend + API** — Next.js App Router (`src/app`). Server components, route
  handlers, and server actions talk to Supabase.
- **Database + Auth** — Supabase. Access is enforced by Row-Level Security plus an
  in-app permissions/roles system. Schema changes live in
  [`supabase/migrations/`](supabase/migrations).
- **Deploys** — Vercel. Every pull request gets its own **preview URL**; merging to
  `main` deploys to production.

---

## Database migrations — read this before touching the schema

Migrations are plain SQL files in `supabase/migrations/`, numbered sequentially
(`121_enrollment_removal.sql`, `122_…`).

**Two rules that keep us out of trouble:**

1. **Number from `origin/main`, not your local branch.** Parallel branches can each
   add "the next" number. Before naming a migration, `git fetch` and check the
   highest number that exists on `origin/main`, then use the next one. If two PRs
   collide on a number, renumber before merging.

2. **Apply migrations by hand via the Supabase dashboard SQL editor — _not_
   `supabase db push`.** The CLI migration history is out of sync with production
   and a push would try to replay old migrations destructively. Paste the SQL into
   the dashboard SQL editor and run it against the target project.

Always note in your PR whether it includes a migration and whether it's been
applied yet (see the PR template).

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the branch → PR → merge workflow and
migration conventions. In short: branch off `origin/main`, open a PR, get it
reviewed, merge. Don't push straight to `main`.

---

## Useful links

- **Production:** https://www.ffsahub.com
- **Hosting:** Vercel (`ffsa-hub` team)
- **Database:** Supabase dashboard
- **Repo:** https://github.com/southafrica-coding/ffsa-hub
