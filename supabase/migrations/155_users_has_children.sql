-- ============================================================
-- FFSA Hub — Migration 155: users.has_children
-- ------------------------------------------------------------
-- Staff must now declare whether they have children, and (if so) record
-- each child's full details before they can continue using the Hub. This
-- adds the flag that drives that blocking gate.
--
--   NULL  → not yet answered  (every existing staff member is re-prompted
--           once on their next login)
--   false → "I have no children" (remembered; never asked again)
--   true  → has children → the profile-completion gate then requires at
--           least one fully-complete child record (household_members,
--           migration 153) before the Hub unblocks.
--
-- No RLS change: the existing public.users policies already cover this
-- column (users read/update their own row; admins manage all).
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS has_children boolean;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT id, signup_type, has_children FROM public.users LIMIT 5;
--   -- all existing rows should be NULL (unanswered) until they log in.
-- ============================================================
