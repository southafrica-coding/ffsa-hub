-- ============================================================
-- FFSA Hub — Migration 254: In-app AI assistant (chat bubble)
-- ============================================================
-- Audit log + usage counter for the Claude chat bubble shown on every
-- admin/portal page (src/components/assistant, src/app/api/assistant).
--
-- One row per question: who asked, on which page, which tools ran, the
-- answer, the model and token usage. The API route also counts a user's
-- rows in the last 24h to enforce AI_ASSISTANT_DAILY_TOKENS.
--
-- Rows are written with the signed-in user's own client, so users may
-- insert and read ONLY their own rows. Admins can read everything.
--
-- Append-only. Idempotent. Apply by hand in the Supabase SQL Editor,
-- then regenerate types: supabase gen types … > src/types/database.ts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_assistant_queries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  page_path      text,                    -- e.g. /events/<id>
  question       text NOT NULL,
  tool_calls     jsonb,                   -- [{name, input}]
  answer         text,                    -- null when the run failed
  model_used     text,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  latency_ms     integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_assistant_queries_user
  ON public.ai_assistant_queries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_assistant_queries_created
  ON public.ai_assistant_queries (created_at DESC);

COMMENT ON TABLE public.ai_assistant_queries IS
  'Audit log of the in-app Claude assistant (chat bubble). One row per question. Written with the asking user''s client; used for the daily per-user limit.';

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.ai_assistant_queries ENABLE ROW LEVEL SECURITY;

-- Users read their own rows (needed for the daily limit count).
DROP POLICY IF EXISTS ai_assistant_queries_select_own ON public.ai_assistant_queries;
CREATE POLICY ai_assistant_queries_select_own
  ON public.ai_assistant_queries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins read everything (usage review).
DROP POLICY IF EXISTS ai_assistant_queries_select_admin ON public.ai_assistant_queries;
CREATE POLICY ai_assistant_queries_select_admin
  ON public.ai_assistant_queries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name IN ('super_admin', 'admin')
    )
  );

-- Users can only log questions as themselves.
DROP POLICY IF EXISTS ai_assistant_queries_insert_own ON public.ai_assistant_queries;
CREATE POLICY ai_assistant_queries_insert_own
  ON public.ai_assistant_queries FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No UPDATE / DELETE policies: the log is append-only for users.

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname = 'ai_assistant_queries';   -- relrowsecurity = true
--
--   SELECT policyname FROM pg_policies
--   WHERE tablename = 'ai_assistant_queries'; -- 3 rows
-- ============================================================
