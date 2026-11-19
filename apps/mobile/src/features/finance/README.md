# Finance (phone): My Finance + receipt capture

Phase 1, slice 2. Mirrors the website's `/my-finance` and outreach team pages.

| Route | Screen |
|---|---|
| `app/(app)/finance/index.tsx` | My Finance: your outreach teams |
| `app/(app)/finance/[teamId]/index.tsx` | Team: budget lines + expenses (leaders/staff), roster (members) |
| `app/(app)/finance/[teamId]/new.tsx` | Add expense (full-height pushed form, tab bar hidden) |
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

## Look (redesign, mockup frames 3.1–3.10)

- Every screen draws its own header: `LargeTitleScrollView` (My finance, team,
  expense) or Cancel + title in the bar (Add expense). The stack has no native
  header.
- Screens are built from the kit (`@/components`): section titles, group and
  info rows, status lines, choice chips, select field, disclosure and the
  load states were first built here and promoted to the kit in R4. Only the
  budget bar stays in `components/parts.tsx`. The Add expense bar is the
  kit `NavBar` with Cancel in its leading slot; Cancel with anything filled
  in asks "Discard this expense?" first.
- Budget summaries are whole rands; single amounts keep their cents
  (`money.ts`, unchanged).
- At most one yellow band per screen: unsent items that failed (My finance),
  expenses missing a receipt (team). Neither has a button.
- "Finance office · Approvals" on My finance is a labelled placeholder: no
  link, no inbox. It shows for team members and for finance staff
  (`isFinanceStaff` in `access.ts`) even when they're on no team.
- Team: the expense rows (leaders) and the roster (members) are a
  virtualised list (kit `LargeTitleList` + `ListGroupItem`), so a team with
  hundreds of expenses scrolls smoothly; everything above the rows is the
  list header.

## Follow-ups

Done in the P1 follow-ups PR:

- `<OutboxProvider>` lives in `app/(app)/_layout.tsx` (inside `MeProvider`),
  so the outbox sends from app start, before Finance is first opened. It still
  reads the signed-in user from the session on every run.
- The local `use-me.ts` is gone: screens use the shell's `useMe()` from
  `@/features/shell`; the finance-only wording gate `isFinanceStaff()` lives in
  `access.ts`.
