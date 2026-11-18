# UI polish checklist

Ten passes, in the order [koppkev](https://github.com/koppkev) uses to unslop a vibecoded page. Passes 1–6 are checkable rules for every FFSA Hub surface. Passes 7–10 are allowed only on showcase surfaces.

This file is grounded in what the repo already uses: the tokens in `src/app/globals.css`, the Tailwind theme in `tailwind.config.ts`, the Roboto faces loaded in `src/app/layout.tsx`, and the primitives in `src/components/ffsa/index.tsx`. Do not invent a second scale.

## Where each pass is allowed

| Pass | Everywhere, including dense admin tables | Showcase only |
| --- | --- | --- |
| 1 Declutter | Yes | Yes |
| 2 Spacing on the scale | Yes | Yes |
| 3 Confident, specific copy | Yes | Yes |
| 4 Grid and alignment | Yes | Yes |
| 5 One typeface family | Yes | Yes |
| 6 The type scale | Yes | Yes |
| 7 Imagery that leads | No | Yes |
| 8 Rich menus | No | Yes |
| 9 Small hover details | No | Yes |
| 10 Calm load-in | No | Yes |

## Mobile overflow (hard rule)

Every UI pull request includes a **390px-wide screenshot** of each screen it changes.

At **360, 390, and 430** CSS pixels the page does not scroll horizontally. Measure the document, not a region that is supposed to scroll on its own:

```js
document.documentElement.scrollWidth <= window.innerWidth
```

A table or a week grid may scroll inside its own box. The page itself may not. Fix overflow in the screen you are editing. Do not paper over it with `overflow-x: hidden` on `body`.

Showcase surfaces are only:

- the org switcher (`src/components/missio/org-switcher.tsx`)
- the Missio landing (`/missio`, the home in `src/components/missio/home.tsx`)
- public pages (storefronts, forms, the login screen’s own brand)

Dense admin tables and widgets are not showcase surfaces. That includes the dashboard, `/missio/people`, every data table, and filter toolbars. On those, do not add photography, rich menus, hover motion, or a load-in reveal.

## Colour, frame, corners

The frame is the current one: black icon rail, bone module panel, white content. Colour comes from the variables on `:root` in `globals.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--ink` / `--text-primary` | `#0A0A0A` | Text, primary buttons, section bars, strong rules |
| `--surface-1` | `#FFFFFF` | Content |
| `--surface-2` / bone | `#F4F2EA` | Module panel, lead KPI, quiet fills |
| `--surface-3` | `#F1EFE7` | Secondary fill |
| `--surface-4` / `--rule` | `#E7E4D9` / `#DEDACE` | Hairlines |
| `--rule-strong` | `#C7C3B5` | Input borders, chips |
| `--yellow` | `#FFB801` | The single needs-you band, and the 3px masthead tick |
| `--green` / `--green-text` | `#3E7F2B` / `#2F6620` | Positive status |
| `--amber` | `#8A6400` | Attention status |
| `--text-secondary` | `#45423B` | Supporting sentences |
| `--text-tertiary` | `#7C786C` | Meta |
| `--text-quiet` | `#9A9689` | Placeholders |

Missio keeps its own skin variables (`--side`, `--page`, `--panel`, `--accent` `#B4532E`) from `missioSkinVars()`. Those recolour the same frame. They do not add a second type family or a second spacing scale.

- `--radius` is `0`. Every Tailwind radius token resolves to `0`. No pills, no circles, no `border-radius: 999px`.
- Shadows are off in the Tailwind theme. Separate regions with a 1px rule, not elevation. The one exception already in the system is the org-switcher menu and shadcn popovers, which may lift. Do not add a new shadow on a table or a dashboard card.
- At most one `.needs-you` band per screen. The masthead’s yellow tick (`.masthead-context::before`, 16×3) may sit with that band. A second yellow area is a failure.
- The FFX logo is only for FFX schools. Everywhere else use the FF wordmark or mark in `brand/`.

## 1. Declutter

A screen fails this pass if any of these are true:

- Two mastheads, or a second large heading under the masthead that repeats the title.
- Two needs-you bands, or a yellow band whose sentence is not backed by a count the page already loaded.
- A progress bar with no real ratio.
- The same fact twice (the org name in the crumb and again in a pill, a sidebar “not open” row and a card that says “Coming soon”).
- An icon that only restates the heading next to it.
- Filler blocks: empty cards, lorem, “click here”, “welcome to your dashboard”, a rainbow of icon colours that is not a legend.
- A card, badge, and sentence that all say the same status.

White space is the empty state. Do not draw a placeholder block where nothing is booked or nothing is listed.

## 2. Spacing

New padding, margin, and gap use this scale and nothing else. It is the 4px Tailwind scale the Hub already ships (`p-1` = 4px through `p-16` = 64px), restricted to the steps the design system actually uses:

**4, 8, 12, 16, 20, 24, 32, 40, 48, 64.**

`1px` is allowed only for a hairline border.

Do not introduce `2, 5, 6, 7, 9, 10, 11, 13, 15, 18, 22` px, or fractional rem such as `0.85rem`, `0.9rem`, `1.1rem`. Existing component classes already encode a few off-scale paddings (`.section-bar` is 11px, `.needs-you` is 13px). Use those classes. Do not copy the odd number into a new rule.

Named spacing, use these instead of inventing page padding:

| Surface | Spacing |
| --- | --- |
| Masthead | `px-5 pt-5 pb-4`, from `md`: `px-8 pt-6 pb-5` (`Masthead`) |
| Page body under a masthead | `px-5 py-6 md:px-8 md:py-8` |
| Section bar | the `.section-bar` class |
| Needs-you band | the `.needs-you` class |
| KPI cell | the `.kpi` class |
| Widget row | `px-6 py-3` (24 / 12) |
| Dashboard grid gap | `gap-5` (20px) |
| Missio content | `32px 32px 40px` |
| Missio card grid | `gap: 16px`, `margin-top: 24px` |

## 3. Copy

- Sentence case for sentences, empty states, names, and button labels that are words (“Add person”, “Try again”, “Mark all read”).
- Mastheads, section bars, mono labels, and chips are uppercase because their CSS says so (`.masthead-title`, `.section-bar-title`, `.mono-label`, `.chip`). Write the source string in sentence case anyway (“Upcoming events”, “Needs attention”). The class does the capitals.
- Specific. Name the set and, when you have it, the number. “2 staff members are waiting on approval.” “No published events from today on.” “Potch is the main church. Johannesburg meets as Missio JHB.”
- No filler. Banned on sight: “Coming soon”, “click here”, “simply”, “just”, “welcome to”, “oops”, “you’re all caught up”, “something went wrong” when you know what failed, exclamation marks, and a subtitle that repeats the title.
- Real numbers, tabular. `td`, `th`, and `.numeral` already set `font-variant-numeric: tabular-nums`. Don’t spell a count as “a few”.
- Voice is plain. “4 staff members are waiting on approval”, not a metaphor.

## 4. Grid and alignment

- Content lines up with the page padding. Every row inside one widget uses the same horizontal padding, `px-6`.
- Text columns are left-aligned. Counts and dates use tabular figures and sit on a consistent edge.
- A card grid has no leftover hole. Three items are one row of three, or a single column. Don’t leave a 3-column grid with two cards on the next row unless a fourth item exists.
- Admin regions are separated with `border-ink`, `border-rule`, or `border-rule-strong`. Not a shadow, not a tinted card floating on white.
- The dashboard grid is `lg:grid-cols-2`. A full-width widget spans both columns. Don’t nest a second grid with a different column width in the same band.
- Square corners. If a CSS module sets `border-radius` above 0, that is a failure, including on the Missio shell.

## 5. One typeface family

Loaded in `src/app/layout.tsx` and exposed as:

| Role | Variable | Family | Where |
| --- | --- | --- | --- |
| Body | `--font-roboto` | Roboto | Sentences, names, table cells, form values |
| Display | `--font-condensed` / `--font-roboto-condensed` | Roboto Condensed | Mastheads, section titles, numerals. Weight 900 for a masthead or numeral, 700 for a dense heading |
| Mono | `--font-mono-brand` / `--font-roboto-mono` | Roboto Mono | Only the list below |

Mono is allowed only for:

- `.masthead-context`
- `.mono-label` and `.section-bar-meta`
- `.chip` and admin button labels (the global button rule is already mono, 10px, uppercase)
- `.needs-you-tag`
- tooltips (`[data-slot="tooltip-content"]`)
- a short metadata column (a date, a count label), not the name beside it

Mono is not allowed for names, sentences, empty states, form fields, or Missio prose. Inputs are Roboto at 14.5px (the global input rule).

Do not add Archivo, Fraunces, Inter, or a new `next/font` family on Hub admin or Missio. Bebas Neue, Anton, and Space Mono stay loaded for unmigrated public event storefronts only. Missio sets `--font-missio-body` and `--font-missio-display` to Roboto and Roboto Condensed so the portaled dialog uses the same family.

## 6. Type scale

Use a step from this table. Don’t pick a size between them.

| Role | Size | Weight | Line-height | Tracking | Face |
| --- | --- | --- | --- | --- | --- |
| Masthead | `clamp(34px, 7.5vw, 58px)` | 900 | 0.9 | -0.01em | Condensed, uppercase |
| Showcase display, sentence case | 40px or 48px | 700 | 0.95 | -0.01em | Condensed |
| Dialog title | 28px | 900 | 0.95 | 0 | Condensed, uppercase |
| Section and card title | 16px | 900 | 0.95 | 0.05em | Condensed, uppercase |
| KPI numeral | `clamp(22px, 7vw, 54px)` | 900 | 0.85 | -0.01em | Condensed, tabular |
| In-widget numeral | 32px | 900 | 0.85 | -0.01em | Condensed, tabular |
| Body | 14px | 400 | 1.6 | 0 | Roboto |
| Secondary | 13px | 400 | 1.5 | 0 | Roboto |
| Needs-you sentence | 14px | 600 | 1.4 | 0 | Roboto |
| Input | 14.5px | 400 | — | 0 | Roboto |
| Mono label, section meta | 9px or 10px | 700 | 1 | 0.16–0.2em | Mono, uppercase |
| Chip and admin button | 9.5px or 10px | 700 | 1 | 0.1–0.14em | Mono, uppercase |

Not on the scale, so don’t add them: 11, 11.5, 12.5, 18, 19, 22 (except the KPI clamp floor), 38. `13.5px` exists only as the dialog-description token in `globals.css`. Don’t copy it into a new component.

Headings in the admin frame are uppercase because `globals.css` sets `h1–h6` and `.masthead-title` that way. Showcase display type may stay sentence case, still in Roboto Condensed, at 40px or 48px.

## 7–10. Showcase only

Do not apply these to a dashboard widget, a people table, or any other dense admin surface.

**7. Imagery that leads.** Use an existing image slot or a real brand file (`brand/ff-mark-*.png`, `brand/ff-wordmark-*.png`). Do not invent a photograph, and do not reuse an FFX collage as texture. The Missio landing has no photo slot; its lead is the condensed greeting, not a fake image.

**8. Rich menus.** The org switcher may show the organisation name, one short blurb, and a selected mark. A table filter stays one control. Don’t add a second menu, a command palette, or descriptions under every nav item.

**9. Small hover.** On a showcase card or the org switcher, a 120–150ms border-colour or background change is enough. No lift, no glow, no `transform` on hover. A table may keep a flat row background change. Don’t add one.

**10. Calm load-in.** One `animate-fade-up` (already in `globals.css`: 0.25s, 8px) on the showcase page root. Not on each card, not on a table, not on the dashboard.

## Before you open the PR

- [ ] Every new padding, margin, and gap is on the spacing scale, or is one of the named classes.
- [ ] Every new font size is a row in the type scale.
- [ ] The face is Roboto, Roboto Condensed, or Roboto Mono, and mono is only where section 5 allows it.
- [ ] Copy is sentence case, specific, and free of the filler list. Numbers are real.
- [ ] The screen has one masthead and at most one needs-you band.
- [ ] Corners are square. Regions are rules, not shadows.
- [ ] Passes 7–10 appear only on the org switcher, the Missio landing, or a public page.
- [ ] A 390px screenshot is in the PR, and the page does not overflow horizontally at 360, 390, or 430px.
