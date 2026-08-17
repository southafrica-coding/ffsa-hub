# Communications — handoff

Frames 29a–31e in `FFSA Hub Redesign.dc.html`. This module is the backbone every other
module sends through, so build it before adding more modules on top of it.

Channels in scope: **email**, **in-hub notifications**, and Slack for staff later.
No SMS or WhatsApp yet (an SMS fallback appears in 29g as a placeholder only).

---

## 1. The model

Every message the Hub sends is a row in one table, whatever caused it.

```
messages
  id, person_id, channel ('email' | 'in_hub'),
  source_kind ('campaign' | 'moment' | 'sequence' | 'by_hand' | 'transactional'),
  source_id,                      -- campaign / moment / sequence step / user
  subject, body_rendered, from_identity_id,
  reason text,                    -- WHY SHE GOT IT, in plain words
  sent_at, state, opened_count, first_opened_at, clicked_count, replied_at,
  bounce_kind null, bounce_detail null
```

`reason` is not decoration. It is what 29d's "why she got it" column reads, and it is the
difference between apologising blindly and knowing what fired. Write it at send time
("She is in DTS 26-2 students", "Her payment cleared", "60 days before she arrived").

Everything else hangs off this: the person log (29d), the campaign report (29c),
deliverability (29e) and each module's own mail tab are all views over `messages`.

## 2. Campaigns and the composer (29a, 30a–30c)

```
campaigns (id, name, subject, preheader, from_identity_id, audience_id,
           state, scheduled_for, sent_at, created_by)
campaign_blocks (id, campaign_id, sort_order, kind, content_json)
```

Blocks: masthead, heading, text, photo, two-column, button, rule, prayer points, event,
giving, footer. **One column only** — a newsletter that behaves like a web page breaks in
Outlook. Render to email HTML with tables and inline styles; the composer preview and the
sent email must come from the same renderer.

The masthead, type scale, yellow and footer are **not editable in the composer**. That is
what makes it safe to hand to any staff member.

Before sending: a last-check screen (30a) restating what / from / to / when, counting who
is excluded and why, and saying an email cannot be unsent. Scheduling (30b) recommends
07:00 from the org's own open curve. Test sends are recorded with recipients.

## 3. Audiences (29b)

```
audiences (id, name, kind ('rule' | 'static'), rule_json, created_by)
audience_members (audience_id, person_id)      -- static only
```

A rule audience recounts itself at send time; never store its members. Always show the
**excluded** counts — unsubscribed, bouncing, no address — by reason. Silently dropping
people is how a send of 2 418 becomes 2 371 with nobody noticing.

Scoping: school leaders may send to their school's people, ministry leaders to their team.
Anything wider goes to a comms/leadership approval queue (**not yet designed** — the next
gap after this build).

## 4. Consent and POPIA (31c, 31d)

```
consent_events                        -- append-only, never editable by hand
  id, person_id, at, kind ('opted_in' | 'confirmed' | 'muted_topic' |
  'unsubscribed' | 'objected' | 'deleted_request'),
  topic null, source ('web_form' | 'event_signup' | 'application' | 'donation' |
  'staff_entry' | 'import'), evidence_json (ip, user agent, form id), created_by null

person_topics (person_id, topic, subscribed bool, updated_at)
privacy_requests (id, person_id, kind ('access'|'correct'|'delete'), asked_at,
                  due_at, answered_at, answered_by, outcome_note)
```

Rules to enforce in code, not in a component:

- **Nothing may be sent to a person whose latest consent event for that topic is a
  negative one** — except transactional and urgent event mail (see §6).
- A contact with source `staff_entry` or `import` and no `confirmed` event is
  **not mailable**. 31c shows this as 285 people needing one confirmation email.
- `consent_events` is append-only. No update, no delete, no admin edit.
- A delete request removes everything marked deletable, replaces the name on finance and
  school records with "Removed at her request", and keeps the figures. Retention:
  invoices 5 years from the tax year, academic records indefinitely, message history
  3 years, evaluation notes while serving + 1 year.
- Every privacy request is logged with who answered it. Due 30 days from asking.

## 5. Sequences (31e)

```
sequences (id, name, enabled, entry_rule_json, exit_rules_json, reentry bool,
           quiet_hours_start, quiet_hours_end)
sequence_steps (id, sequence_id, sort_order, kind ('send'|'wait'|'if'|'stop'),
                config_json, branch_a_step_id null, branch_b_step_id null)
sequence_runs (id, sequence_id, person_id, current_step_id, state, entered_at,
               exited_at, exit_reason)
```

- **Exit rules are as important as entry.** Applying to a school must remove her from
  "come and see a school" that night, not at the next step.
- `reentry = false` by default; a person can never be in the same sequence twice.
- Quiet hours are per sequence, default 07:00–20:00 SAST.
- Steps carry their own stats read from `messages` — no separate counters.

## 6. Transactional and urgent (29g, 30d)

Two categories bypass topic mutes and unsubscribes:

- **transactional** — invoices, receipts, password resets, application decisions. She
  cannot opt out of the mechanics of her own account.
- **urgent event** — cancellation, venue change, safety. Reaches everyone registered
  including opt-outs.

Urgent sends require typing the word URGENT (30d), record `sent_by`, notify leadership,
and are counted — if it is used monthly it is not urgent. Bounced addresses still do not
receive it; the screen says so and tells you to phone them.

## 7. Replies (31a, 31b)

```
threads (id, person_id, subject, in_reply_to_message_id, assigned_to null,
         state ('unassigned'|'assigned'|'done'|'ignored'), last_message_at)
thread_messages (id, thread_id, direction ('in'|'out'), from_address, body,
                 sent_at, author_id null)
```

Inbound needs a real integration decision before build: an inbound-parse webhook
(SendGrid/Postmark) posting to `/api/mail/inbound`, matched to a person by from-address,
falling back to a new contact. Reply-to addresses should carry a token
(`reply+{thread}@ffsa.org`) so threading does not depend on subject matching.

- **`unassigned` is a visible state.** The filter "nobody has these" is the first chip.
- Robot mail (bank notifications, autoresponders) is detected and marked ignored, not
  deleted.
- Outbound replies write to `messages` too, so they appear on her log.
- Saved answers are per-team snippets, with one that inserts an application link.

## 8. Domains and identities (29f)

```
sending_domains (id, domain, spf_ok, dkim_ok, dmarc_ok, last_checked_at)
from_identities (id, name, address, reply_to, purpose, allowed_roles jsonb,
                 domain_id, uses_ffx_mark bool)
```

Show the exact DNS records to paste with copy buttons; check hourly. Block sending from a
domain whose DKIM is missing, with the reason on screen. **Only the FFX identity may use
the FFX mark.** Never a no-reply address.

## 9. Deliverability (29e, 30g)

A bounce raises work, not a statistic. Hard bounce → mark the address broken, stop
sending, create a task on her record. The queue (30g) handles one person at a time,
offers the obvious fix (`gamil.com` → `gmail.com`), and where money is involved the
primary action is *fix it and resend what she missed*. Phone-only is a valid state, and
those invoices go to a printed list.

## 10. Build order

1. `messages` + `reason`, and the person log (29d) as a view over it. Everything else
   depends on this table existing first.
2. `from_identities` + `sending_domains` (29f) — nothing can send correctly without them.
3. Consent: `consent_events`, `person_topics`, the mailability rule, and the 285-person
   confirmation send (31c). Do this before any campaign can go out.
4. Audiences (29b), then campaigns and the composer (29a) with the last-check screen.
5. Campaign report (29c) and deliverability (29e, 30g).
6. Event sends (29g) and urgent (30d).
7. Sequences (31e).
8. Replies (31a) — last, because inbound email is the only part needing new infrastructure.
9. `privacy_requests` (31d).

Not yet designed, in the order they will be wanted: the approval queue for wider sends,
Slack for staff, saved newsletter layouts, and a re-engagement path for people who never
open.
