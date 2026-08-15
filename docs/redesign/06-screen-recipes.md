# Screen recipes

Each screen, in build order, expressed as composition of the primitives in
`src/components/ffsa`. Design reference: the frame ids in `FFSA Hub Redesign.dc.html`.

Every admin page has the same skeleton:

```tsx
<Masthead context="…" title="…" actions={<>…</>} />
<KpiStrip>…</KpiStrip>          {/* optional */}
<NeedsYou>…</NeedsYou>          {/* AT MOST ONE per page */}
<main>…</main>
```

---

## Dashboard — frame 2a · src/app/(admin)/dashboard/page.tsx

- Masthead context: `WEEK 32 · MON 03 AUG 2026`. Title: `Dashboard`.
- Actions: search chip (⌘K), black `+ CREATE`.
- KpiStrip of 4: active contacts (lead), published events, active users, registrations.
  First cell gets `lead` — bone background + yellow rule. The other three are white.
- NeedsYou: staff awaiting approval. This is the page's only yellow.
- Two columns below, each opened by a SectionBar: Upcoming events (DateBlock + title +
  location + registered count) and Recent registrations (Initials + name + event + StatusPill).
- Bottom strip: support raised with a Bar, and one photo tile.
- DELETE: the Bebas `.page-title`, the amber KPI card treatment, all `rounded-*`.

## Events — frame 3a · src/app/(admin)/events/

- A real `<Table>`, not cards. Columns: date (DateBlock) · event · type · capacity · state.
- Capacity cell = "1 140 / 2 000" + `<Bar pct={57} />`. State = StatusPill.
- Filter strip under the masthead: bone background, Chip per filter, first one active.
- Saved views live in the module panel as stacked chips.

## Training — frame 3b · src/app/(admin)/schools/

- One wide row per school: code (mono), name (condensed 28px), phase + week, students
  and staff as Numerals, then a term Bar with the percentage and an OPEN action.
- Right column 380px: applicant pipeline (Initials + name + school + note + StatusPill),
  with next-intake block pinned to the bottom.

## Bookings — frame 3c · src/app/(admin)/bookings/

- Spaces AND vehicles on ONE day timeline so clashes are visible. 230px resource column,
  7 hour columns, blocks positioned absolutely by percentage.
- Block tones: black (ordinary), yellow (event-linked), bone (all-day).
- Requests-to-approve table underneath, each row ending in a black APPROVE.

## Finance — frame 5a · src/app/(admin)/finance/

- KpiStrip of 4, each with a Bar.
- Support accounts table: person · raised/target with Bar · state pill
  (FULLY FUNDED / ON TRACK / BEHIND / NOT STARTED — derive from pct, don't store).
- Right column 400px: ledger rows, income green, payouts black, tabular amounts.
  Unreconciled-payments block pinned bottom.

## Communications — frame 5b · src/app/(admin)/communications/

- Campaign table with audience, open rate and click rate on the same row.
- Audience segments in the module panel with counts.
- Right column: draft composer with a live email preview.

## Login — frame 4b · src/app/(auth)/login/

- Two columns: photo left (black, 55% scrim, wordmark top, condensed headline bottom),
  flat square form right. No card, no shadow.

## Public event page — frame 4c

- The loudest surface: full-bleed photo masthead, 118px condensed title, facts strip
  of 4 bone cells, body copy left and the registration form inline on the right.
- This is the only place the brand runs at full volume.

## Mobile portal — frames 4d, 11b

- Bottom tab bar, 4 items, 48px targets.
- One big Numeral per screen.
- Lists scroll; rows are two lines, never three.

## Prayer Room — frames 8a → 13b

Build LAST and only after the schema. Order:
1. the wall (8a) — read-only
2. set detail drawer (9a) + claim flow (9b)
3. seats and the People tab (10a/10b)
4. person profile (11a) and mobile (11b)
5. evaluators portal, band curation, two-note evaluation (12a–13b)
