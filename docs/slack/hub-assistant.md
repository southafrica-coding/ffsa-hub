# "Hub" — the private Slack assistant for ministry leaders

A separate Slack app, named **Hub**, that ministry leaders DM about their team's Hub access.
It sits alongside the two existing apps ("FFSA Hub Activity" and "Outreach Finance") and
does not share their keys.

**Status: built, switched off.** Nothing happens until the steps at the bottom are done.

- Code: `src/lib/slack/assistant/hub-leader/`, routes `src/app/api/slack/assistant/{events,interactions}/route.ts`
- Slack app manifest: `docs/slack/hub-assistant-manifest.json`
- Migration: `supabase/migrations/392_hub_slack_assistant.sql` (rollback in `supabase/rollbacks/`)

## What it can do

In a direct message, a ministry leader can ask it to:

1. **List their team's Hub access**: everyone in the ministries they lead, with roles and permissions.
2. **Look up one person's access**: by name or email, only among people in the ministries they lead.
3. **Give or remove a Hub permission** for someone in a ministry they lead.
4. **Resend the Hub invite** to someone in a ministry they lead who hasn't set up their account.
5. **Report a problem** to the Hub team (saved as a ticket in the Hub).

Grant, remove and resend never happen straight away. The bot posts the change with
**Confirm** and **Cancel** buttons, and nothing is written until the leader presses Confirm
(within 10 minutes). Problem reports are filed straight away.

## What it can't do

- Anything else. It has no general data access and never writes SQL; asked for something
  else, it says so and offers to file a problem report.
- Change roles (job titles, admin tiers). Only individual permission keys.
- Change the leader's own access, or an admin's.
- Reply in channels. It is **DM-only**: @mentions and channel messages are ignored
  silently. Don't add it to public channels.

## Who can use it

Only **ministry leaders**: a Hub user with an active `leader` membership in a staff ministry
(`staff_ministry_members.member_role = 'leader'` and `status = 'active'`). Point-leader
subcategories and the `users.department` label don't count.

- Slack account not linked to a Hub account: *"Your Slack isn't linked to a Hub account yet.
  Link it on your Hub profile, or ask a Hub admin."*
- Linked, but not a ministry leader: *"Sorry, this assistant is only available to ministry leaders."*

## Safety model

Every check runs on the server, on every tool call, and **again when Confirm is pressed**.
Nothing the model says or a button carries is trusted.

| Rule | How |
|---|---|
| Who is asking | Slack signature checked with the Hub app's own signing secret; Slack user → Hub user via `users.slack_user_id` |
| Leader | `getLedMinistryIds` (active `leader` memberships) is not empty |
| Team | Active members of the ministries they lead. Anyone else gets the same "couldn't match that name there" as a name that doesn't exist, so the bot never confirms someone is in the Hub |
| Permission changes | Only permission keys (never roles). The leader must hold the key themselves (`getEffectivePermissionKeys`), and with the same reach: an everywhere grant needs the leader to hold it everywhere; a scoped grant needs the leader to hold that exact scope |
| Blocked keys | Never from Slack, even if held: `records_library.manage` (super-admin only), anything in `administration.*` (e.g. `administration.manage_roles`), `legal.access`, `imports.run`, `contacts.export`, `okrs.manage_all`, `finance.approve`, `unsubscribes.manage`. Legacy duplicate keys are hidden |
| Targets | Not the leader themselves; not an admin; remove only takes away direct grants (role permissions go through an admin) |
| Invite resend | Target has an email and **no password** (`userHasPassword`); sent through `sendSetupLink` with the invite template, like `/api/admin/resend-user-invite` |
| Confirm buttons | Carry only the pending action id. Only the Slack user who asked can confirm or cancel. The row is closed with a conditional update before the write, so a double click or replay does nothing. Expired or cancelled rows do nothing |
| Audit | Every executed change and problem report → `audit_logs` (`user_id` = the leader, `changes.source = 'slack_hub_assistant'`). Every proposal, execution, refusal, failure and cancel → `slack_assistant_audit_log`. Questions are logged to `slack_bot_queries` like the other bots |
| Off by default | `HUB_SLACK_ASSISTANT_ENABLED` must be `1`/`true` **and** `VERCEL_ENV=production` **and** not `PREVIEW_WRITES_DISABLED`, **and** the app's token and signing secret set. Otherwise every event is acknowledged and nothing else happens (no reply, no database write). Slack's `url_verification` handshake is always answered so the app can be set up first |
| Model | Anthropic SDK, `claude-haiku-4-5-20251001` (same pin as the other Slack assistant), six turns max. If the key is missing a leader gets "not available right now"; setting names are never shown in Slack |

A Hub admin who also leads a ministry can use it, but only for keys they hold directly or
through a role (the `admin` role carries no permission rows), so admins should keep using the
Users page for anything wider.

Each DM is answered with the last few messages of that DM as context (so "the second one"
works); authorization never depends on that context.

## Switch-on steps (Jack)

Do these in order. **Previews share the production database, so the flag stays off on Preview.**

1. **Create the Slack app.** <https://api.slack.com/apps> → *Create New App* → *From an app manifest* →
   pick the **FFSA** workspace → paste `docs/slack/hub-assistant-manifest.json`. Slack will check the
   events URL; the route answers that handshake even before the secret is set.
   - Don't distribute it and don't enable org-wide deploy (the manifest already has
     `org_deploy_enabled: false`).
2. **Install it to the FFSA workspace only** (*Install App*). If the workspace needs admin
   approval for new apps, approve it as a Slack admin. Don't invite it to any public channel.
3. **Copy two values** (don't paste them anywhere but Vercel):
   - *OAuth & Permissions* → Bot User OAuth Token (`xoxb-…`)
   - *Basic Information* → Signing Secret
4. **Vercel → Project → Settings → Environment Variables, Production only** (untick Preview and Development):
   - `SLACK_ASSISTANT_BOT_TOKEN` = the bot token
   - `SLACK_ASSISTANT_SIGNING_SECRET` = the signing secret
   - optional `SLACK_ASSISTANT_TICKET_CHANNEL_ID` = a **private** channel id (`C…`) for problem-report
     notes; invite the Hub app to that channel. Leave it unset and reports are only saved in the Hub.
   - `ANTHROPIC_API_KEY` is already set for the other assistant; check it's present in Production.
   - Don't set `HUB_SLACK_ASSISTANT_ENABLED` yet.
5. **Merge and deploy** the PR as normal.
6. **Apply migration 392** in the Supabase Dashboard → SQL Editor: paste
   `supabase/migrations/392_hub_slack_assistant.sql` and run it. Check the validation queries at the bottom
   return 0. Then regenerate types if you want them (`supabase gen types …`); the code doesn't need them.
7. **Turn it on:** add `HUB_SLACK_ASSISTANT_ENABLED=1` in Vercel, **Production only**, then redeploy
   Production so the function picks it up.
8. **Try it:** as a ministry leader whose Slack is linked on their Hub profile, open the Hub app's
   *Messages* tab in Slack and ask "who's on my team?". Then ask someone who isn't a leader to DM it;
   they should get the polite refusal.

To switch it off, remove `HUB_SLACK_ASSISTANT_ENABLED` (or set it empty) and redeploy. The tables can stay.
Rollback for the schema: `supabase/rollbacks/392_hub_slack_assistant.sql`.
