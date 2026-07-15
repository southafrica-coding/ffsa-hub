# Contributing to FFSA Hub

This is the shared workflow for everyone with write access. It exists so multiple
people can work at once without stepping on each other or breaking production.

## Golden rules

1. **Never push directly to `main`.** Always work on a branch and open a pull request.
2. **Branch off the latest `origin/main`**, not off another feature branch.
3. **`main` is always deployable** — merging to it deploys to production.
4. **Never commit secrets.** `.env.local` is git-ignored; keep it that way.

## The workflow

### 1. Start from fresh `main`
```bash
git fetch origin
git switch -c feature/short-description origin/main
```
Branch names: `feature/…`, `fix/…`, or `chore/…` + a short kebab-case description
(e.g. `feature/contact-lists`, `fix/campaign-subject-merge`).

### 2. Make your change
- Keep each PR focused on one thing.
- Match the style of the surrounding code.
- Run `npm run lint` and `npm run build` before pushing — the Vercel build must pass.

### 3. Open a pull request
```bash
git push -u origin feature/short-description
```
Then open a PR against `main` on GitHub (or `gh pr create`). Fill in the PR
template — **especially the migration checkbox**.

Every PR gets an automatic **Vercel preview URL**. Use it to check your change
before merging.

### 4. Review and merge
- At least one other person reviews the PR.
- Resolve comments, then merge (squash merge keeps history clean).
- Delete the branch after merging.

## Database migrations

Schema changes go in `supabase/migrations/` as numbered SQL files. See the
[README](README.md#database-migrations--read-this-before-touching-the-schema) for
the full rules. The two that bite people:

- **Number from `origin/main`** — `git fetch` first, use the next number after the
  highest one on `main`. Renumber if two PRs collide.
- **Apply via the Supabase dashboard SQL editor, _not_ `supabase db push`** — the
  CLI history is out of sync and a push would replay old migrations destructively.

In your PR, always state:
- whether the PR includes a migration, and
- whether that migration has already been applied to production (and to which
  project).

## Environment variables

- The full list lives in [`.env.local.example`](.env.local.example).
- If your change reads a **new** env var, add it to `.env.local.example` (with a
  comment and a placeholder value) in the same PR, and add the real value to the
  Vercel project env for **Production _and_ Preview** — otherwise preview builds and
  production will break.

## Questions

If you're unsure about a migration, a permission change, or anything that touches
production data, ask before merging. Buffer over damage — prefer reversible,
visible changes.
