# Review components — harness results (chunk 7a)

What was checked by hand in Google Chrome against
`http://localhost:5174/prototypes/review-components/`, served by `npm run dev`, on
2026-09-06. The four panels are mounted on the synthetic session from
`tests/fixtures/synthetic-analysis.ts`, so everything below is reproducible by opening the page.

Chrome 141 on macOS 15.5 (Darwin 24.5.0), window 1456 × 839 CSS px.

## Live recompute (D20)

`onParametersChange` is wired to a real `derive()` re-run. On `video-test50`, raising
**Hole investigation → Min duration** from 0.2 s to 10 s:

|                 | before  | after    |
| --------------- | ------- | -------- |
| events          | 16      | 9        |
| investigations  | 15      | 8        |
| primary errors  | 8       | 7        |
| total errors    | 13      | 7        |
| primary latency | 96.96 s | 169.80 s |
| strategy        | serial  | random   |

The diff badge read, in full:

> −7 investigations; primary errors 8 → 7; total errors 13 → 7; primary latency 96.96 s → 169.80 s;
> strategy serial → random; status unchanged; quality tier unchanged.

Every clause agrees with the metrics card beside it — the badge is not describing a different
computation. `derive()` took 147 ms on the first re-run (5,539 frames) and 17–20 ms on later ones,
so the 100 ms debounce is doing real work rather than hiding a slow path.

The three always-present clauses (`strategy`, `status`, `quality tier`) appear even when unchanged,
which is the point: a badge that went quiet about the strategy could not be told apart from one that
had not noticed it move.

## Refusing an invalid value

Typing `0.1` into **Frame timing → Drop gap factor** (it must exceed `duplicateTimestampFactor`):

- two rows gained `is-invalid` — `dropGapFactor` and, correctly, `duplicateTimestampFactor`, because
  the broken constraint is a relation between them;
- the row message read `kinematics.dropGapFactor must be a factor above 1, got 0.1`;
- the panel summary read `2 parameters out of range; nothing has been recomputed. …`;
- the callback log gained **no** `onParametersChange` and **no** `derive()` line;
- the field kept the typed `0.1` rather than snapping back.

## Strategy override round trip (D23)

1. Applying with an empty reason was refused: _"Say why you are overriding the classification before
   applying it."_ No `onOverride` was emitted.
2. With class `spatial` and a reason, the log showed
   `onOverride(spatial, "Direct approach; the adjacent run is two merged bouts.")`, `derive()` re-ran
   in 20.1 ms, the class became **spatial** with a `user` badge and the note _"automatic call was
   serial"_.
3. `Revert to automatic` emitted `onRevert(harness-strategy-…)`, re-derived in 16.6 ms, and the class
   returned to **serial** with an `auto` badge.

The override is applied by adding a `StrategyOverrideCorrection` and re-deriving — never by patching
the analysis — which is the wiring chunk 7b has to reproduce.

## Focus through a recompute

Re-checked after the fix in `fe87661`. With the keyboard focus on the **Min duration** slider:

- driving it to 3 and then to 5, each crossing the 100 ms debounce, left the focus on that same
  element both times, and the element itself stayed in the DOM (`document.contains` true) — so a
  drag is not interrupted by the recompute it triggers;
- driving it to 10, which really does change the analysis (16 events → 9, and the event list rebuilt
  to 9 cards), still kept the focus on the slider;
- the numeric twin followed to 5 and the badge stayed correct throughout.

Before the fix the harness destroyed and recreated all four panels on every recompute, and the event
list rebuilt every card even when no event had changed. Both are why the panels now expose
`update()` and the harness uses it.

## Seeking

All three seek paths emit a sample-table `FrameIndex`:

- event card → `onSeek(312)` (the event's `startFrame`);
- quality gap row → `onSeek(1662)` (the gap's `startFrame`);
- metrics "Trial start" → `onSeek(0)` (`cleanedTrack[trial.startFrame].frameIndex`, **not** the
  array position).

## Parameter coverage

The panel rendered 11 blocks and 39 rows: 16 editable analysis parameters, 15 read-only tracking
parameters and the 8 analysis options.

- `Tracking (D6)` contains **0** `input`/`select`/`textarea`/`button` elements and 15 rows, each with
  its value, unit, definition and `decision D6`, plus the sentence pointing at the Track step (D51).
- `Model options — not hashed, not exported (D55)` lists all 8 options with their definitions and
  states that they are not covered by the parameters hash.

## Keyboard (D37)

Walked with the keyboard only, no mouse.

- 134 focusable elements on the page; **0** with a positive `tabindex`; **0** form controls without a
  `<label for>` or an `aria-label`.
- Tab order is contiguous per panel — `chrome → parameters (79) → metrics (30) → quality (3) →
events (19)` — so no panel interleaves with another.
- Pressing Tab six times from the top landed on a `<summary>` with a 3 px `rgb(10, 77, 140)` focus
  ring, confirming both that disclosures are reachable and that focus is visible.
- Chrome reports `tabIndex === 0` for `<summary>` and focus lands on it. **happy-dom reports −1**,
  which is a gap in the DOM shim, not in the panels; `tests/ui/components/keyboard.test.ts`
  therefore models the browser and says so in a comment. This check is the evidence for that.
- The canvas is not in the tab order; the mirror table beside it carries the same facts.

## 200 % zoom (D37)

The window could not be resized below 1280 CSS px, and `documentElement.style.zoom` scales without
giving the layout the narrower viewport, so neither is a faithful test. Instead each panel was
constrained to **640 px** — what a 1280 px window gives the content at 200 % zoom — and measured for
overflow: **0 overflowing elements in all four panels**, no horizontal page scroll. The panels use
`flex-wrap` and rem units with no fixed pixel widths, and wide content (the gap table, the mirror
table) sits inside `.table-scroll`.

## Grayscale (D26)

Screenshots converted with
`sips --matchTo '/System/Library/ColorSync/Profiles/Generic Gray Profile.icc'`, the same check used
for the figure gallery in chunk 8, and read back.

Distinguishable with no colour at all:

- **corrected vs automatic event** — the corrected card keeps its 45° hatch, a heavier border and
  the `✎ user` badge; the automatic card below it is plain with an `auto` badge. The two are
  unmistakable side by side.
- **quality tier** — `● GOOD`: the glyph is inside the badge's own text, so it survives both
  grayscale and a screen reader.
- **invalid parameter row** — the bar on the leading edge stays visible and the message states the
  problem in words; the tinted background alone is faint in grayscale, which is why the bar and the
  text are there.
- **quality strip legend** — each state carries its own hatch direction _and_ its name and
  percentage (`tracked · 97.6%`, `low confidence · 1.3%`, `ambiguous · 0.4%`, `not detected · 0.7%`),
  drawn by `src/viz/quality-strip.ts`.
- **target flag** — `★ target` badge, word plus glyph.

## Re-check after the reviewer's findings (`e6cad2a` and after)

Everything below was re-run on the live page once the four blocking findings were fixed.

- **The badge no longer goes silent on a continuous measure.** Setting **Hole span** to 9.5 — which
  moves nothing but the quadrant time — gave
  `target quadrant time 78.21 s → 178.37 s; strategy unchanged; status unchanged; quality tier
unchanged.` Before the fix the same change read `No change.`
- **Displayed and emitted values agree.** Editing a focused field, letting a re-derive land, and
  editing again left the field showing what was typed (4.5) and the panel emitting that same value.
- **"Trial start" carries O5's own rule**, not the trial-cutoff definition it used to show.
- **Revert is present but hidden** while the classification is automatic (`hidden`,
  `display: none`), so it is out of the tab order while the reason textarea beside it survives.
- **The event card has no `aria-label`** and holds no `<p>`/`<div>`/`<dl>`, so a `<button>`'s
  content model is respected and the button's own text is its accessible name. That name now reads:

  `Investigation hole 0 auto From: 0:10 (frame 312) To: 0:18 (frame 562) Duration: 8.34 s Judged on:
nose Min nose distance: 0.52 cm Min centroid distance: 2.91 cm hole 0 (non-target). Event point
within …`

  — the evidence sentence, both distances and any review flag included, which is what D19 and D26
  require it to say. The separators are real text, not CSS, because CSS `content` is not part of
  `textContent` and so never reaches the accessible name.

- **The nose-confidence distribution (D30)** is rendered as a third table in the quality panel, with
  the bin, its frame count and its share — a table rather than bars, so it survives grayscale.
- **Grayscale, re-shot on the rewritten card markup.** The corrected card keeps its 45° hatch, its
  heavier border and the `✎ user` badge, and is unmistakable between the two plain `auto` cards
  above and below it.

## Re-check after the D55 reconciliation (chunk 7b-1)

Chrome 152 on macOS 15.5, viewport 1295 × 802 CSS px, 2026-09-07,
`http://localhost:5173/prototypes/review-components/`. No console errors.

- **All four panels mount and the eight D55 thresholds are editable.** The blocks read
  `Trial censoring (O5)`, `Search strategy (O7)` and `Quality tier (D30)`, "Model options — not
  hashed, not exported" is gone, and the page loads two stylesheets — the app sheet and the harness
  page's own chrome — rather than three. Clicking **Censor to cutoff** on test50, whose trial is cut
  off, gave `total latency none → 180.00 s; strategy unchanged; status unchanged; quality tier
unchanged.`, a `derive()` in 23.4 ms and the announcement "Censor to cutoff turned on."
- **The strategy and quality thresholds move what they are supposed to move, and the badge says so.**
  **Serial min run** 3 → 10 read `strategy serial → random; runner-up random → serial; …` — the
  runner-up clause added in this chunk, firing on the case the widened sweep found. **Good min
  positioned fraction** 0.9 → 1 read `quality tier GOOD → REVIEW` and the badge changed to
  `▲ REVIEW`. **Poor max positioned fraction** 1 against a GOOD threshold of 0.9 was refused:
  `1 parameter out of range; nothing has been recomputed. quality.poorMaxPositionedFraction must not
exceed quality.goodMinPositionedFraction, got 1 and 0.9`, the row marked `is-invalid`, the typed `1`
  kept, and no `onParametersChange` or `derive()` in the log.

## Not checked here

- Real browser page zoom at 200 % (emulated by container width, as above).
- Screen-reader output. The panels are built from native controls with labels and a live-region
  callback, and the tab order and labelling were checked mechanically, but no assistive technology
  was driven.
- Anything mounted inside the app shell: these components are unmounted by design in this chunk, and
  chunk 7b mounts them.
