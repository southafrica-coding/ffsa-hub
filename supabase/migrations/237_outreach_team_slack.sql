-- ────────────────────────────────────────────────────────────
-- 237 — Outreach teams in Slack
--
-- Teams can ask the Slack bot about their budget ("how much is left in
-- food?"), by DM or by @mentioning it in their team channel.
--
--   slack_enabled     — the rollout switch. Off by default: the bot only
--                       answers outreach questions for teams switched on,
--                       so it can be tested on one team first.
--   slack_channel_id  — the team's Slack channel (C… / G… id). An
--                       @mention there is always about this team. One
--                       channel belongs to at most one team.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.outreach_teams
  ADD COLUMN IF NOT EXISTS slack_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slack_channel_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_teams_slack_channel
  ON public.outreach_teams(slack_channel_id)
  WHERE slack_channel_id IS NOT NULL;
