# Finance (phone): My Finance + receipt capture

Phase 1, slice 2. Mirrors the website's `/my-finance` and outreach team pages.

| Route | Screen |
|---|---|
| `app/(app)/finance/index.tsx` | My Finance: your outreach teams |
| `app/(app)/finance/[teamId]/index.tsx` | Team: budget lines + expenses (leaders/staff), roster (members) |
| `app/(app)/finance/[teamId]/new.tsx` | Add expense (modal) |
| `app/(app)/finance/[teamId]/expense/[expenseId].tsx` | View / edit an expense and its receipts |
| `app/(app)/finance/receipt.tsx` | Full-screen receipt with zoom |

## Rules this code keeps

- **Reads** go straight to Supabase as the signed-in person (RLS decides; plain
  members get no money, exactly like the web). **Writes** only go through
  `/api/finance/outreach/expenses` and `/api/finance/outreach/receipts`, so the
  Slack cash alert and the server-side receipt steps still run.
- **Receipts** upload to the private `outreach-receipts` bucket the web's way
  (`${teamId}/${expenseId}/${Date.now()}_${name}`, user session, upsert), then
  get registered through the API.
- **Nothing is lost silently.** New expenses and every photo go into the outbox
  (`outbox/`, on disk in the documents folder) before anything is sent. It sends
  on save, when connectivity returns, when the app comes to the front and on a
  backoff timer. Only the person's "Remove" deletes an unsent item.
- **No double expenses.** The app picks the expense id; the API answers a
  retried POST with the first row. Receipt registration is keyed on the file
  path, which is fixed when the photo is queued.
- `can_edit_outreach_team()` and `GET /api/me` only decide what buttons show.
- All strings are in `strings.ts`.

## Follow-ups

Done in the P1 follow-ups PR:

- `<OutboxProvider>` lives in `app/(app)/_layout.tsx` (inside `MeProvider`),
  so the outbox sends from app start, before Finance is first opened. It still
  reads the signed-in user from the session on every run.
- The local `use-me.ts` is gone: screens use the shell's `useMe()` from
  `@/features/shell`; the finance-only wording gate `isFinanceStaff()` lives in
  `access.ts`.
