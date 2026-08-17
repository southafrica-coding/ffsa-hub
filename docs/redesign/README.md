# FFSA Hub — redesign handoff

Everything here is written against the real repo (`ffsa-platform`, Next 15 app router,
Tailwind + shadcn, Supabase). File paths are exact. Work top to bottom.

Design reference: `FFSA Hub Redesign.dc.html` — frame ids (2a, 3a, 8a…) are cited per screen.
Standing rules: `CLAUDE.md`.

| File | What it is | Where it goes |
|---|---|---|
| `01-globals.css` | Complete replacement token + override layer | `src/app/globals.css` |
| `02-tailwind.config.ts` | Replacement config | `tailwind.config.ts` |
| `03-admin-shell.tsx` | Rail + module panel | `src/components/admin-sidebar.tsx` |
| `04-ffsa-primitives.tsx` | Masthead, NeedsYou, StatusPill, Kpi… | `src/components/ffsa/index.tsx` (new) |
| `05-prayer-room-schema.md` | Tables, permission model, rules | migrations |
| `06-screen-recipes.md` | Per-screen composition | reference while building |
| `07-finance-billing.md` | Student billing: charges, Xero, refunds, approvals | schema + finance module |
| `08-training-and-messages.md` | School detail, grades, applicants, form builder, email moments | training module |
| `09-going-live.md` | Adopting billing with schools already running | read before any finance work |

---

## Step 1 — branch and baseline

```bash
git checkout -b redesign/editorial-light
```

Screenshot the current dashboard, events, finance and login. You will want the before/after,
and it is how you catch anything that quietly breaks.

## Step 2 — fonts

`src/app/layout.tsx`. Add Roboto Condensed and Roboto Mono next to the existing Roboto.
**Remove Bebas Neue** — it is not in the brand.

```ts
import { Roboto, Roboto_Condensed, Roboto_Mono } from "next/font/google";

const roboto = Roboto({
  subsets: ["latin"], weight: ["300","400","500","700","900"], variable: "--font-roboto",
});
const robotoCondensed = Roboto_Condensed({
  subsets: ["latin"], weight: ["400","700","900"], variable: "--font-roboto-condensed",
});
const robotoMono = Roboto_Mono({
  subsets: ["latin"], weight: ["400","500","700"], variable: "--font-roboto-mono",
});

// <html className={\`${roboto.variable} ${robotoCondensed.variable} ${robotoMono.variable}\`}>
```

**Check:** headings render in a narrow heavy face, not Bebas.

## Step 3 — tokens

Replace `src/app/globals.css` with `01-globals.css`, and `tailwind.config.ts` with
`02-tailwind.config.ts`. Restart the dev server (Tailwind config changes need it).

The CSS variable *names* are unchanged from the dark theme — only values. Anything already
using `var(--surface-2)` or `text-muted-foreground` flips automatically.

**Check:** the whole app is light, square-cornered and shadowless. It will look
half-finished — that is correct at this stage. Do not start fixing individual screens.

**Watch for:** hard-coded dark hexes in page files (`#0D0B09`, `hsl(20 12% 5%)`,
`hsl(42 95% 55%)`). Grep and remove them as you reach each screen:

```bash
grep -rn "0D0B09\|hsl(42 95%\|hsl(2[02] " src/app src/components
```

## Step 4 — the shell

Replace `src/components/admin-sidebar.tsx` with `03-admin-shell.tsx`.

It keeps the same export name, props and `getAccessibleModules` calls, so
`src/app/(admin)/layout.tsx` does not change. The rail switches area
(Operations / Mine / System); the bone panel lists that area's modules.

One thing to wire: the rail avatar is hard-coded to `JV`. Pass the signed-in user's
initials down from the layout, which already loads the user.

**Check:** 74px black rail, 212px bone panel, active module is a solid black row.

## Step 5 — primitives

Create `src/components/ffsa/index.tsx` from `04-ffsa-primitives.tsx`.

Do this before touching any screen. It is the step that gets skipped and then every page
invents its own pill.

## Step 6 — screens, in this order

Dashboard → Events → Training → Bookings → Finance → Communications → Login → public pages.

Per screen: delete the local styling, compose from primitives, follow `06-screen-recipes.md`.

**Per-screen acceptance:**
- one Masthead, and at most one NeedsYou
- no `rounded-*`, no `shadow-*`, no Bebas
- numerals are `.numeral` (condensed 900, tabular)
- list views are real tables, not card grids
- yellow appears once, or not at all

## Step 7 — prayer room

Schema first — `05-prayer-room-schema.md`. Then the wall, then seats, then evaluators.
Treat it as its own project; it is not part of the restyle.

## Step 8 — training in depth

`08-training-and-messages.md`. School detail and roster first, then grades, then the
applicant review screen. The form builder and Messages are a second pass — Messages
needs its own tables (`school_message_moments`, `message_sends`) and is the thing every
later feature sends through, so do not treat it as decoration.

## Step 9 — billing

**Read `09-going-live.md` before writing any code.** Ship `billing_mode` defaulting to
`external` for every existing program, so the two schools currently running are
untouched. Then `07-finance-billing.md`, in its own build order (section 12).

The non-negotiables: charges carry their own due anchor and generation rule (no
hardcoded dates anywhere), the generation guard runs before any automation, and create
is a separate step from send.

---

## Working with Claude Code — one session per step

Do not paste the whole handoff. One step per session, and start each with:

> Read `CLAUDE.md` and `handoff/README.md`. We are doing **Step N** only. Do not touch
> anything outside the files that step names. When you are done, list what you changed
> and what you did not.

Then the step's own prompt:

**Step 8** — "Read `handoff/08-training-and-messages.md` sections 1–3. Rebuild the
school detail page: masthead, phase run, roster table. Frames 14a and 14b in
`FFSA Hub Redesign.dc.html`. Use the primitives in `src/components/ffsa`. Do not invent
new pills or cards."

**Step 8b** — "Sections 4–5 of the same file. Build the application form builder, then
the Messages tables and list. Migrations first, then the UI. Messages must support
revert-to-default via the `source` column."

**Step 9a** — "Read `handoff/09-going-live.md`. Add `billing_mode` and
`schedule_start_date` to programs, default every existing program to `external`, and
make every finance screen filter on it. Nothing else."

**Step 9b** — "Read `handoff/07-finance-billing.md` sections 1–4. Implement charge items
with all four due anchors and all four generation rules, plus the generation guard and
the `needs_decision` queue. No invoice may ever be created with a past date. Tests for
a student accepted four months late and one accepted eleven days before start."

**Step 9c** — "Sections 9–10. Xero: dry run, create-as-awaiting-approval, send as a
separate step. Then webhooks in, with the three-tier matching policy and the
reconciliation inbox. Held money must stay visible."

**Step 9d** — "Sections 5–8. Payment preference and prepay, the four transitions, the
approval matrix, then adjustments and refunds on top of it. Nobody approves their own."

**Step 9e** — "Section 11. The student fees tab inside Training (frame 27a) and the
portal fee view (24a). Read-mostly; only a school leader's actions."

After each session, ask for the diff summary and check it against the frame in the
design file before moving on.

---

## Things that are easy to get wrong

1. **Primary buttons are BLACK, not yellow.** Yellow is reserved for the single
   needs-you band. If yellow starts appearing on buttons the system collapses.
2. **Two yellow bands on one page** stops either working. One per screen, always.
3. **Unbooked prayer time renders as nothing.** White is the "nobody has this" signal.
   Do not draw an empty-slot card.
4. **The FFX logo is only for FFX schools.** Everywhere else, the FF wordmark or mark.
5. **Don't reintroduce the paper-grain overlay** (`body::before`) or `.card-hover`
   / `.glow-yellow` — deliberately removed.
6. **Prayer lead ≠ worship lead.** Separate qualifications, separate sign-offs.
7. **`private_note` must never reach the subject** — enforce in RLS, not the component.
8. **A scheduled charge is not an invoice.** Scheduled can be rebuilt; issued can only
   be credited. If one function does both, the model is already broken.
9. **No hardcoded dates in billing.** Every charge chooses its own due anchor and its
   own generation rule. The FFX 2027 template is a seed, not a spec.
10. **Never generate an invoice with a past date.** Late acceptances go to a decision
    queue, never to a backdated batch.
11. **Creating an invoice and sending it are two decisions.** Keep the buttons apart.
12. **Email is the only guaranteed channel.** Amount, reference and full bank details go
    in the email body — never behind a login.
