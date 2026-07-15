## What & why

<!-- What does this PR change, and why? Link any related discussion. -->

## How to test

<!-- Steps to verify on the preview URL. -->

## Database migration

- [ ] This PR **does not** touch the database schema.
- [ ] This PR **includes a migration** (`supabase/migrations/NNN_*.sql`):
  - Migration number: `NNN_...`
  - [ ] Numbered from the highest migration on `origin/main`
  - [ ] Applied to production via the Supabase dashboard SQL editor
  - [ ] **Not yet applied** — needs to be run at deploy time

## Environment variables

- [ ] No new env vars.
- [ ] Added new env var(s) — updated `.env.local.example` **and** set the real
      value in Vercel for **Production + Preview**.

## Checklist

- [ ] Branched off the latest `origin/main`
- [ ] `npm run lint` and `npm run build` pass locally
- [ ] Checked the change on the Vercel preview URL
- [ ] No secrets committed
