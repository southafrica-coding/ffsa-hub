# Communications — reconciliation

What `11-communications.md` proposes, against what the Hub already runs.
Verified in code and migrations on `main` @ `ac22ba9`, 2026-08-25.

Doc 11 reads as a greenfield design. It is not one. Roughly half of what it
describes already exists, some of it mature and live in production, and its
build order — "`messages` first, everything depends on it" — would create a
fourth message ledger beside three that already work.

**The single most valuable thing in doc 11 is not the `messages` table. It is
the `reason` column.** Nothing in the Hub records why a person received an
email. That is worth building whatever else is decided.

---

## The mapping

| Doc 11 proposes | Already exists as | Verdict |
|---|---|---|
| `messages` | **three** ledgers: `email_messages` (141), `campaign_recipients` (045), `workflow_email_sends` (071) | **Extend `email_messages`; fold the other two in.** Do not create `messages`. |
| `reason` | nothing | **Build.** The one genuinely missing idea. |
| `campaigns` | `campaigns` (045) | Keep. Needs `audience_id`. `preheader` already exists as `preview_text`. |
| `campaign_blocks` | `campaigns.body_source` jsonb — `CampaignBody { blocks: [...] }` — plus `email_templates` (133) | **Already solved.** Do not normalise into a table. |
| `audiences`, `audience_members` | `contact_lists` + `contact_list_members` (118) — static only. Campaigns target one `label_id`. | Static half exists. **Rule audiences are new.** |
| `consent_events` | `consent_records` (034) records agreement-version acceptance only; `email_suppressions` (046) holds unsubscribes keyed by email | **Build.** The two existing pieces cover slices, neither is an event log. |
| `person_topics` | `notification_preferences` (069) is Slack digest settings for *users* | **Build.** Not related despite the name. |
| `privacy_requests` | nothing | **Build.** |
| `sequences`, `sequence_steps`, `sequence_runs` | `outcome_workflows` + `workflow_steps` + `workflow_enrollments` + `workflow_step_runs` — live, with a step runner | **Already exists.** Add exit rules, `reentry`, quiet hours. Do not rebuild. |
| `threads`, `thread_messages` | nothing | **Build — but needs a provider decision first.** |
| `sending_domains` | nothing | **Build.** No SPF/DKIM/DMARC tracking today. |
| `from_identities` | `sending_identities` (042) + `sending_identity_brands` | Exists. Add `purpose`, `allowed_roles`, `uses_ffx_mark`, `domain_id`. |

---

## The three ledgers

This is the real problem doc 11 is reaching for, and it is worse than the doc
assumes — it is not that there is no ledger, it is that there are three that
almost agree.

`campaign_recipients` and `workflow_email_sends` are near-identical:

```
provider_message_id · sent_at · delivered_at · opened_at
first_clicked_at · bounced_at · bounce_reason · complained_at · unsubscribed_at
```

`email_messages` (141) carries the same delivery story in different words —
`status` as a state machine rather than timestamps, plus `bounce_type`,
`error`, `category`, `source_type`/`source_id`, `contact_id`, `event_id`,
`order_id`. It is the only one wired to the Resend webhook.

So a person's mail history today requires a three-way union, and two of the
three have no webhook keeping them current.

**`email_messages` is already about 80% of doc 11's `messages`.** The overlap:

| doc 11 | `email_messages` |
|---|---|
| `person_id` | `contact_id` |
| `source_kind` | `category` |
| `source_id` | `source_type` + `source_id` |
| `state` | `status` |
| `bounce_kind` / `bounce_detail` | `bounce_type` / `error` |
| `subject`, `sent_at`, `opened_at` | same |

Genuinely absent: `channel`, `reason`, `body_rendered`, `from_identity_id`,
`opened_count` / `clicked_count` (only first-touch timestamps today),
`replied_at`.

**Recommendation.** Add those columns to `email_messages`, backfill
`campaign_recipients` and `workflow_email_sends` into it, and leave the two
old tables in place as read-only until the views that depend on them are
moved — `v_campaign_stats` (174) reads `campaign_recipients` directly and the
campaign report is built on it. Renaming to `messages` is optional and costs a
sweep of every reference; the name is not what doc 11 is actually asking for.

---

## Where doc 11 is right and should be followed closely

- **`reason`, written at send time, in plain words.** Not an enum. "She is in
  DTS 26-2 students" survives a schema change; `AUDIENCE_RULE_47` does not.
- **Excluded counts, by reason, always shown.** Grepping the whole codebase
  for excluded/skipped/suppressed counts surfaced in the UI returns nothing —
  no send path tells the sender who was dropped. This is not hypothetical
  here: `campaign-send.ts:61` documents a past incident where pagination
  drift "once skipped ~1,452 recipients of a 7,000-person send". Doc 11's
  "2 418 becomes 2 371 with nobody noticing" has already happened at this
  organisation, at four times the scale.
- **Consent as an append-only event log.** `consent_records` is close in
  spirit but is scoped to agreement versions from applications and onboarding.
  It cannot answer "may I mail her about giving".
- **Exit rules matter as much as entry.** The live workflow engine has entry
  and steps; nothing removes a person mid-sequence when the reason for the
  sequence stops being true.

## Where doc 11 should be resisted

- **Do not build `sequences`.** `outcome_workflows` is the same idea, live,
  with enrollments and step runs. Doc 11's version is not better — it is the
  same design with three fields the existing one lacks.
- **Do not normalise `campaign_blocks`.** `body_source` jsonb already holds
  the block list and the composer already round-trips it.
- **Do not treat `notification_preferences` as `person_topics`.** Same idea in
  the abstract, different subject (users vs contacts) and different purpose
  (Slack digests vs mail topics). Build the new one; leave that alone.
- **Threads/replies need a decision, not a schema.** Doc 11 says so itself.
  Inbound parse means choosing a provider and a reply-to token scheme. That is
  a procurement question ahead of a build question, and it is the one part of
  doc 11 with an external dependency.

---

## Revised build order

Doc 11's order assumes nothing exists. This one starts from what does.

1. **`reason` + the ledger consolidation.** Extend `email_messages`, backfill
   the other two, move `v_campaign_stats` onto it. Person log (29d) becomes a
   view over one table.
2. **Consent** — `consent_events`, `person_topics`, and the mailability rule
   enforced in the send path rather than in a component. Doc 11 is right that
   this precedes any campaign work; it is also the POPIA exposure.
3. **Identities and domains** — extend `sending_identities`, add
   `sending_domains` with the DNS checks.
4. **Audiences** — rule audiences beside the existing static `contact_lists`,
   with excluded counts surfaced.
5. **Campaign report and deliverability** on the consolidated ledger.
6. **Workflow additions** — exit rules, `reentry`, quiet hours on the existing
   engine. Not a rebuild.
7. **Replies** — only after the inbound provider decision.

Urgent/transactional bypass (§6) is a rule in the send path, not a phase; it
lands with step 2.

---

## Open questions for Jack

1. **Rename or extend?** Extending `email_messages` is materially less risky
   than a `messages` table. The cost is that the name in the code stops
   matching the name in the design doc. Recommendation: extend, and note it in
   doc 11.
2. **What is a "person"?** Doc 11 says `person_id` throughout. The Hub has
   `contacts` *and* `users`, and the ledgers key on `contact_id`. Unifying
   them is a much larger change than this module. Recommendation: stay on
   `contact_id` and treat "person" as prose.
3. **Inbound provider** for replies. The Hub sends via Resend and Mailtrap;
   neither is wired for inbound parse here, and doc 11 names SendGrid or
   Postmark. Someone should confirm what the current providers offer before
   this is scoped — I have not verified their inbound support. Blocks
   31a/31b only.
4. **The approval queue** for sends wider than a leader's own scope is called
   "not yet designed" in doc 11 §3. Confirm it stays out of scope.

---

Next migration when this starts: **185**. Note `181` is already duplicated on
`main`, so check `ls supabase/migrations | tail` before taking a number.
