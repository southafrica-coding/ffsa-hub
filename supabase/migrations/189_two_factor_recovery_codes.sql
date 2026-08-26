-- Two-factor authentication: recovery codes.
--
-- The TOTP secret itself is NOT stored here. Supabase Auth generates, vaults and
-- verifies it (auth.mfa_factors) — it never reaches our schema, our API
-- responses or our logs. What Supabase does not provide is recovery codes, so
-- that is the one piece we own.
--
-- Only hashes are stored (SHA-256 of the normalised code). A code is single-use:
-- redeeming it stamps used_at, and it can never be redeemed again.

create table if not exists public.user_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_recovery_codes_user_id_idx
  on public.user_recovery_codes (user_id);

-- One hash can only exist once per user, so a regenerate can never collide with
-- a live code and a code can never be double-inserted.
create unique index if not exists user_recovery_codes_user_hash_idx
  on public.user_recovery_codes (user_id, code_hash);

-- RLS on with NO policies: no anon/authenticated client can read, write or even
-- count these rows. Every legitimate touch goes through the service-role client
-- in our route handlers, which bypasses RLS. A user must never be able to read
-- their own hashes back out.
alter table public.user_recovery_codes enable row level security;

comment on table public.user_recovery_codes is
  'Single-use 2FA recovery codes (SHA-256 hashes only). Service-role access only.';
