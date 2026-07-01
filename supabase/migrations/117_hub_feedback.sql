-- ============================================================
-- FFSA Hub — Feedback intake & triage (Phase 1)
-- ============================================================
-- Backs the private Slack DM intake bot. Staff report Hub
-- problems/ideas in a 1:1 DM with the bot; each finished report
-- becomes a hub_issue_report, deduped onto a canonical hub_issue,
-- and surfaced in the private #hub-triage channel.
--
-- Access is server-side only, via the service-role admin client
-- (createAdminClient). RLS is ENABLED with NO policies so the
-- tables are unreachable from the anon/authenticated clients —
-- the service role bypasses RLS. Nothing here is user-facing.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. hub_issues — the canonical, deduplicated item
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_issues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  title             text NOT NULL,
  summary           text NOT NULL,
  area              text,                         -- Hub section, e.g. "Dashboard", "Training"
  type              text NOT NULL DEFAULT 'bug'   -- bug | idea | question
                      CHECK (type IN ('bug', 'idea', 'question')),
  size              text                          -- cosmetic | small_logic | big
                      CHECK (size IS NULL OR size IN ('cosmetic', 'small_logic', 'big')),
  danger_zone       boolean NOT NULL DEFAULT false,
  proposed_lane     text                          -- auto_ship | build_on_approval | product_decision
                      CHECK (proposed_lane IS NULL OR proposed_lane IN ('auto_ship', 'build_on_approval', 'product_decision')),
  status            text NOT NULL DEFAULT 'open'  -- open | in_progress | shipped | dismissed
                      CHECK (status IN ('open', 'in_progress', 'shipped', 'dismissed')),
  reporter_count    integer NOT NULL DEFAULT 1,
  media             jsonb NOT NULL DEFAULT '[]'::jsonb,   -- aggregated media refs across reports
  triage            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- raw classifier output
  triage_channel_ts text,                         -- ts of the brief posted in #hub-triage
  resolution        text
);

-- Dedup shortlist: fetch open issues in the same area cheaply.
CREATE INDEX IF NOT EXISTS idx_hub_issues_open_area
  ON public.hub_issues (area)
  WHERE status = 'open';

ALTER TABLE public.hub_issues ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- 2. hub_issue_reports — each individual submission (many → 1 issue)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_issue_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  issue_id           uuid NOT NULL REFERENCES public.hub_issues(id) ON DELETE CASCADE,
  reporter_slack_id  text NOT NULL,
  reporter_hub_user_id uuid REFERENCES public.users(id),
  reporter_name      text,
  reporter_email     text,
  report_text        text NOT NULL,               -- synthesized description from the DM
  transcript         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- raw Q&A turns
  media              jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_hub_issue_reports_issue
  ON public.hub_issue_reports (issue_id);

ALTER TABLE public.hub_issue_reports ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- 3. hub_intake_sessions — in-progress DM conversation state
--    (serverless is stateless, so the conversation lives here)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_intake_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  slack_user_id  text NOT NULL,
  dm_channel_id  text NOT NULL,
  status         text NOT NULL DEFAULT 'active'   -- active | completed | abandoned
                   CHECK (status IN ('active', 'completed', 'abandoned')),
  transcript     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ role, text, ts }]
  collected      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- running structured understanding
  media          jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_event_id  text                             -- last processed Slack event_id (idempotency)
);

-- At most one ACTIVE intake session per user; past sessions retained.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hub_intake_active_user
  ON public.hub_intake_sessions (slack_user_id)
  WHERE status = 'active';

ALTER TABLE public.hub_intake_sessions ENABLE ROW LEVEL SECURITY;
