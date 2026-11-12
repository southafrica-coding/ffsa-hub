-- Test fixture only. Not Supabase Auth and not a product migration.
-- auth.uid() / auth.jwt() read session settings set by the harness before
-- SET ROLE authenticated. A real Supabase request JWT is not verified here.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supabase's service_role bypasses RLS. The receipt bot writes that way.
-- authenticated does not. This is the role attribute, not a policy.
ALTER ROLE service_role BYPASSRLS;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO anon, authenticated, service_role;

-- Local PostgREST only. Not a product migration and not Supabase Auth.
-- PostgREST puts the JWT in request.jwt.claims. auth.uid() reads
-- request.jwt.claim.sub. This copies sub across for the disposable database.
CREATE OR REPLACE FUNCTION public.harness_pgrst_claims() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(current_setting('request.jwt.claims', true)::json->>'sub', ''),
    true
  );
END $$;
REVOKE ALL ON FUNCTION public.harness_pgrst_claims() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_pgrst_claims() TO anon, authenticated, service_role;
