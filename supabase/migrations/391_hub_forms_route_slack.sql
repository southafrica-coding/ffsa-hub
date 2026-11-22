-- ============================================================
-- FFSA Hub — Migration 391: Hub Forms F3, Slack DMs from routes
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Do not apply until Jack OKs it. Previews share prod.
--
-- Depends on 044 (forms, form_submissions), 069 (users.slack_user_id)
-- and 390 (Hub Forms F1).
--
-- The route runner (src/lib/forms/route-runner.ts) DMs people when a
-- form's `slack` route fires, like the vehicle coordinator DMs
-- (vehicle_booking_slack_alerts, 234). When a house sends the same
-- week again, the DM is rewritten in place, so it has to remember
-- which message it sent: one row per form, subject, period and
-- person.
--
--   period_key: the meeting date for a house's weekly feedback,
--   otherwise the form_submissions id (nothing to rewrite).
--
-- Nothing sends unless HUB_FORMS_SLACK_ENABLED is on, and then only
-- on the live site (src/lib/forms/flags.ts). With the flag off this
-- table stays empty.
--
-- RLS on, no policies: service role only, like 234.
-- Idempotent. Rollback: supabase/rollbacks/391_hub_forms_route_slack.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.form_route_slack_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id             uuid NOT NULL REFERENCES public.forms (id) ON DELETE CASCADE,
  subject_type        text NOT NULL,
  subject_id          uuid,
  period_key          text NOT NULL CHECK (char_length(period_key) BETWEEN 1 AND 64),
  recipient_user_id   uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  form_submission_id  uuid REFERENCES public.form_submissions (id) ON DELETE SET NULL,
  slack_channel       text NOT NULL DEFAULT '',
  slack_ts            text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One DM per person per subject per week. subject_id is null for a
-- form with no subject; coalesce keeps those rows unique too.
CREATE UNIQUE INDEX IF NOT EXISTS form_route_slack_messages_key_uidx
  ON public.form_route_slack_messages (
    form_id,
    subject_type,
    coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_key,
    recipient_user_id
  );

DROP TRIGGER IF EXISTS set_updated_at ON public.form_route_slack_messages;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.form_route_slack_messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.form_route_slack_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.form_route_slack_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.form_route_slack_messages TO service_role;

COMMENT ON TABLE public.form_route_slack_messages IS
  'Slack DMs sent by Hub Forms slack routes (F3), so sending the form again rewrites the DM. Service role only.';

-- ============================================================
-- Validation (read-only)
-- ------------------------------------------------------------
--   SELECT count(*) FROM public.form_route_slack_messages;  -- 0
-- ============================================================
