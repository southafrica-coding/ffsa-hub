-- ============================================================
-- FFSA Hub — Migration 209: Stop user_roles collecting duplicates
-- ============================================================
-- user_roles has a unique constraint on
-- (user_id, role_id, scope_type, scope_id). For a SCOPED grant that works.
-- For an UNSCOPED one it does nothing at all: scope_type and scope_id are
-- both NULL, and in SQL NULL is never equal to NULL, so every "duplicate"
-- unscoped row is a distinct row as far as the constraint is concerned.
--
-- Every ON CONFLICT in the app names those four columns, so none of them ever
-- fired on an unscoped grant either — the upserts have been plain inserts all
-- along. set-membership-role re-granted self_service on every single call
-- (it deletes the three membership roles first, but not self_service, which
-- nearly everyone already holds), so the table accumulated one extra row per
-- membership change. 91 duplicate rows across 87 groups at the time of
-- writing.
--
-- Nothing was mis-granted — a duplicate row carries exactly the access the
-- row it duplicates already carried, and every permission lookup joins and
-- de-duplicates. It is untidy rather than dangerous. But it grows forever,
-- and it means the constraint everyone is relying on isn't real.
--
-- The three code paths that would have started erroring once the index below
-- exists were fixed alongside this migration: grant-role, set-membership-role
-- and convert-to-community now check what the person already holds and insert
-- only what is missing, rather than leaning on ON CONFLICT.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Remove the existing duplicates.
--
--    Keeps the earliest row of each set (assigned_at, then ctid to break
--    ties deterministically). IS NOT DISTINCT FROM is what makes NULL scope
--    columns compare equal here — the exact comparison the unique constraint
--    refuses to make.
-- ────────────────────────────────────────────────────────────
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.role_id = b.role_id
  AND a.scope_type IS NOT DISTINCT FROM b.scope_type
  AND a.scope_id   IS NOT DISTINCT FROM b.scope_id
  AND (a.assigned_at, a.ctid) > (b.assigned_at, b.ctid);

-- ────────────────────────────────────────────────────────────
-- 2. Make it impossible to reintroduce.
--
--    A partial unique index over just (user_id, role_id) for the unscoped
--    case — the gap the four-column constraint leaves open. Scoped rows are
--    already covered by that constraint and are untouched here.
--
--    Note for anyone adding a new insert path: this index CANNOT be used as
--    an ON CONFLICT target. Postgres will not infer a partial index's
--    predicate from a bare column list, so `ON CONFLICT (user_id, role_id)
--    DO NOTHING` raises 42P10 rather than silently skipping. Check for the
--    existing row first, the way grant-role does.
-- ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS one_unscoped_role_per_user
  ON public.user_roles (user_id, role_id)
  WHERE scope_type IS NULL AND scope_id IS NULL;
