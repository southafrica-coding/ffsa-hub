# Store flipbook sounds

## page-flip.wav

The page-turn sound the Store flipbook plays on each turn (muted until the
reader's first tap; never with prefers-reduced-motion).

- **Source:** Wikimedia Commons, [File:Turning a page.ogg](https://commons.wikimedia.org/wiki/File:Turning_a_page.ogg)
  (originally PDSounds record 304, http://www.pdsounds.org/sounds/turning_a_page)
- **Author:** planish (recorded 2007-07-05; transferred to Commons by Fæ)
- **Licence:** Public domain (Commons licence tag `PD`, "Public domain"; PDSounds published only public-domain recordings). No attribution required; credited here anyway.
- **What we changed:** cut to the 1.1 s page turn (1.38 s–2.48 s of the original), normalised, 60 ms fade in / 180 ms fade out, mono 22.05 kHz 16-bit WAV (48 KB).

### What the reader plays

The file is unchanged, but each turn plays only a short slice of it, so the
paper snap lands as the page starts to move rather than as it lands. The
constants are in `src/lib/store/flip-sound.ts`:

- `FLIP_OFFSET_S = 0.74`: the slice starts just before the loud snap (peak at 0.768 s; the first ~0.2 s of the file is a quiet rustle).
- `FLIP_DURATION_S = 0.32`: 320 ms of the clip (about 300–335 ms with the small random pitch change per turn).
- `FLIP_FADE_S = 0.06`: a 60 ms gain fade-out at the end of the slice.

The clip is fetched and decoded once into Web Audio when the reader opens.
Every turn starts a fresh source at once, and the previous one is cut, so
quick turns never queue up.
