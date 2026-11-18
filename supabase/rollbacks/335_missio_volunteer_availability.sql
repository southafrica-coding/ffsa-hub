-- ============================================================
-- Rollback for 335_missio_volunteer_availability.sql
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Drops only the objects migration 335 created.
-- Does not touch organisations, org_people, contacts, or any
-- earlier Missio migration.
-- ============================================================

DROP TABLE IF EXISTS public.availability_responses;
DROP TABLE IF EXISTS public.availability_tokens;
DROP TABLE IF EXISTS public.availability_requests;
DROP TABLE IF EXISTS public.missio_team_members;
DROP TABLE IF EXISTS public.missio_team_leaders;
DROP TABLE IF EXISTS public.missio_teams;

DROP FUNCTION IF EXISTS public.availability_response_guard();
DROP FUNCTION IF EXISTS public.missio_volunteer_contact_in_org();
DROP FUNCTION IF EXISTS public.missio_volunteer_org_is_missio();
DROP FUNCTION IF EXISTS public.availability_dates_in_range(date, date, date[]);
