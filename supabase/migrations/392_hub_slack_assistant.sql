-- ============================================================
-- FFSA Hub — Migration 392: the private "Hub" Slack assistant
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Do not apply until Jack OKs it. Previews share prod.
--
-- Depends on 001 (users, audit_logs) and 126 (staff_ministries).
--
-- Ministry leaders DM a separate Slack app, "Hub", to see their
-- team's Hub access, grant or revoke permissions, resend invites
-- and report problems (src/lib/slack/assistant/hub-leader,
-- docs/slack/hub-assistant.md). Three tables:
--
--   slack_assistant_pending_actions  a change waiting on the
--     leader's Confirm click. The Slack button carries only the id;
--     the change is re-checked from scratch on Confirm, then the
--     row is closed (consumed_at / cancelled_at) with a conditional
--     update, so a double click or replay can't run it twice.
--     Expires after 10 minutes.
--   slack_assistant_tickets  problem reports for the Hub team.
--   slack_assistant_audit_log  everything the assistant proposed,
--     did, refused or cancelled. Executed changes are also written
--     to audit_logs (user_id = the leader).
--
-- RLS on, no policies for anon or authenticated: the bot has no
-- logged-in user and reaches these only with the service-role
-- client (createAdminClient), like 234 and 391. Nothing here holds
-- a token or secret.
--
-- Nothing writes to these tables unless HUB_SLACK_ASSISTANT_ENABLED
-- is on, and then only on the live site
-- (src/lib/slack/assistant/hub-leader/flags.ts).
--
-- Idempotent. Rollback: supabase/rollbacks/392_hub_slack_assistant.sql.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. slack_assistant_pending_actions
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.slack_assistant_pending_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_hub_user_id  uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  slack_user_id       text NOT NULL,
  slack_channel_id    text,
  action_type         text NOT NULL
                        CHECK (action_type IN ('grant_permission', 'revoke_permission', 'resend_invite')),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at         timestamptz,
  cancelled_at        timestamptz,
  result              text CHECK (result IS NULL OR char_length(result) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_slack_assistant_pending_leader
  ON public.slack_assistant_pending_actions (leader_hub_user_id, created_at DESC);

ALTER TABLE public.slack_assistant_pending_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slack_assistant_pending_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.slack_assistant_pending_actions TO service_role;

COMMENT ON TABLE public.slack_assistant_pending_actions IS
  'Changes the Hub Slack assistant proposed, waiting on the leader''s Confirm click (10 minutes). Service role only.';

-- ────────────────────────────────────────────────────────────
-- 2. slack_assistant_tickets
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.slack_assistant_tickets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_hub_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  slack_user_id         text NOT NULL,
  ministry_ids          uuid[] NOT NULL DEFAULT '{}',
  ministry_names        text[] NOT NULL DEFAULT '{}',
  message               text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slack_assistant_tickets_open
  ON public.slack_assistant_tickets (created_at DESC) WHERE status = 'open';

DROP TRIGGER IF EXISTS set_updated_at ON public.slack_assistant_tickets;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.slack_assistant_tickets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.slack_assistant_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slack_assistant_tickets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.slack_assistant_tickets TO service_role;

COMMENT ON TABLE public.slack_assistant_tickets IS
  'Problem reports ministry leaders filed through the Hub Slack assistant. Service role only.';

-- ────────────────────────────────────────────────────────────
-- 3. slack_assistant_audit_log
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.slack_assistant_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_hub_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  slack_user_id       text NOT NULL,
  action              text NOT NULL,
  target_user_id      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  pending_action_id   uuid REFERENCES public.slack_assistant_pending_actions (id) ON DELETE SET NULL,
  payload             jsonb,
  result              text NOT NULL
                        CHECK (result IN ('proposed', 'executed', 'refused', 'failed', 'cancelled')),
  detail              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slack_assistant_audit_created
  ON public.slack_assistant_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slack_assistant_audit_target
  ON public.slack_assistant_audit_log (target_user_id) WHERE target_user_id IS NOT NULL;

ALTER TABLE public.slack_assistant_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slack_assistant_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.slack_assistant_audit_log TO service_role;

COMMENT ON TABLE public.slack_assistant_audit_log IS
  'Everything the Hub Slack assistant proposed, did, refused or cancelled. Service role only.';

-- ============================================================
-- Validation (read-only)
-- ------------------------------------------------------------
--   SELECT count(*) FROM public.slack_assistant_pending_actions;  -- 0
--   SELECT count(*) FROM public.slack_assistant_tickets;          -- 0
--   SELECT count(*) FROM public.slack_assistant_audit_log;        -- 0
-- ============================================================
