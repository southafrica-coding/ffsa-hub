-- Passport details are now mandatory for ALL staff, not just international
-- ones: South Africans must record their passport too (country + number +
-- expiry). Visa details stay gated behind is_international.
--
-- This adds the one column the schema was missing — passport_expiry_date.
-- passport_country / passport_number already exist (migration 005).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS passport_expiry_date date;
