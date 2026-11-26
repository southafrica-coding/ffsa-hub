# UI polish checklist

Based on @koppkev's 10-pass "Unslopping" UI polish video. Passes 1–6 are checkable rules for any Hub surface, FFSA or Missio. Passes 7–10 are allowed only on showcase surfaces.

This file is grounded in what the repo already uses. The FFSA skin is the tokens in `src/app/globals.css`, the Tailwind theme in `tailwind.config.ts`, the Roboto faces loaded in `src/app/layout.tsx`, and the primitives in `src/components/ffsa/index.tsx`. The Missio skin is Archivo and Fraunces from `src/components/missio/fonts.ts`, with its own spacing, radii, and pills in `src/components/missio/shell.module.css`. Do not invent a third scale, and do not mix the two skins on purpose.

A pull request that does not change UI is not blocked by this checklist. Reviewers **block** a UI pull request that overflows or feels cramped at 360, 390, or 430px, or that ships without a 390px screenshot of each screen it changes.

## Where each pass is allowed

| Pass | Everywhere, including dense admin tables | Showcase only |
| --- | --- | --- |
| 1 Declutter | Yes | Yes |
| 2 Spacing on the scale | Yes | Yes |
| 3 Confident, specific copy | Yes | Yes |
| 4 Grid and alignment | Yes | Yes |
| 5 One type system per skin | Yes | Yes |
| 6 The type scale | Yes | Yes |
| 7 Imagery that leads | No | Yes |
| 8 Rich menus | No | Yes |
| 9 Small hover details | No | Yes |
| 10 Calm load-in | No | Yes |

## Mobile overflow (hard rule)

Every UI pull request includes a **390px-wide screenshot** of each screen it changes.

At **360, 390, and 430** CSS pixels the screen does not scroll horizontally and the content is not cramped against the edges. The FFSA admin and portal scroll inside `[data-shell-main]` (`src/app/(admin)/layout.tsx` and `src/app/(portal)/layout.tsx`), so the document element can look fine while that pane overflows. Measure both. Overflow exists when `scrollWidth > clientWidth` on the shell pane, or when the document is wider than the viewport.

```js
const shell = document.querySelector("[data-shell-main]");
const shellOverflow = !!shell && shell.scrollWidth > shell.clientWidth;
const pageOverflow = document.documentElement.scrollWidth > window.innerWidth;
const overflows = shellOverflow || pageOverflow;
```

A table or a week grid may scroll inside its own box. The shell pane and the page may not. Fix overflow in the screen you are editing. Do not paper over it with `overflow-x: hidden` on `body` or on `[data-shell-main]`.

Missio has no `[data-shell-main]` and no `<main>`. Measure `document.documentElement` and the content column `[data-missio-content]` (`src/components/missio/shell.tsx`).

```js
const doc = document.documentElement;
const content = document.querySelector("[data-missio-content]");
const pageOverflow = doc.scrollWidth > doc.clientWidth;
const contentOverflow = !!content && content.scrollWidth > content.clientWidth;
const overflows = pageOverflow || contentOverflow;
```

Text cut off with an ellipsis, or overflow that is deliberately hidden, is fine. The content column or the page showing up as wider than its box is a failure. A region that is supposed to scroll, such as a wide table inside its own box, is not.

Showcase surfaces are only:

- the org switcher (`src/components/missio/org-switcher.tsx`)
- the Missio landing (`/missio`, the home in `src/components/missio/home.tsx`)
- public pages (storefronts, forms, the login screen’s own brand)

Dense admin tables and widgets are not showcase surfaces. That includes the dashboard, `/missio/people`, every data table, and filter toolbars. On those, do not add photography, rich menus, hover motion, or a load-in reveal.

## Colour, frame, corners

The org switcher re-skins the Hub per organisation. Each skin has one type system, and a screen should stay inside it. Do not put Archivo on an FFSA screen. Missio’s type system is Archivo and Fraunces. Global FFSA button and label rules currently leak in, for example the org pill, Add person, the Campus label, Status, Search, Edit, and the drawer M mark. That leak is known. Do not add more. Fix it with a scoped CSS-module override, not a change to the global rules in `globals.css`.

**FFSA** is the black icon rail, bone module panel, and white content. Colour comes from the variables on `:root` in `globals.css`.

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

- FFSA `--radius` is `0`. Every Tailwind radius token resolves to `0`. No pills, no circles, no `border-radius: 999px` on an FFSA screen.
- Shadows are off in the Tailwind theme. Separate FFSA regions with a 1px rule, not elevation. The org-switcher menu and shadcn popovers may lift. Do not add a new shadow on a table or a dashboard card.
- At most one `.needs-you` band per screen. The masthead’s yellow tick (`.masthead-context::before`, 16×3) may sit with that band. A second yellow area is a failure.
- The FFX logo is only for FFX schools. Everywhere else use the FF wordmark or mark in `brand/`.

**Missio** keeps the skin in `missioSkinVars()` and `shell.module.css`: Archivo for text, Fraunces for titles, its own padding, corner radii, pills, and 6px gaps. Stay inside that system. Do not restyle a Missio screen onto the FFSA radius-0 / Roboto rules, and do not import a third family.

## 1. Declutter

A screen fails this pass if any of these are true:

- Two mastheads, or a second large heading under the masthead that repeats the title.
- Two needs-you bands, or a yellow band whose sentence is not backed by a count the page already loaded.
- A progress bar with no real ratio.
- The same fact twice (the org name in the crumb and again in a pill, a nav row and a card that repeat the same “coming next” message).
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

FFSA new work uses the scale above. Missio uses the spacing, radii, and 6px gaps already in `shell.module.css`. Do not “correct” a Missio screen onto the FFSA 4px scale, and do not bring a 6px Missio gap into an FFSA screen.

## 3. Copy

- Sentence case for sentences, empty states, names, and button labels that are words (“Add person”, “Try again”, “Mark all read”).
- Mastheads, section bars, mono labels, and chips are uppercase because their CSS says so (`.masthead-title`, `.section-bar-title`, `.mono-label`, `.chip`). Write the source string in sentence case anyway (“Upcoming events”, “Needs attention”). The class does the capitals.
- Specific. Name the set and, when you have it, the number. “2 staff members are waiting on approval.” “No published events from today on.” “Potch is the main church. Johannesburg meets as Missio JHB.”
- No filler. Banned on sight: “click here”, “simply”, “just”, “welcome to”, “oops”, “you’re all caught up”, “something went wrong” when you know what failed, exclamation marks, and a subtitle that repeats the title.
- A **SOON** tag in the nav is allowed, sparingly, to mark a section that is coming next. A placeholder card or a placeholder page whose content is “Coming soon” is not allowed.
- Real numbers, tabular. `td`, `th`, and `.numeral` already set `font-variant-numeric: tabular-nums`. Don’t spell a count as “a few”.
- Voice is plain. “4 staff members are waiting on approval”, not a metaphor.

## 4. Grid and alignment

- Content lines up with the page padding. Every row inside one widget uses the same horizontal padding, `px-6`.
- Text columns are left-aligned. Counts and dates use tabular figures and sit on a consistent edge.
- A card grid has no leftover hole. Three items are one row of three, or a single column. Don’t leave a 3-column grid with two cards on the next row unless a fourth item exists.
- Admin regions are separated with `border-ink`, `border-rule`, or `border-rule-strong`. Not a shadow, not a tinted card floating on white.
- The dashboard grid is `lg:grid-cols-2`. A full-width widget spans both columns. Don’t nest a second grid with a different column width in the same band.
- Square corners on FFSA. If an FFSA CSS module sets `border-radius` above 0, that is a failure. Missio’s own radii and pills stay in `shell.module.css`.

## 5. One type system per org skin

The org switcher re-skins the Hub. FFSA and Missio each have exactly one type system, and a screen uses the system of the org it belongs to.

### FFSA

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

Mono is not allowed for names, sentences, empty states, or form fields. Inputs are Roboto at 14.5px (the global input rule).

Do not add Archivo, Fraunces, or Inter on an FFSA screen. Bebas Neue, Anton, and Space Mono stay loaded for unmigrated public event storefronts only.

### Missio

Loaded in `src/components/missio/fonts.ts`:

| Role | Variable | Family | Where |
| --- | --- | --- | --- |
| Body | `--font-missio-body` | Archivo | Sentences, names, table cells, the shell |
| Display | `--font-missio-display` | Fraunces | Titles, including the portaled dialog |

Missio’s own rules set Archivo and Fraunces. Global FFSA button and label rules currently leak in, for example the org pill, Add person, the Campus label, Status, Search, Edit, and the drawer M mark. That leak is known. Do not add more Roboto, Roboto Condensed, or Roboto Mono on a Missio screen. Fix a leak with a scoped CSS-module override, not by editing `globals.css`. The dialog’s scoped button rule already keeps Archivo so the global FFSA button face does not take the dialog. Do not add a third family.

## 6. Type scale

### FFSA

Use a step from this table on an FFSA screen. Don’t pick a size between them.

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

Headings in the FFSA frame are uppercase because `globals.css` sets `h1–h6` and `.masthead-title` that way. FFSA showcase display type may stay sentence case, still in Roboto Condensed, at 40px or 48px.

### Missio

Sizes below are what `src/components/missio/shell.module.css` sets. Titles are Fraunces and sentence case. Body is Archivo. If `content.module.css` adjusts a size, it must keep those faces.

| Role | Size | Weight | Line-height | Tracking | Face |
| --- | --- | --- | --- | --- | --- |
| Page greeting (`h1`) | 30px | 560 | 1.25 | -0.4px | Fraunces, sentence case |
| Section heading (`h2`) | 19px | 560 | 1.25 | -0.4px | Fraunces, sentence case |
| Dialog title | 22px | 560 | 1.25 | -0.3px | Fraunces, sentence case |
| Body | 13px | 400 | 20px | 0 | Archivo |
| Lede | 13.5px | 400 | 20px | 0 | Archivo |
| Card title | 14px | 600 | — | 0 | Archivo |
| Eyebrow | 12px | — | — | 0 | Archivo |

Content-page scale, from `content.module.css` on the Missio polish. These rows override the shell sizes above on the home and people pages. The face stays Fraunces for the title and Archivo for the rest.

| Role | Size | Weight | Line-height | Tracking | Face |
| --- | --- | --- | --- | --- | --- |
| Page title | 40px | 600 | 1.15 | -0.01em | Fraunces, sentence case |
| Intro and body | 14px | 400 | 1.6 (card body 1.5) | 0 | Archivo |
| Card title | 16px | 600 | 1.25 | 0 | Archivo |

## 7–10. Showcase only

Do not apply these to a dashboard widget, a people table, or any other dense admin surface.

**7. Imagery that leads.** Use an existing image slot or a real brand file (`brand/ff-mark-*.png`, `brand/ff-wordmark-*.png`). Do not invent a photograph, and do not reuse an FFX collage as texture. The Missio landing has no photo slot; its lead is the Fraunces greeting, not a fake image.

**8. Rich menus.** The org switcher may show the organisation name, one short blurb, and a selected mark. A table filter stays one control. Don’t add a second menu, a command palette, or descriptions under every nav item.

**9. Small hover.** On a showcase card or the org switcher, a 120–150ms border-colour or background change is enough. No lift, no glow, no `transform` on hover. A table may keep a flat row background change. Don’t add one.

**10. Calm load-in.** One `animate-fade-up` (already in `globals.css`: 0.25s, 8px) on the showcase page root. Not on each card, not on a table, not on the dashboard.

## Before you open the PR

- [ ] Every new padding, margin, and gap is on the spacing scale, or is one of the named classes.
- [ ] Every new font size is a row in the type scale.
- [ ] The screen stays in one type system: Roboto on FFSA, Archivo and Fraunces on Missio. Do not add another Roboto Mono leak on Missio.
- [ ] Copy is sentence case, specific, and free of the filler list. A SOON nav tag is the only “coming next” signal. Numbers are real.
- [ ] The screen has one masthead and at most one needs-you band.
- [ ] Corners are square on FFSA. Regions are rules, not shadows.
- [ ] Passes 7–10 appear only on the org switcher, the Missio landing, or a public page.
- [ ] A 390px screenshot is in the PR. At 360, 390, and 430px, `[data-shell-main]` does not have `scrollWidth > clientWidth` where that element exists, and the document is not wider than its client width. On Missio, measure `document.documentElement` and `[data-missio-content]`.
