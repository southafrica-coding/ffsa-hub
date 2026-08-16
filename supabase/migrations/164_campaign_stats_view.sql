-- ============================================================
-- FFSA Hub — Migration 164: Per-campaign delivery stats view
-- ============================================================
-- The Communications list wants an open rate and a click rate on
-- every campaign row. The per-campaign read (getCampaignStats)
-- costs seven head-count queries against campaign_recipients, so a
-- 25-row list would fire ~175 round trips. This view collapses the
-- same seven numbers into one aggregate row per campaign, letting
-- the list fetch them all in a single request.
--
-- The counts MUST stay identical to getCampaignStats in
-- src/services/campaigns.ts, or the list and the campaign detail
-- page would quote different numbers for the same email:
--   total        — every recipient row
--   sent         — sent_at IS NOT NULL
--   delivered    — delivered_at IS NOT NULL
--   opened       — opened_at IS NOT NULL
--   clicked      — first_clicked_at IS NOT NULL
--   bounced      — bounced_at IS NOT NULL *and still undelivered*.
--                  A transient bounce (e.g. Mailtrap
--                  "hourly_rate_exceeded") stamps bounced_at on the
--                  first attempt but later succeeds and sets
--                  delivered_at; those are not real bounces.
--   unsubscribed — unsubscribed_at IS NOT NULL
--
-- Driven off campaigns with a LEFT JOIN so that a campaign with no
-- recipients yet (every draft) still gets a row of zeros rather
-- than vanishing from the result — the caller can then tell "no
-- data yet" apart from "view missing".
--
-- Creates nothing but a view: no table is dropped or altered.
--
-- SECURITY
-- ------------------------------------------------------------
-- A view normally runs with its OWNER's rights, which would let any
-- caller read campaign_recipients straight through the view and
-- bypass that table's RLS. security_invoker = true (PG15+, which
-- Supabase runs) makes the view execute as the CALLER, so the
-- existing campaign_recipients / campaigns policies still decide
-- what each user can count. Nothing here widens access.
-- ============================================================

-- Re-runnable: drop first so the security option is re-applied even
-- if an older definition of the view is already present.
DROP VIEW IF EXISTS public.v_campaign_stats;

CREATE VIEW public.v_campaign_stats
WITH (security_invoker = true) AS
SELECT
  c.id                                AS campaign_id,
  COUNT(r.id)::int                    AS total,
  COUNT(r.sent_at)::int               AS sent,
  COUNT(r.delivered_at)::int          AS delivered,
  COUNT(r.opened_at)::int             AS opened,
  COUNT(r.first_clicked_at)::int      AS clicked,
  (COUNT(r.id) FILTER (
     WHERE r.bounced_at IS NOT NULL AND r.delivered_at IS NULL
   ))::int                            AS bounced,
  COUNT(r.unsubscribed_at)::int       AS unsubscribed
FROM public.campaigns c
LEFT JOIN public.campaign_recipients r ON r.campaign_id = c.id
GROUP BY c.id;

COMMENT ON VIEW public.v_campaign_stats IS
  'One row per campaign with its delivery counters (total/sent/delivered/opened/clicked/bounced/unsubscribed). Mirrors getCampaignStats exactly so the campaigns list and the campaign detail page can never disagree. security_invoker so the caller''s RLS on campaign_recipients still applies.';

-- Explicit grants: the app reads this as the signed-in user. Row
-- visibility is still governed by RLS on the underlying tables
-- (security_invoker above), this only opens the view object itself.
GRANT SELECT ON public.v_campaign_stats TO authenticated;
GRANT SELECT ON public.v_campaign_stats TO service_role;

-- No new index needed: idx_campaign_recipients_campaign
-- (migration 045) already serves the group-by.

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- View exists and is security_invoker:
--   SELECT relname, reloptions FROM pg_class
--   WHERE relname = 'v_campaign_stats';
--   -- expect reloptions to contain security_invoker=true
--
--   -- One row per campaign:
--   SELECT (SELECT count(*) FROM public.campaigns)
--        = (SELECT count(*) FROM public.v_campaign_stats) AS matches;
--   -- expect: true
--
--   -- Spot-check one sent campaign against the detail page numbers:
--   SELECT * FROM public.v_campaign_stats
--   WHERE campaign_id = '<a sent campaign id>';
-- ============================================================
