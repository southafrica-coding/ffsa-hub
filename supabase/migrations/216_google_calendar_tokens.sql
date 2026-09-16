-- ============================================================
-- FFSA Hub — Google Calendar Integration
-- ============================================================
-- Stores the OAuth2 tokens used to share the FFSA base calendar
-- with staff during onboarding. Single-row store (key = 'default').
-- ============================================================

CREATE TABLE public.google_calendar_tokens (
  key             text PRIMARY KEY DEFAULT 'default',
  refresh_token   text NOT NULL,
  access_token    text,
  expires_at      timestamptz,
  connected_by    uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.google_calendar_tokens
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage google calendar tokens"
  ON public.google_calendar_tokens FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
