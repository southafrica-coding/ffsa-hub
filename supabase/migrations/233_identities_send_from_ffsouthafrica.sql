-- ============================================================
-- FFSA Hub — Migration 233: send From the staff domain, reply via the Hub
-- ============================================================
-- Staff know ffsouthafrica.com (their Google Workspace domain); the
-- ffsahub.com addresses confused things. ffsouthafrica.com is now verified
-- in Resend for SENDING (its incoming mail stays with Google), so every
-- identity:
--
--   From:        admin@ffsouthafrica.com            (what people see)
--   Reply-To:    its old team address @ffsahub.com  (where the Hub receives
--                replies → Inbox + contact timeline)
--   Forward to:  media@ffsouthafrica.com            (every reply, to Gmail)
--   Hub replies: sent from admin@ffsouthafrica.com
--
-- Inbound routing matches To against reply_to as well as from_email, so each
-- reply still lands under the right team.
--
-- Data only. Re-runnable: the reply_to copy only happens while from_email is
-- still the ffsahub.com address.
-- ============================================================

INSERT INTO public.sending_domains (domain)
VALUES ('ffsouthafrica.com')
ON CONFLICT (domain) DO NOTHING;

UPDATE public.sending_identities
SET reply_to = from_email
WHERE lower(from_email) LIKE '%@ffsahub.com';

UPDATE public.sending_identities si
SET from_email       = 'admin@ffsouthafrica.com',
    reply_from_email = 'admin@ffsouthafrica.com',
    forward_to       = ARRAY['media@ffsouthafrica.com'],
    domain_id        = (SELECT id FROM public.sending_domains WHERE domain = 'ffsouthafrica.com');
