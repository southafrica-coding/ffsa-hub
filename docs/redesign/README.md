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
