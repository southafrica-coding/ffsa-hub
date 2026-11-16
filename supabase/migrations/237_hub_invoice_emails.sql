-- ============================================================
-- FFSA Hub — Migration 237: school invoice emails sent by the Hub
-- ============================================================
-- Finance relies on a Xero email template per school, and each one carries
-- that school's bank details, its SnapScan or Stripe link and its fee
-- wording. Xero's API can't choose a template when it emails an invoice
-- (only someone picking from a dropdown in Xero can), so if the Hub had Xero
-- send the email, every school would get the default "Basic" one.
--
-- So the Hub sends the email itself, from a word-for-word copy of each Xero
-- template, with Xero's own placeholders filled the way Xero fills them, the
-- Xero invoice PDF attached, and the invoice marked sent in Xero.
--
-- invoice_email_templates: one row per Xero template, per organisation (the
--   SA and US companies word the same school differently). Seeded below
--   from Xero > Settings > Email settings > Templates, copied read-only on
--   2026-10-15; each body length was checked against Xero's. Editable in the
--   Hub, because finance edits these every intake.
-- programs: per school and per organisation, which template and which Xero
--   branding theme (by NAME; the Hub resolves the id in that org at send
--   time, since the SA and US ids differ).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_email_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  xero_region            text NOT NULL CHECK (xero_region IN ('za', 'us')),
  name                   text NOT NULL,
  subject                text NOT NULL,
  body                   text NOT NULL,
  -- Xero's "Include action to online invoice and detail summary" box.
  include_online_action  boolean NOT NULL DEFAULT true,
  -- Xero's default sales-invoice template ("Basic"): used when a school has
  -- none set, exactly as Xero would.
  is_default             boolean NOT NULL DEFAULT false,
  updated_by             uuid REFERENCES public.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (xero_region, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_email_templates_one_default
  ON public.invoice_email_templates (xero_region) WHERE is_default;

DROP TRIGGER IF EXISTS set_updated_at ON public.invoice_email_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.invoice_email_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.invoice_email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read invoice email templates"
  ON public.invoice_email_templates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Finance can write invoice email templates"
  ON public.invoice_email_templates FOR ALL
  USING (public.is_admin() OR public.has_role('finance_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('finance_admin'));

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS email_template_za_id uuid REFERENCES public.invoice_email_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_template_us_id uuid REFERENCES public.invoice_email_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS xero_branding_theme_za text,
  ADD COLUMN IF NOT EXISTS xero_branding_theme_us text;

COMMENT ON COLUMN public.programs.xero_branding_theme_za IS
  'Xero branding theme NAME in the SA organisation (prints this school''s bank details). Null = Xero default.';
COMMENT ON COLUMN public.programs.xero_branding_theme_us IS
  'Xero branding theme NAME in the US organisation. Null = Xero default (Standard, which has Stripe).';

-- ------------------------------------------------------------
-- Seed: every school template, word for word from Xero.
-- ------------------------------------------------------------
INSERT INTO public.invoice_email_templates (xero_region, name, subject, body, include_online_action, is_default)
VALUES
  ('za', $tpl$EFL Seminar (b2)$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you of the Educating for Life Seminar. 

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total]
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

Please EFT payment into the following account:
Account Holder: FF SA YWAM NPC
Bank name: First National Bank Limited
Account Number: 00000000000
Branch Code: 000000 
Reference: Initial & surname + Reason for payment (ex. A. Smith EFL) or Invoice Number

If you are outside of South Africa, you may wire transfer using the above payment details or use the following link to pay. If using this form of payment, we ask that you add 2.95% to the amount due.   

https://pos.snapscan.io/qr/SNAPSCAN_CODE

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('za', $tpl$FFBX$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you a part of the Fire & Fragrance Bible Experience in September.

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total]
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

If you are able, please EFT or wire transfer into the following account:
Account Holder: FF SA YWAM NPC
Bank name: First National Bank Limited
Account Number: 00000000000
Branch Code: 000000 (Universal Branch code)
Swift Address: SWIFT_CODE
Reference: Initial & last name - FFBX

If you are outside South Africa, you may wire transfer using the above payment details or the following link to pay. We ask that you add 3% to the amount due if using this form of payment.   

https://pos.snapscan.io/qr/SNAPSCAN_CODE 

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('za', $tpl$Gap Year 2027$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you as part of the Gap Year Experience in 2027.   

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total]
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

If you are able, please EFT into the following account:
Account Holder: FF SA NPC
Bank name: First National Bank Limited
Account Number: 00000000000
Address: BRANCH_ADDRESS
Branch Code: 000000 (Universal Branch code)
Swift Address: SWIFT_CODE
Reference: Initial & surname or Invoice Number

If you are outside of South Africa, you may wire transfer using the above payment details or use the following link to pay. If using this form of payment we ask that you add 3% to the amount due.   

https://pos.snapscan.io/qr/SNAPSCAN_CODE

From your online bill you can print a PDF, export a CSV, or create a free login and view your outstanding bills.

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('za', $tpl$Leadership Track$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you as a part of the Leadership Track in September

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total]
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

If you are able, please EFT or wire transfer into the following account:

Account Holder: FF SA YWAM NPC
Bank name: First National Bank Limited
Account Number: 00000000000
Branch Code: 000000 (Universal Branch code)
Reference: Initial & last name - Leadership 

If you are outside of South Africa, you may wire transfer using the above payment details or use the following link to pay. We ask that you add 3% to the amount due if using this form of payment.   

https://pos.snapscan.io/qr/SNAPSCAN_CODE

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('za', $tpl$Missio Retreat$tpl$, $tpl$Invoice [Invoice Number] from Missio Church for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you a part of the Missio Church Retreat

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

Name on Account: FF SA NPC
Bank: First National Bank 
Limited Account Number: 00000000000
Branch Code: 000000
Reference: Name + Retreat or Invoice Number

Please let us know if you have any questions

Thanks,
Missio Team$tpl$, true, false),
  ('za', $tpl$RR 2026$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you a part of Foundations for Revival and Reformation

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

FF SA YWAM NPCBank: First National Bank 
Limited Account Number: 00000000000
Branch Code: 000000
Reference: Name + RR or Invoice # 

Please let us know if you have any questions

Thanks,
[Trading Name]$tpl$, true, false),
  ('za', $tpl$SBS 2026$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We hope you are enjoying SBS. Here is an invoice for 50% of your Q2 fees. 

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total]
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

If you are able, please EFT or wire transfer into the following account:
Account Holder: FF SA YWAM NPC
Bank name: First National Bank Limited
Account Number: 00000000000
Branch Code: 000000 (Universal Branch code)
Swift Address: SWIFT_CODE
Reference: Initial & last name - SBS

If you are outside of South Africa, you may wire transfer using the above payment details or use the following link to pay. If using this form of payment we ask that you add 2.95% to the amount due.   

https://pos.snapscan.io/qr/SNAPSCAN_CODE 

From your online bill you can print a PDF, export a CSV, or create a free login and view your outstanding bills.

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('za', $tpl$STANDARD 1118$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

If you have a South African Bank account, please EFT into the following account:

FF SA YWAM NPC
Bank: First National Bank 
Limited Account Number: 00000000000 
Reference: Name + What you’re paying for     
or invoice number 

If you do not have a South African Bank account please use the snapscan link to pay. If paying via SnapScan please add 2.95% of your invoice amount before paying. 
https://pos.snapscan.io/qr/SNAPSCAN_CODE

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('za', $tpl$Uni OR$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you a part of the end of year outreach. 

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total]
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

Please EFT payment into the following account:
Account Holder: FF SA YWAM NPC
Bank name: First National Bank Limited
Account Number: 000 000 000 00 
Branch Code: 000000 
Reference: Initial & surname + Reason for payment (ex. A. Smith Camp) or Invoice Number

If you are outside of South Africa, you may wire transfer using the above payment details or use the following link to pay. If using this form of payment, we ask that you add 2.95% to the amount due.   

https://pos.snapscan.io/qr/SNAPSCAN_CODE

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('za', $tpl$Basic$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].

The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

From your online bill you can print a PDF, export a CSV, or create a free login and view your outstanding bills.

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, true),
  ('us', $tpl$FFBX 2026$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you a part of the Fire & Fragrance Bible Experience in September.

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View and pay your bill online: [Online Invoice Link]
From your online bill you can print a PDF, export a CSV, or create a free login and view your outstanding bills.

If you would like to make a partial payment you may use this link to do so - 
https://buy.stripe.com/PAYMENT_LINK 
Please note that there is a processing fee and the total attributed to your invoice will be the amount you pay less processing fees. 

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('us', $tpl$Gap Year 2027$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you as part of the Gap Year Experience in 2027.   

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View and pay your bill online: [Online Invoice Link]

If you would like to make a partial payment you may use this link to do so. Please note that there is a 3% transaction fee that will be taken from the amount paid. You are responsible for paying your school fees in full, including the 3% transaction fee - https://buy.stripe.com/PAYMENT_LINK

If you would prefer to send funds via wire transfer and reduce fees please respond to this email requesting wire transfer information. 

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('us', $tpl$Leadership Track$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you as a part of the Leadership Track in September.

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View and pay your bill online: [Online Invoice Link]
From your online bill you can print a PDF, export a CSV, or create a free login and view your outstanding bills.

If you would like to make a partial payment you may use this link to do so - 
https://buy.stripe.com/PAYMENT_LINK

Please note that there is a processing fee and the total attributed to your invoice will be the amount you pay less processing fees. 

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('us', $tpl$RR 2026$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you a part of Foundations of Revival and Reformation 

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View and pay your bill online: [Online Invoice Link]

If you would prefer to send funds via wire transfer and reduce fees please respond to this email requesting wire transfer information. 

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('us', $tpl$SBS 2026$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We hope you are enjoying SBS. Here is an invoice for 50% of your Q2 fees. 

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View and pay your bill online: [Online Invoice Link]
From your online bill you can print a PDF, export a CSV, or create a free login and view your outstanding bills.

If you would like to make a partial payment you may use this link to do so - 
https://buy.stripe.com/PAYMENT_LINK
Please note that there is a 3% processing fee and the total attributed to your invoice will be the amount you pay less processing fees. 

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('us', $tpl$DTS 2024.3$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you a part of DTS beginning in June 2024.

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View and pay your bill online: [Online Invoice Link]

If you would like to make a partial payment you may use this link to do so - https://buy.stripe.com/PAYMENT_LINK

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('us', $tpl$Kona LT$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

We look forward to having you with us in South Africa for the FF Kona Leadership track. 

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].
The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View and pay your bill online: [Online Invoice Link]
From your online bill you can print a PDF, export a CSV, or create a free login and view your outstanding bills.

If you would like to make a partial payment you may use this link to do so - 
https://buy.stripe.com/PAYMENT_LINK
Please note that there is a 2.9% processing fee and the total attributed to your invoice will be the amount you pay less processing fees. 

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, false),
  ('us', $tpl$Basic$tpl$, $tpl$Invoice [Invoice Number] from [Trading Name] for [Contact Name]$tpl$, $tpl$Hi [Contact First Name],

Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].

The amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].

View your bill online: [Online Invoice Link]

From your online bill you can print a PDF, export a CSV, or create a free login and view your outstanding bills.

If you have any questions, please let us know.

Thanks,
[Trading Name]$tpl$, true, true)
ON CONFLICT (xero_region, name) DO NOTHING;

-- ------------------------------------------------------------
-- Pre-fill the schools finance named (Sample Person 50, 2026-10-15). Matched on the
-- school code so a rename can't break it; anything unmatched stays empty and
-- falls back to Xero's defaults until someone picks in the Billing panel.
-- ------------------------------------------------------------
UPDATE public.programs p SET
  email_template_za_id = (SELECT id FROM public.invoice_email_templates WHERE xero_region = 'za' AND name = 'SBS 2026'),
  email_template_us_id = (SELECT id FROM public.invoice_email_templates WHERE xero_region = 'us' AND name = 'SBS 2026'),
  xero_branding_theme_za = 'SBS'
WHERE p.code = 'FFSBI';

UPDATE public.programs p SET
  email_template_za_id = (SELECT id FROM public.invoice_email_templates WHERE xero_region = 'za' AND name = 'Leadership Track'),
  email_template_us_id = (SELECT id FROM public.invoice_email_templates WHERE xero_region = 'us' AND name = 'Leadership Track'),
  xero_branding_theme_za = 'Intern'
WHERE p.code IN ('L-TRACK', 'TRACK');

UPDATE public.programs p SET
  email_template_za_id = (SELECT id FROM public.invoice_email_templates WHERE xero_region = 'za' AND name = 'Gap Year 2027'),
  email_template_us_id = (SELECT id FROM public.invoice_email_templates WHERE xero_region = 'us' AND name = 'Gap Year 2027'),
  xero_branding_theme_za = 'Gap Year'
WHERE p.code = 'FFSAX2027';

UPDATE public.programs p SET
  email_template_za_id = (SELECT id FROM public.invoice_email_templates WHERE xero_region = 'za' AND name = 'FFBX'),
  email_template_us_id = (SELECT id FROM public.invoice_email_templates WHERE xero_region = 'us' AND name = 'FFBX 2026'),
  xero_branding_theme_za = 'FFBX'
WHERE p.code = 'FFBX26';

-- Validation
--   SELECT xero_region, count(*), count(*) FILTER (WHERE is_default) FROM public.invoice_email_templates GROUP BY 1;
--   -- expect za 10 (1 default), us 8 (1 default)
--   SELECT code, xero_branding_theme_za, email_template_za_id IS NOT NULL, email_template_us_id IS NOT NULL FROM public.programs;

-- ROLLBACK:
--   ALTER TABLE public.programs DROP COLUMN IF EXISTS email_template_za_id, DROP COLUMN IF EXISTS email_template_us_id,
--     DROP COLUMN IF EXISTS xero_branding_theme_za, DROP COLUMN IF EXISTS xero_branding_theme_us;
--   DROP TABLE IF EXISTS public.invoice_email_templates;
