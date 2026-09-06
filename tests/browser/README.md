# Browser checks

What cannot run in Vitest, and how it is verified. Two kinds of check live here.

## Automated — `npx playwright test`

`playwright.config.ts` drives the installed Google Chrome (`channel: 'chrome'`), never a downloaded
browser. These specs are not part of CI (D36); run them locally, and set `BARNESTRACK_SAMPLE_DIR`
to the upstream `data/barnes-maze/` folder to include the sample videos:

```
BARNESTRACK_SAMPLE_DIR=../rse-takehome-2026/data/barnes-maze npx playwright test
```

- `frame-server.spec.ts` (chunk 1) — WebCodecs decoding: frame identity, sequential order, random
  access against the sequential pass. Measurements in `prototypes/frame-server/RESULTS.md`.
- `app.spec.ts` (chunk 3) — the three app behaviours a person driving a mouse cannot verify: a real
  `drop` event carrying a `DataTransfer` of real `File`s (the file picker is a different code path),
  reload plus re-attach by fingerprint including a renamed copy, and save → reset → load compared as
  a parsed deep-equal. Key order is not part of the session contract, so the comparison is on the
  parsed object, not the bytes.

## Manual — recorded here because a fresh clone has no other record (D36)

The rest of the chunk-3 acceptance list was verified by hand in Google Chrome on macOS against
`npm run dev`. What was checked, and what it showed:

**Intake.** Loading `test53.mp4`, `test51.mp4` and `test50.mp4` together gives three cards reading
905 · 30.000 fps · 0:30, 741 · 14.985 fps · 0:49 and 5539 · 30.000 fps · 3:05, in load order, each
saying "Processed locally — this file never leaves your computer". A `.txt` is listed under
"Not loaded" with its reason.

**Maze click budget (D13, D29).** A new maze on test53 costs five clicks on the image — three rim
points, one ring alignment, one target hole — plus the platform diameter typed in. Applying that map
to test50, which shares the rig and the framing, costs none; applying it to test51 and correcting it
with "Adjust" costs three. The badge on the panel shows the count at all times.

**Keyboard only.** A complete maze can be built without touching the image. The keys used:

| Key | What it does |
| --- | --- |
| `Tab` / `Shift+Tab` | move through the controls; the frame itself is in the tab order |
| `←` `→` on the stepper | change step (also `Home`, `End`); the panel follows focus |
| typed numbers + `Tab` | centre x, centre y and radius create or move the platform; ring angle, target hole, hole count, ring ratio, hole diameter, platform diameter |
| `Enter` in "Hole to nudge" | select that hole and move to the frame |
| `←` `↑` `↓` `→` on the frame | nudge the selected hole or the platform by 1 px |
| `Shift` + those | nudge by 10 px |
| `+` `−` `0` on the frame | zoom in, zoom out, fit |
| `Alt` + arrows on the frame | pan |
| `←` `→` on the scrubber | ±1 frame (`Shift` for ±10, `Home`/`End` for the ends) |
| `Escape` | cancel the Reset session confirmation |

**No network (D2).** Across a full walkthrough the page issued only same-origin requests to the dev
server. `dist/` contains no external URL — the only `http://` string in the build is the SVG
namespace `http://www.w3.org/2000/svg`, which is an XML namespace identifier passed to
`createElementNS` and never fetched.

**200 % zoom (D37).** At a 483 × 423 CSS viewport — what a 1280-wide window looks like at 200 % —
there is no horizontal scrolling and every control stays within the viewport. Text contrast was
measured against the palette in `src/styles/app.css`: the lowest text pair is 6.56:1 and the two
non-text borders are 3.04:1 and 3.37:1, against the 4.5:1 and 3:1 requirements.
