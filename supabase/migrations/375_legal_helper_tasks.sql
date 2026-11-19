-- DO NOT APPLY until Jack says so. Needs 370–374 first.
-- ============================================================
-- FFSA Hub — Migration 375: Legal → Documents (helper background tasks)
-- ============================================================
-- The legal helper can hand a bigger job ("prepare everything for the PBO
-- renewal") to the background, so the legal officer can carry on while it
-- works. A task row records the request, its progress and the result; the
-- work itself only ever produces DRAFTS (374), which still need the
-- owner's approval.
--
-- Unlike the chat, a task IS stored — it has to be, to run unattended and
-- report back. It sits behind the same wall: only whole-module members
-- (legal_has_access, 371) read it; no role reaches it.
--
-- The runner works AS THE PERSON WHO ASKED (their session, in the same
-- request, via next/server after()), so RLS applies to every step.
-- heartbeat_at shows it is alive; a running task whose heartbeat is older
-- than a few minutes is shown as stopped and can be run again.
--
-- No event-log trigger: heartbeats would flood legal_events. The drafts a
-- task saves are logged as usual.
-- Additive only. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.legal_helper_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  request       text NOT NULL CHECK (length(request) BETWEEN 1 AND 20000),
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress      text CHECK (progress IS NULL OR length(progress) <= 300),
  result        text CHECK (result IS NULL OR length(result) <= 20000),
  draft_ids     uuid[] NOT NULL DEFAULT '{}',
  error         text CHECK (error IS NULL OR length(error) <= 1000),
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_by    uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE CASCADE,
  started_at    timestamptz,
  heartbeat_at  timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_helper_tasks_recent_idx ON public.legal_helper_tasks (created_at DESC);

DROP TRIGGER IF EXISTS legal_helper_tasks_updated_at ON public.legal_helper_tasks;
CREATE TRIGGER legal_helper_tasks_updated_at BEFORE UPDATE ON public.legal_helper_tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.legal_helper_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.legal_helper_tasks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.legal_helper_tasks TO authenticated;
GRANT ALL ON TABLE public.legal_helper_tasks TO service_role;

-- Whole-module members only (not per-folder helpers): a task can touch
-- any folder.
DROP POLICY IF EXISTS "Legal helper tasks: read" ON public.legal_helper_tasks;
CREATE POLICY "Legal helper tasks: read"
  ON public.legal_helper_tasks FOR SELECT TO authenticated
  USING (public.legal_has_access());
DROP POLICY IF EXISTS "Legal helper tasks: insert" ON public.legal_helper_tasks;
CREATE POLICY "Legal helper tasks: insert"
  ON public.legal_helper_tasks FOR INSERT TO authenticated
  WITH CHECK (public.legal_has_access(true) AND created_by = auth.uid());
DROP POLICY IF EXISTS "Legal helper tasks: update" ON public.legal_helper_tasks;
CREATE POLICY "Legal helper tasks: update"
  ON public.legal_helper_tasks FOR UPDATE TO authenticated
  USING (public.legal_has_access(true))
  WITH CHECK (public.legal_has_access(true));
DROP POLICY IF EXISTS "Legal helper tasks: delete" ON public.legal_helper_tasks;
CREATE POLICY "Legal helper tasks: delete"
  ON public.legal_helper_tasks FOR DELETE TO authenticated
  USING (public.legal_has_access(true) AND (created_by = auth.uid() OR public.legal_is_owner()));

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'legal_helper_tasks'; -- true
--   SELECT count(*) FROM pg_policies WHERE tablename = 'legal_helper_tasks'; -- 4
-- ============================================================
