# OKR sheet import

`okrs-sheet.md` is a verbatim export of the FFSA OKR Google Sheet
(<https://docs.google.com/spreadsheets/d/19NoziWv5k4Ce4aQu75CdIaD-GYgRgtgzMOY8WBR87PI/edit>),
kept as-is so the import is reproducible and auditable against the original.
It is one flat export of many tabs: 27 ministry blocks, 121 objectives and
around 510 key results, covering more than one year.

## Why there is a manifest

Most ministries appear **twice** — an older block and a reworked one — and
nothing in the export says which is current. Two of them carry a hand-typed
hint (`old 2026` above line 205, `2025` above line 1038); the rest carry
nothing. Importing the wrong block would quietly replace this year's plan with
last year's, and nobody would notice until a review meeting.

So the importer imports **nothing** unless `okrs-manifest.json` names each
block explicitly by the line it starts on.

## How to run it

```
npx tsx scripts/import-okrs.ts --inspect
```

Lists every block with its counts and first objective. Use it to decide.

Copy `okrs-manifest.example.json` to `okrs-manifest.json` and give every block
you want exactly one owner:

- `"ministrySlug": "operations"` — a real staff ministry, from
  `public.staff_ministries`. Its leaders can then edit those OKRs.
- `"teamSlug": "the_watchmen"` — a group that writes OKRs without being a
  ministry, from `public.okr_teams`. Everyone can read these; only leadership
  and admins can edit them, because a team has no roster and so nobody the
  database can recognise as its leader.

Blocks left out are simply not imported. Where a sheet block is really a
sub-team of a ministry, add `"subcategory": "<name>"` and it lands on
`okr_objectives.subcategory_id` under the parent. Subcategories only apply to
ministries, not to teams.

```
npx tsx scripts/import-okrs.ts --dry-run --cycle=2026
```

Parses, resolves every ministry and every progress word, and prints the counts
without writing. It aborts rather than proceed if a slug does not exist or a
progress value is not in `STATUS_MAP` — a silent partial import is worse than
no import.

```
npx tsx scripts/import-okrs.ts --cycle=2026 --author=<user-uuid>
```

The real run. `--author` is the user recorded on every seeded check-in, dated
to the cycle's start (the sheet has no per-cell dates). Add `--reset` to clear
that cycle's objectives first; without it the importer refuses to run into a
cycle that already has rows.

No key result gets a numeric metric: the sheet has none. Every imported row
therefore shows a status and no progress bar, which is the correct reading.
