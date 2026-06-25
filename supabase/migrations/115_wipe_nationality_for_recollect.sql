-- ────────────────────────────────────────────────────────────
-- 115 — Wipe nationality to force a clean re-collection
-- ────────────────────────────────────────────────────────────
-- The Nationality question now uses a country-name dropdown (matching
-- country_tiers, which the fee tier is keyed on). Previously the value was
-- either auto-derived from an applicant's home country or stored as a free
-- nationality adjective, so the data on file is inconsistent.
--
-- Null every user's nationality so the ProfileCompletionGate (which already
-- treats nationality as required) blocks each user on their next login until
-- they re-pick from the new dropdown. Hard reset — no backup is kept, per the
-- decision to fully re-collect this field.
--
-- Safe to run: nationality is a nullable text column; nulling it does not fire
-- the auto_create_student_fee trigger (that only runs on enrollment INSERT),
-- and existing student_fees rows are unaffected (tiers are stored, not
-- recomputed). Only future fee assignments read the re-collected value.

UPDATE public.users SET nationality = NULL;
