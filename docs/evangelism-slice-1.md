# Evangelism — slice 1 (testimonies)

Branch `feat/evangelism-testimonies-slice-1`, cut from `origin/main` at 9f39b7ac.
**Migration 307 is NOT applied anywhere.** Do not apply it until Jack says so.

## What shipped

- **Submit** (`/evangelism`): a phone-friendly form with title, story,
  date, place, an optional ministry tag (active `staff_ministries`), people
  reached, decisions, outcome, an optional single photo and a consent box.
  You can save a draft or submit it for review. Below the form is a "My stories"
  list where you can edit while a story is draft/submitted and delete drafts.
- **Read** (`/evangelism`): a list of published stories for anyone with
  view access. Pure viewers do not see who wrote a story; the author and
  publishers do.
- **Review** (`/evangelism/queue`, publishers only): submitted stories,
  each with **Approve & publish** or **Withhold** (an optional reason that
  only publishers see). Anyone else is sent back to `/evangelism`.
- **Nav**: `evangelism` removed from `HIDDEN_FROM_NAV`. Admins see it. Anyone
  holding an `evangelism.*` key sees it through the usual module-permission
  path.

### API

| Route | Who |
|---|---|
| `GET /api/evangelism/testimonies` | view: published list. `?mine=1`: submit. `?status=submitted\|draft\|withheld`: publish only (403 otherwise) |
| `POST /api/evangelism/testimonies` | submit: create a draft, or a submitted story (needs consent), plus an optional `photo` |
| `GET/PATCH/DELETE /api/evangelism/testimonies/:id` | PATCH `{action: publish\|withhold}` for publishers. Otherwise the author edits while open. DELETE: own draft, or any story for a publisher |
| `POST /api/evangelism/media/sign` | submit: returns a signed upload URL into the private bucket at `testimonies/{user}/{uuid}.{ext}` |

Signed **read** URLs (30 min) are included on every GET, so there is no
separate refresh route. When the tables or bucket are missing, routes answer
`503 {code: "evangelism_not_enabled"}`. Every read and write uses the
caller's own client, so RLS decides. The service role is only used for
Storage (signing, deleting objects) and for author display names, which
`public.users` RLS hides from non-admins.

## Migration 307 — `307_evangelism_testimonies.sql`

307 was free on 9 Nov 2026: `origin/main` tops out at 304, 305 is the local
LMS slice, and no open PR or local branch uses 306 or 307.

- **Permission keys** are seeded but not granted to anyone:
  `evangelism.view`, `evangelism.submit`, `evangelism.publish`. publish ⊃
  submit ⊃ view. `super_admin` and `admin` get everything through `is_admin()`.
- **`evangelism_testimonies`** has the CHECKs from the brief: consent is
  required for submitted/published, published needs both stamps, and
  decisions ≤ people reached. A guard trigger stops anyone changing the
  author. It stops non-publishers from publishing, withholding or setting the
  stamps or the reason. When a publisher publishes, it **stamps `published_at = now()`
  and `published_by = auth.uid()`** itself, so a client can't backdate a
  publish or credit someone else.
- **`evangelism_media`** is photo only, with a 15 MB CHECK and a path shape
  CHECK. A photo is visible exactly when its parent story is. Inserts are only
  allowed onto your own open story, at a path under your own id. There is no
  UPDATE.
- **Bucket `evangelism-media`** is private, 15 MB, and accepts jpeg/png/webp/heic/heif.
  It has **no** `storage.objects` policies.
- A withheld story is hidden from its author too (only publishers and admins
  can see it).

## Tests

- `supabase/tests/evangelism_testimonies_rls.sql` covers admin, publisher,
  submitter, viewer, outsider and anon across every status. It also applies
  the migration twice. Its wrapper `src/lib/evangelism/rls.test.ts` skips
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
later slices on top is Jack's call.
