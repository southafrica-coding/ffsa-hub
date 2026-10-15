-- ============================================================================
-- 240 — Slack: send as yourself ("Connect my Slack")
-- ============================================================================
-- A vehicle manager's message to a client used to come from the Hub bot, so
-- the client's reply went to the bot instead of to them. Now each manager
-- connects their own Slack once (OAuth, user scopes chat:write, im:write,
-- im:history) and the Hub sends as them: the client sees an ordinary DM from
-- that person and replies right there. The Hub reads that DM back onto the
-- booking so the conversation still lives in one place.
--
--   • slack_user_tokens — one row per connected Hub user. Holds a live Slack
--     user token: server-only (RLS on, no policies, admin client only).
--   • vehicle_booking_messages gains where the message landed in Slack
--     (channel + ts) and whether it went as the person (sent_as_user), so the
--     booking page can pull the DM thread from that point on.
--
-- Idempotent so it can be re-run from the SQL editor.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.slack_user_tokens (
  user_id       uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  slack_user_id text NOT NULL,
  team_id       text,
  access_token  text NOT NULL,
  scope         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slack_user_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vehicle_booking_messages
  ADD COLUMN IF NOT EXISTS slack_channel text,
  ADD COLUMN IF NOT EXISTS slack_ts      text,
  ADD COLUMN IF NOT EXISTS sent_as_user  boolean NOT NULL DEFAULT false;
