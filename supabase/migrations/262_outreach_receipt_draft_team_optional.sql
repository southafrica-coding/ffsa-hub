-- ────────────────────────────────────────────────────────────
-- 262 — A Slack receipt can wait for its team
--
-- Someone on several outreach teams who DMs a receipt without naming the
-- team used to be told to send it again. Now the bot reads it anyway and
-- the card asks them to pick the team; until they do, the draft has no
-- team and can't be logged (lib/slack/outreach/receipts).
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.outreach_receipt_drafts ALTER COLUMN team_id DROP NOT NULL;
