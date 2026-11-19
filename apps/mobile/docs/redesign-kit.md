# Redesign kit: tokens, type and components (R1 foundation)

> **R4 (polish and QA, 19 Nov 2026):** every "Not migrated" row below is now
> migrated, the legacy names (`Masthead`, `Text` `display`/`title`/`numeral`/
> `bodyStrong`, `Banner tone="needsYou"`, `Button variant="destructive"`, shell
> `SectionBar`/`StateMessage`/`SkeletonRows`/old `ListRow`) are deleted, and
> the pieces features had built for themselves are in the kit. The current
> kit and how to build a screen with it: **`docs/redesign.md`**. This page is
> kept as the R1 record.

The iPhone redesign's foundation (branch `feat/mobile-r-foundation`, 18 Nov 2026). Source of truth
for the look: `~/CODING/mobile-prompts/redesign/design-spec.md` and the mockups. This page is the
map for the slices that re-lay-out screens (R2/R3): what exists, and what replaces what.

Every component is snapshotted in light and dark in `src/components/__tests__/gallery.test.tsx`;
read the snapshot to see exactly what each one renders.

## Tokens (`src/theme/tokens.ts`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#0A0A0A` | page, tab bar |
| `surface` | `#FBFAF7` (bg-subtle) | `#161614` | list groups, banners, segmented track, pressed rows |
| `surfaceStrong` | `#E7E4D9` | `#2A2924` | pressed fills, skeleton blocks |
| `raised` | `#FFFFFF` | `#161614` | sheets, text fields, secondary buttons, chips |
| `segmentOn` | `#FFFFFF` | `#2A2924` | the selected segment |
| `rule` | `#E7E4D9` | `#2A2924` | hairlines |
| `ruleStrong` | `#8E8A7C` | `#6B675D` | input, switch, chip, photo-slot outlines (3:1) |
| `text` / `textSecondary` | `#0A0A0A` / `#55524A` | `#F4F2EA` / `#C7C3B5` | |
| `textTertiary` / `textQuiet` | `#6B675D` / `#6B675D` | `#C7C3B5` / `#858175` | captions, chevrons / placeholders |
| `accent` / `onAccent` | `#FFB801` / ink | same | the band, ticks. A fill with black text, never text |
| `primary` / `onPrimary` | ink / white | yellow / ink | primary buttons, switch "on" |
| `positive` / `onPositive` / `positiveText` | `#3E7F2B` / white / `#3E7F2B` | `#6FB356` / ink / `#8BC777` | green verdict fill / its label / status text |
| `attention` / `attentionBorder` | `#8A6400` / `#B98600` | `#D9A520` / `#B98600` | |
| `danger` / `onDanger` | `#D92D20` / white | `#EB7070` / ink | |
| `inverse` / `onInverse` | ink / white | `#F4F2EA` / ink | ink chips, tab badge, old section bars |
| `focus` | `#000DE5` | `#FFB801` | focused field ring |
| `bone` | `#C5C2AE` | `#C5C2AE` | **text on black only** (scanner captions) |
| `scrim` | 42% ink | 66% black | sheet backdrop |

`radius`: `none` 0 · `control` 6 (buttons, fields, chips, segments) · `card` 8 (groups, sheets,
band). `radius.default/sm/md` are gone. `space`: 4 · 8 · 12 · 16 · 24 · 32 · 48, `gutter` 20,
`inset` 16. `touch`: `minTarget` 48, `floor` 44.

## Fonts and type (`src/theme/fonts.ts`, `styles.ts`)

Loaded: Roboto 400 / 500 / **600** / 700 / **800** / **900**, Roboto Condensed **400**, Roboto
Mono 500 / 700. Roboto Condensed 900 is no longer loaded: titles are Roboto 900.

| Variant | Spec | Notes |
|---|---|---|
| `eyebrow` | 12/16 · 700 · caps · 0.06em | above the page title and in the band only; secondary by default |
| `label` | 13/18 · 600 · sentence case | **new meaning**: in-content labels; secondary by default |
| `monoLabel` | 11/16 · Mono 700 · caps · 0.14em | codes and IDs. **The old `label`** |
| `caption` | 13/18 · 400 | |
| `body` | 16/24 · 400 | |
| `sectionTitle` | 15/22 · 600 | |
| `rowTitle` | 16/24 · 600 | |
| `pageTitle` | 28/34 · Roboto 900 · caps · −0.01em | header role, max 1.4× |
| `hero` | 34/36 · Roboto 900 · caps | sign-in, ticket; header role, max 1.3× |
| `kpi` | 24/32 · 500 · tabular | max 1.6× |
| `note` | 14/20 · Roboto Condensed 400 | helper notes; secondary by default |

Legacy names still work (they now render in Roboto, not Condensed): `display` = `pageTitle`;
`title` = Roboto 900 caps 20/24; `numeral` = Roboto 900 40/44 tabular; `bodyStrong` = Roboto 500
16/24. New tones: `onPrimary`, `bone`.

## Old → new (for R2/R3 migrations)

| Old | New | Migrated in R1? |
|---|---|---|
| `Text variant="label"` (mono caps) | `variant="monoLabel"` for codes/IDs; `variant="label"` (sentence case) for in-content labels; `SectionHeader` for section titles | Renamed to `monoLabel` everywhere (mechanical, same look). Choosing `label`/`SectionHeader` per screen is R2/R3. |
| `Text variant="display"` | `LargeTitle` (page header) or `variant="pageTitle"` / `"hero"` | Alias kept (sign-in, SetSheet still use it) |
| `Text variant="title"` | `variant="sectionTitle"` (in content) or `pageTitle` | Alias kept |
| `Text variant="numeral"` | `variant="kpi"` or `MoneyText variant="kpi"` | Alias kept |
| `Text variant="bodyStrong"` | `variant="rowTitle"` | Alias kept |
| `Masthead context title` | `LargeTitle eyebrow title` (static) or `LargeTitleScrollView` (collapsing; replaces `Screen` + `Masthead`) | `Masthead` now renders `LargeTitle`, so every screen already has the new header look |
| `Banner tone="needsYou"` | `NeedsYouBand eyebrow text actionLabel onAction` | Banner still draws the new band (8pt, no border) |
| `Banner tone="danger"` | `Banner tone="error"` (+ `actionLabel="Try again" onAction`) | Alias kept |
| `Banner tone="info"/"positive"` | `tone="info"/"offline"/"queued"/"positive"` | Restyled in place (full border + icon) |
| `Banner action={<Button …/>}` | `actionLabel` + `onAction` (inline underlined action) | Both work |
| `Button variant="ghost"` | `variant="text"` (underlined) — keep `ghost` only for an unadorned close | Alias kept |
| `Button variant="destructive"` | `variant="danger"`; `dangerFill` for the final destructive confirm | Alias kept |
| `Button` (48dp, mono caps label) | `Button` (50pt, `size="small"` 44pt, sentence-case Roboto 700) | Restyled in place |
| `features/finance/components/Sheet` | `Sheet` from `@/components` | Re-export at the old path |
| `features/prayer/components/ui` `Sheet` | `Sheet` from `@/components` | Re-export at the old path |
| `prayer/components/ui` `Segments`, other features' tab strips | `SegmentedControl items value onChange` | Not migrated (R2 Prayer) |
| `features/shell` `SectionBar` + `BarAction` (black bar) | `SectionHeader title actionLabel onAction` | Not migrated (screens) |
| `features/shell` `ListRow` (full-width, hairline below) | `ListGroup` + `ListRow` from `@/components` (inset card; `trailing="web"`, `unread`, `meta`) | Not migrated (screens). Two `ListRow`s exist until then: import the kit one |
| `features/shell` `StateMessage` | `EmptyState title body icon actionLabel onAction` | Not migrated |
| `features/shell` `SkeletonRows` | `SkeletonList label count` / `Skeleton` | Not migrated |
| Feature status pills (`bookings/components/ui`, `finance/components/ui`, `okrs/components/ui`, `schools/components/ui`, prayer) | `StatusChip variant label` (word + icon) | Not migrated |
| `formatMoney(...)` inside `<Text>` | `MoneyText amount currency options` | Not migrated |
| "Opens in browser" caption + `ExternalLink` icon | `WebHint` / `ListRow trailing="web"` | Not migrated |
| `<Switch {...switchColors(...)} />` | `Toggle value onValueChange accessibilityLabel` | Not migrated (helpers still themed) |
| `me/components/docs-ui` photo block | `PhotoSlot hasPhoto onView onTake onChoose onRemove` | Not migrated (R2 Me) |
| `radius.default` | `radius.control` (controls) / `radius.card` (cards) | Done (4 usages) |
| `palette.bone` (#F4F2EA) | `palette.paper`; `palette.bone` is now #C5C2AE (text on black only) | Done (no feature used it) |

## Shell

- Tab bar: 3pt yellow tick + Roboto 800 label + 2.5 stroke icon when active; Roboto 500
  secondary when not; 48pt + home indicator; ink badge (cream in dark), "99+".
- `tabForRoute()` maps Bookings, Schools, History, OKRs, Ministries and Staff decisions to Home.
- The bar hides on `TAB_BAR_HIDDEN_ROUTES` (ticket QR, door scanner, Add expense, receipt
  viewer, new booking, vehicle checks, Edit profile, household member) or when a screen sets
  `tabBarStyle: { display: "none" }`. Add a route there if a new full-screen form appears.

## Testing notes

- `jest.setup.ts` mocks `react-native-reanimated` with a small stand-in (the official mock crashes
  on SDK 58). `LargeTitleScrollView` renders in tests; the collapse itself needs a device.
- Use `testOnly_pressed` on a `Button` to test its pressed style.
