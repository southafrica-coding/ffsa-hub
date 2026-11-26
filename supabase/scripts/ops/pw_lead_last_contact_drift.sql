-- Ops check (read-only): pw_songwriting_leads.last_contact_at drift.
--
-- last_contact_at is derived (424): max(pw_songwriting_lead_events.at) for
-- the lead, or null. The event trigger locks the lead row and recomputes it
-- on every event insert, delete and edit, so this should always return
-- drifted = 0. Run it in the SQL editor or psql; it only SELECTs and shows
-- ids and timestamps, no labels or notes.
--
-- If it ever finds drift, the repair (service_role / owner; the lead guard
-- only accepts the derived value) is:
--   UPDATE public.pw_songwriting_leads l
--      SET last_contact_at = (SELECT max(e.at) FROM public.pw_songwriting_lead_events e WHERE e.lead_id = l.id)
--    WHERE l.last_contact_at IS DISTINCT FROM
--          (SELECT max(e.at) FROM public.pw_songwriting_lead_events e WHERE e.lead_id = l.id);

WITH derived AS (
  SELECT l.id,
         l.last_contact_at AS stored,
         (SELECT max(e.at) FROM public.pw_songwriting_lead_events e WHERE e.lead_id = l.id) AS want
    FROM public.pw_songwriting_leads l
)
SELECT count(*) AS leads,
       count(*) FILTER (WHERE stored IS DISTINCT FROM want) AS drifted,
       coalesce(jsonb_agg(jsonb_build_object('id', id, 'stored', stored, 'want', want))
                  FILTER (WHERE stored IS DISTINCT FROM want), '[]'::jsonb) AS drifted_leads
  FROM derived;
