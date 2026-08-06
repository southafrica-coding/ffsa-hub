-- ============================================================
-- FFSA Hub — Migration 160: Household member contact fields
-- ------------------------------------------------------------
-- Spouses are now captured lightly during onboarding — just first
-- name, last name and email — so their own Hub account can be linked
-- later. Children still record the full passport / visa / insurance
-- set. These columns are nullable and additive; existing rows and the
-- children gate are unaffected. `full_name` remains populated (for
-- spouses it is set to "first last") so all existing consumers keep
-- working.
-- ============================================================

ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text,
  ADD COLUMN IF NOT EXISTS email      text;
