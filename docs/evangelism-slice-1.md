# Evangelism — slice 1 (testimonies)

Branch `feat/evangelism-testimonies-slice-1`, rebased onto `origin/main` at 1301f392 (after 305 LMS and 306 interview notes).
**Migration 307 is NOT applied anywhere.** Do not apply it until Jack says so.

## What shipped

- **Submit** (`/evangelism`): a phone-friendly form with title, story,
  date, place, an optional ministry tag (active `staff_ministries`), people
  reached, decisions, outcome, an optional single photo and a consent box.
  You can save a draft or submit it for review. Below the form is a "My stories"
  list where you can edit while a story is draft/submitted and delete drafts.
  Your own **withheld** stories stay in that list with the reviewer's reason,
  so they don't just vanish (viewers never see withheld stories).
- **Read** (`/evangelism`): a list of published stories for anyone with
  view access. Pure viewers do not see who wrote a story; the author and
  publishers do.
- **Review** (`/evangelism/queue`): every signed-in user (via self_service)
  can view, submit and publish their own consented story. Only ministry
  leaders and admins (`evangelism.moderate`) can take down or see other
  people's non-published stories. Consent is still required; anon has no access.
- **Nav**: `evangelism` removed from `HIDDEN_FROM_NAV`. Admins see it. Anyone
  holding an `evangelism.*` key sees it through the usual module-permission
  path.

### API

| Route | Who |
|---|---|
| `GET /api/evangelism/testimonies` | view: published list. `?mine=1`: submit. `?status=submitted\|draft\|withheld`: publish only (403 otherwise) |
| `POST /api/evangelism/testimonies` | submit: create a draft, or a submitted story (needs consent), plus an optional `photo` |
| `GET/PATCH/DELETE /api/evangelism/testimonies/:id` | PATCH `{action: publish\|withhold}` for publishers. Otherwise the author edits while open. DELETE: own draft, or any story for a publisher |
| `POST /api/evangelism/media/sign` | submit: returns a signed upload URL into the private bucket at `testimonies/{uuid}/{uuid}.{ext}` (no user id) and records it in `evangelism_uploads` |

Signed **read** URLs (30 min) are included on every GET, so there is no
separate refresh route. When the tables or bucket are missing, routes answer
`503 {code: "evangelism_not_enabled"}`. Every read and write uses the
caller's own client, so RLS decides. Names and review fields come from the
`evangelism_attribution()` RPC on the caller's own client — never an email;
no name shows as "Staff member". The service role is only used for Storage:
recording upload paths, signing photo reads (keyed by media id, for rows the
caller's own client returned) and removing objects. A client-supplied path is
only ever removed if the upload ledger says the caller minted it. DELETE
removes the row first and the objects only after exactly one row went.

## Migration 307 — `307_evangelism_testimonies.sql`

307 was free on 9 Nov 2026: `origin/main` tops out at 304, 305 is the local
LMS slice, and no open PR or local branch uses 306 or 307.

- **Permission keys.** Migration 311 grants `evangelism.view`,
  `evangelism.submit` and `evangelism.publish` to `self_service`, so every
  signed-in user can view stories and publish their own consented story.
  `evangelism.moderate` (see others' non-published stories, withhold,
  republish, delete) goes to `ministry_leader`. `admin` and `super_admin`
  get that through `is_admin()`. Consent is still required. Anon has no
  access. publish ⊃ submit ⊃ view. Moderate is separate.
- **`evangelism_testimonies`** has the CHECKs from the brief: consent is
  required for submitted/published, published needs both stamps, and
  decisions ≤ people reached. A guard trigger stops anyone changing the
  author. It stops non-publishers from publishing, withholding or setting the
  stamps or the reason. On **someone else's** story a publisher may change
  only `status` and `withheld_reason` — never the content or the author's
  consent — and may only move it to published/withheld from
  submitted/withheld/published (so a draft can't be pushed through).
  Publishing is only from `submitted` or `withheld`. When a publisher
  publishes, it **stamps `published_at = now()` and `published_by =
  auth.uid()`** itself, so a client can't backdate a publish or credit
  someone else.
- **Identity is hidden in the database.** `authenticated` has column-level
  SELECT that leaves out `author_user_id`, `published_by`, `withheld_reason`,
  and media `storage_path` / `created_by`. `author_user_id` and `created_by`
  default to `auth.uid()`. RPCs (security definer, `search_path = ''`):
  `evangelism_attribution(ids)`, `evangelism_my_testimony_ids()`,
  `evangelism_is_my_open_story(id)`, `evangelism_upload_is_mine(path)`.
- **`evangelism_uploads`** ledger (`storage_path`, `user_id`): service role
  only. The media insert policy accepts a path only if the ledger says the
  caller minted it.
- **`evangelism_media`** is photo only, with a 15 MB CHECK and a path shape
  CHECK (`testimonies/{uuid}/{uuid}.{ext}`). A photo is visible exactly when
  its parent story is. Inserts are only allowed onto your own open story, at a
  path from your own ledger entries. There is no UPDATE.
- **Bucket `evangelism-media`** is private, 15 MB, and accepts jpeg/png/webp/heic/heif.
  It has **no** `storage.objects` policies.
- A withheld story is visible to publishers, admins and its author (with
  the reason); never to viewers or other submitters.
- Every signed-in user (via `self_service`, migration 311) can view, submit
  and publish their own consented story. Only ministry leaders and admins
  can take down or see other people's non-published stories. Consent is
  still required. Anon has no access: every new table and function starts
  with an explicit REVOKE from PUBLIC/anon. No TRUNCATE/REFERENCES/TRIGGER
  for `authenticated`.

## Tests

- `supabase/tests/evangelism_testimonies_rls.sql` covers admin, publisher,
  submitter, viewer, outsider and anon across every status. It also applies
  the migration twice, checks grants (no hidden columns, no TRUNCATE, nothing
  for anon), that a publisher can't set consent, edit others' content or
  publish/submit a draft, that a viewer can't select author/publisher columns
  or learn an author id from a media path, that nobody can register or delete
  another user's upload path, and that an author sees their own withheld
  story with its reason. Its wrapper `src/lib/evangelism/rls.test.ts` skips
  without local Postgres, the same as `program-staff-rls.test.ts`.
- Vitest: `check-evangelism-access.test.ts`, `validation.test.ts`,
  `services/evangelism.test.ts`, and `api/evangelism/testimonies/route.test.ts`
  (which covers the list, `[id]` and sign routes).

## Out of scope (later slices)

- TV / base dashboard / kiosk token / `evangelism_removals` tombstones
- Video upload, or more than one photo per story
- Base-wide stats charts / `GET /api/evangelism/stats`
- Public website or social sharing (consent here is **inside the Hub only**)
- Slack notifications (e.g. "new story waiting for review")
- Mobile native app surfaces
- A sweep for orphaned uploads (a photo that was signed and uploaded, but
  whose story never saved)

## Dormant drafts — untouched

**#508** (schema 293), **#499** (API) and **#510** (UI + TV) are still
separate dormant drafts. This slice was read against them for ideas but
does not merge, rebase onto or modify them. Whether to close them or build
later slices on top is Jack's call — but **#508 uses the same table, key,
bucket and guard-function names**, so close or rename it before 307 is
applied (both use `CREATE TABLE IF NOT EXISTS`; whichever lands first wins
the shape silently).
