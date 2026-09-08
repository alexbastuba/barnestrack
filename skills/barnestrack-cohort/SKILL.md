---
name: barnestrack-cohort
description: 'Summarise and compare Barnes maze cohorts from BarnesTrack exports: trials.csv, events.csv, quality.csv, parameters.json'
---

# Barnes maze cohorts from BarnesTrack exports

Answer questions about Barnes maze cohorts — learning curves, group comparisons, strategy
breakdowns, which videos need a second look, why two analyses disagree — by reading the files
BarnesTrack writes.

This skill reads exported files only. It does not talk to the application, open videos, or run
tracking. If a question needs something the export does not contain, say so and name what would
have to be re-exported.

## What an export contains

A BarnesTrack export is a folder or ZIP named `barnestrack_export_<cohort>_<YYYYMMDD>.zip`, where
`<cohort>` is the session name lowercased with runs of non-alphanumerics replaced by hyphens — so
"Barnes cohort A" gives `barnes-cohort-a`. That slug names the ZIP only; the session file inside
keeps the cohort name as it was typed. The six files:

| File                              | One row per                   | Notes                                                                                                       |
| --------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `trials.csv`                      | trial                         | 36 columns; the headline numbers                                                                            |
| `events.csv`                      | investigation or escape entry | 23 columns; what the latencies and errors are made of                                                       |
| `quality.csv`                     | video                         | 20 columns; whether to trust the video at all                                                               |
| `parameters.json`                 | —                             | the full parameter set, including thresholds that are not CSV columns                                       |
| `<session name>.barnestrack.json` | —                             | the session file: tracks, corrections, maze map. Large. Read it only if the CSVs cannot answer the question |
| `barnestrack_export.xlsx`         | —                             | the same three tables as sheets, plus `parameters` and `readme`                                             |

Reading conventions that apply to all three CSVs:

- RFC 4180, `\r\n` line endings, UTF-8 with no byte-order mark, no comment rows, header on line 1.
- **An empty field means "not recorded", never zero.** Do not let a parser coerce it to `0`, and do
  not include it in a mean as a zero. Say how many rows were blank instead.
- Seconds are rounded to 3 decimal places and centimetres to 2; fractions are unrounded.
- `tool_version`, `schema_version` and `parameters_hash` are on every row of every file.

## `trials.csv`

Header, verbatim:

```
session_id,video_id,animal,day,trial_label,group,target_hole,trial_start_s,primary_latency_s,total_latency_s,primary_errors,total_errors,path_length_cm,path_length_smoothed_cm,mean_speed_cm_per_s,target_quadrant_time_s,strategy,strategy_source,escaped,status,tracked_fraction,correction_count,hole_investigation_radius_factor,hole_investigation_min_duration_s,hole_investigation_merge_gap_s,escape_entry_radius_factor,escape_entry_min_duration_s,escape_entry_persist_cutoff_s,trial_cutoff_s,target_quadrant_hole_span,gap_fill_max_duration_s,nose_confidence_cutoff,outlier_velocity_threshold_cm_per_s,tool_version,schema_version,parameters_hash
```

Identifiers and metadata: `session_id` (the cohort name — see the warning under Rules),
`video_id`, and the four fields a user types per video: `animal`, `day`, `trial_label`, `group`.
Any of the four may be blank; BarnesTrack does not parse filenames.

`target_hole` is the hole every latency and error in the row is measured against, under the maze
map's numbering. **It is the whole session's map target, so it is the same on every row of a
file.** A cohort whose platform was rotated between trials — which is the usual protocol — cannot
yet express a per-trial target, so if two rows should have different targets they were exported
from one session that could not say so. Check with the person who ran the cohort before pooling.

Measures:

- `trial_start_s` (s, **may be blank**) — where the trial begins. Every latency is measured from
  here, not from the start of the video. Blank on an `unresolved` row, where no trial was found.
- `primary_latency_s` (s, **may be blank**) — trial start to the first investigation of the target
  hole. Blank when the animal never investigated the target.
- `total_latency_s` (s, **may be blank**) — trial start to the escape-box entry. Blank when the
  animal never entered; the trial is then `escaped = false` and `status = review`. Blank is not the
  cutoff, and substituting the cutoff is a decision the analyst has to state.
- `primary_errors`, `total_errors` (count) — investigations of non-target holes, repeat visits
  included; primary counts those before the first target investigation.
- `path_length_cm`, `path_length_smoothed_cm` (cm) — raw and median-smoothed centroid path. Report
  which one you used. Gaps are excluded from both.
- `mean_speed_cm_per_s` (cm/s) — smoothed path over tracked time within the trial.
- `target_quadrant_time_s` (s) — time in the 90° sector centred on the target hole.
- `strategy` — `spatial`, `serial` or `random`.
- `strategy_source` — `auto` or `corrected`.
- `escaped` — `true` or `false`.
- `status` — `ok`, `review` or `unresolved`. See Rules.
- `tracked_fraction` (0–1, **may be blank**) — frames in the trial with a fully resolved position. This counts the
  `tracked` state only, so it reads lower than "frames with a usable position", which is
  `quality.csv`'s `positioned_fraction`. Judge a video on that one; `quality.csv` has the full
  breakdown.
- `correction_count` (count) — human corrections affecting this trial.

Threshold columns, carried so the numbers can be reconciled later:
`hole_investigation_radius_factor` (× hole radius), `hole_investigation_min_duration_s` (s),
`hole_investigation_merge_gap_s` (s), `escape_entry_radius_factor` (× hole radius),
`escape_entry_min_duration_s` (s), `escape_entry_persist_cutoff_s` (s), `trial_cutoff_s` (s),
`target_quadrant_hole_span` (holes), `gap_fill_max_duration_s` (s), `nose_confidence_cutoff` (0–1),
`outlier_velocity_threshold_cm_per_s` (cm/s).

Provenance: `tool_version`, `schema_version`, `parameters_hash`.

## `events.csv`

Header, verbatim:

```
session_id,video_id,trial_label,event_id,kind,hole_index,is_target,start_frame,end_frame,start_time_s,end_time_s,duration_s,point_used,min_nose_distance_cm,min_centroid_distance_cm,evidence_summary,source,auto_hole_index,auto_start_frame,auto_end_frame,tool_version,schema_version,parameters_hash
```

- `event_id` — stable within one export; `auto-…` ids are derived from the event's own content, so
  they change if the event moves.
- `kind` — `investigation` or `escape_entry`. **Nothing else appears here.** A tracking failure is
  a finding of the quality report, not an event, so the number of rows in `events.csv` is not the
  number of events in the session file.
- `hole_index` (may be blank), `is_target` (`true`/`false`).
- `start_frame`, `end_frame`, `start_time_s`, `end_time_s`, `duration_s` (s) — first to last frame
  of the event; `duration_s = end_time_s - start_time_s`.
- `point_used` — `nose` or `centroid`. Which body point the event was judged on. The nose is used
  only when its heading confidence clears `nose_confidence_cutoff`, and it is labelled experimental
  in the application; an analysis that leans on hole-level precision should report how many events
  were judged on each. `quality.csv` gives that per video as `nose_judged_event_fraction`.
- `min_nose_distance_cm`, `min_centroid_distance_cm` (cm) — closest approach to the hole during the
  event. `min_nose_distance_cm` is **often blank**, because the nose is frequently unavailable.
- `evidence_summary` — the sentence the application shows for why this is an event. Quote it when
  explaining a specific event; do not parse it for numbers.
- `source` — `auto` or `corrected`.
- `auto_hole_index`, `auto_start_frame`, `auto_end_frame` — what the automatic pass had said before
  a human changed it. Populated **only** when `source = corrected`; blank otherwise. A row where
  these differ from the live columns is a visible disagreement between the tool and a reviewer, and
  is worth surfacing.

## `quality.csv`

Header, verbatim:

```
session_id,video_id,tracked_fraction,not_detected_fraction,ambiguous_fraction,low_confidence_fraction,positioned_fraction,whole_clip_positioned_fraction,nose_judged_event_fraction,gap_count,longest_gap_s,duplicate_timestamp_count,dropped_frame_gap_count,drift_s,platform_diameter_cm,px_per_cm,tier,tool_version,schema_version,parameters_hash
```

- `tracked_fraction`, `not_detected_fraction`, `ambiguous_fraction`, `low_confidence_fraction`
  (each 0–1) — the four detection states. `low_confidence` frames **do** carry a position; only
  `not_detected` and `ambiguous` lack one. The four are measured over the trial window when a trial
  start exists, so an empty platform before the animal is placed does not count against the video.
- `positioned_fraction` (0–1) — **the number to judge a video on**, and the one `tier` is computed
  from (D54). It is the fraction of trial-window frames that carry a position at all, so it counts
  `tracked` and `low_confidence` together and is always ≥ `tracked_fraction`. Use this, not
  `tracked_fraction`, when deciding whether to trust a video.
- `whole_clip_positioned_fraction` (0–1) — the same fraction over every frame in the file rather
  than over the trial window. It reads lower whenever the recording starts well before the animal
  is placed; a large gap between the two is a long empty-platform preamble, not a tracking failure.
- `nose_judged_event_fraction` (0–1, **may be blank**) — the fraction of this video's events whose
  distance was measured from the nose rather than the body centroid (O16). Blank when the video has
  no event at all; never 0 for that reason. An analysis that leans on hole-level precision should
  read this before trusting `events.csv`'s `min_nose_distance_cm`.
- `gap_count` (count), `longest_gap_s` (s) — runs with no position, and the worst one.
- `duplicate_timestamp_count`, `dropped_frame_gap_count` (count), `drift_s` (s) — properties of the
  video file's own timing, always measured over the whole clip. Drift is how far the file's
  timestamps have moved away from `frame ÷ nominal fps` by the end. These are not tracking
  failures; they are why BarnesTrack never uses nominal frame rate for timing.
- `platform_diameter_cm` (cm), `px_per_cm` (px/cm) — the calibration this video's measurements rest
  on. Two videos with very different `px_per_cm` were framed differently; that is expected, and it
  is already accounted for because every threshold is stored in centimetres.
- `tier` — `GOOD`, `REVIEW` or `POOR`, cut from `positioned_fraction` at the two tier thresholds,
  which are themselves hashed parameters (D54, D55).

## `parameters.json`

The full parameter set as a JSON object, exactly as the analysis used it — nothing added, no
wrapper, no hash field. It contains everything `parameters_hash` covers, which is **more than the
threshold columns in `trials.csv`**: the kinematics block (`speedWindowFrames`,
`duplicateTimestampFactor`, `dropGapFactor`), `kinematicsSmoothingWindowFrames`,
`gapFilling.enabled`, and the whole `tracking` subtree are hashed but are not columns. When two
cohorts have different hashes and identical threshold columns, the difference is in here.

It is the whole of what decided the numbers. The trial-censoring switch, the five strategy-rule
thresholds and the two quality-tier thresholds are fields of `Parameters` (D55), so they are in
here and under the hash even though none of them is a column in `trials.csv`. See Rule 4.

An export made before any analysis ran contains the literal `{}`.

## Rules

These are not style preferences. Each exists because ignoring it produces a confidently wrong
number.

1. **Never fold `review` trials into a headline number silently, and drop `unresolved` ones
   entirely.** `status = ok` means the animal escaped and nothing needed a human look. `review`
   means the trial ran past the cutoff, tracking failed, or a value could not be resolved
   automatically — the numbers are real, they just need saying out loud. On some cohorts every
   trial is `review`; that is a known property of the escape-entry rule, not a broken export, and
   the right response is to say so and use the measures it does not affect (errors, path length,
   quadrant time, strategy) rather than quietly averaging latencies that are blank.

   `unresolved` is different and more dangerous: it means **no trial window was found at all** —
   no trial start could be detected. Nothing about it involves review, and a correction cannot
   produce it. On such a row `trial_start_s`, both latencies, `tracked_fraction`,
   `path_length_cm`, `path_length_smoothed_cm`, `mean_speed_cm_per_s` and `target_quadrant_time_s`
   are all blank — there is no window to measure them over. Two columns are not blank, and both
   mislead:

   - `primary_errors` and `total_errors` read a literal **`0`**, because no event can fall inside a
     window that does not exist. Rule 2 will not save you here: the cell is not blank, so a mean of
     `total_errors` absorbs the zero in silence.
   - `strategy` reads **`random`** with `strategy_source = auto`. No rule produced it; it is a
     placeholder recorded when the classifier could not run. Nothing in the CSV distinguishes it
     from a real `random` classification, so every `unresolved` row inflates the `random` bucket of
     any strategy cross-tabulation.

   Exclude `unresolved` rows from every aggregate, and say that you did.

2. **Blank is not zero.** `total_latency_s`, `primary_latency_s` and `min_nose_distance_cm` are the
   usual blanks. Count them, report them, and never let them enter a mean as zero. If the analyst
   wants censored latencies substituted with `trial_cutoff_s`, do it only when asked and say in the
   answer that you did.
3. **Say how much of an answer rests on human corrections.** `strategy_source`, the events' `source`
   column and `correction_count` all carry this. A group difference driven by corrected trials is a
   different claim from one driven by automatic output; both are legitimate, and the reader has to
   be told which.
4. **Two cohorts are comparable only if their `parameters_hash` values match — and matching is
   necessary, not sufficient.** State in _every_ comparison whether the hashes match. If they
   differ: diff the eleven threshold columns in `trials.csv` first, then `parameters.json` for the
   parameters that are hashed but are not columns, then `tool_version`. Report the differing
   parameters before reporting the difference in results — a change in
   `hole_investigation_radius_factor` moves every error count in the cohort.

   Matching hashes still are not a guarantee, but the gap is narrower than the columns suggest.
   The trial-censoring switch, the five strategy-rule numbers and the two quality-tier thresholds
   are fields of `Parameters` (D55): they are under the hash and in `parameters.json`, but they are
   **not** among the eleven threshold columns. So two exports that agree on all eleven columns can
   still differ in hash, and the difference is in `parameters.json` — check there before blaming
   the data. What the hash still cannot cover is a change in the code between two `tool_version`
   values, so when hashes match and results disagree, compare tool versions.

5. **`events.csv` is investigations and escape entries only.** Do not infer tracking failures from
   its absences; they are in `quality.csv` as gaps.
6. **Check `quality.csv` before believing `trials.csv`.** A `POOR` tier or a long `longest_gap_s`
   means the trial's path length and speed are built on an incomplete track. Lead with the caveat
   rather than appending it.
7. **`session_id` is the cohort's editable name, not a stable identifier.** Renaming a cohort
   changes it in every later export, and two unrelated cohorts can share one. Never merge two
   exports on `session_id` alone; use the file provenance the analyst gave you.

## Recipes

**Per-animal learning curve.** Group `trials.csv` by `animal`, order by `day` then `trial_label`,
and plot `primary_latency_s` (and `total_latency_s` where it exists). Report n per point and how
many were blank. Where latency is mostly blank, `total_errors` and `path_length_cm` carry the same
learning signal and should be offered instead of leaving the question unanswered.

**Group comparison.** Split by `group`. For each measure report n, mean, and a spread (SD or IQR —
say which), separately for `ok` trials and for all trials, so the reader can see whether the
`review` trials changed the picture. Name the measures that are unaffected by a blank latency.

**Strategy breakdown.** Cross-tabulate `strategy` by `group` (and by `day` for a learning story),
with counts not just percentages, and a `strategy_source` column so overridden calls are visible.
With small n, give counts alone and resist the percentage.

**Quality triage.** Sort `quality.csv` by `tier`, then `positioned_fraction` ascending — that is the
number the tier is cut from, and the one that says whether a position exists at all. For each video
needing attention, say _why_ in one line, from the numbers: a high `not_detected_fraction` means
the animal was not found; a high `ambiguous_fraction` means more than one candidate; a high
`low_confidence_fraction` means it was found but not cleanly resolved, which still yields
positions. Add `longest_gap_s` when a single long gap dominates.

**"Why do these two cohorts disagree?"** In this order, stopping at the first difference that
explains it: (1) `parameters_hash`; (2) the eleven threshold columns; (3) `parameters.json` for the
hashed parameters that are not columns; (4) `tool_version`; (5) `quality.csv` tiers and
`positioned_fraction`; (6) the `status` mix; (7) `correction_count` and `strategy_source`. Report the
first difference found and its expected direction of effect, rather than listing all seven.

## Worked example

Generated from this repository's synthetic fixture — `tests/fixtures/synthetic-analysis.ts`
through `src/export/` — so the shapes below are real output, not illustration. Regenerate with
`tsx` if the schema changes. **These are invented trajectories, not results from any recording** —
the `video_id`s echo the sample clips' filenames, but the tracks, events and metrics below are
synthetic, and two of these trials "escape" where no real clip does.

`trials.csv`, header and all three rows, with long columns elided as `…`:

```
session_id,video_id,animal,day,trial_label,group,target_hole,trial_start_s,primary_latency_s,total_latency_s,primary_errors,total_errors,path_length_cm,…
Barnes cohort A,video-test50,M12,1,1,control,7,2.4,95.923,,7,12,596.65,…
Barnes cohort A,video-test51,M12,4,1,control,7,1.2,19.24,45.1,1,2,110.99,…
Barnes cohort A,video-test53,M07,1,1,lesion,7,1,25.04,27.343,4,4,374.24,…
```

The tail of the same three rows, from `strategy` onwards:

```
strategy,strategy_source,escaped,status,tracked_fraction,correction_count,…,tool_version,schema_version,parameters_hash
serial,auto,false,review,0.9762,1,…,barnestrack v0.1.0 (5e11c0a),1,9c3cf1d9fcc3…
spatial,auto,true,ok,0.9069,1,…,barnestrack v0.1.0 (5e11c0a),1,9c3cf1d9fcc3…
random,auto,true,review,0.8652,1,…,barnestrack v0.1.0 (5e11c0a),1,9c3cf1d9fcc3…
```

`quality.csv`, all three rows:

```
session_id,video_id,tracked_fraction,not_detected_fraction,ambiguous_fraction,low_confidence_fraction,positioned_fraction,whole_clip_positioned_fraction,nose_judged_event_fraction,gap_count,longest_gap_s,…,tier,…
Barnes cohort A,video-test50,0.9762,0.0065,0.0036,0.0137,0.9899,0.9899,1,1,1.137,…,GOOD,…
Barnes cohort A,video-test51,0.9069,0.0729,0.0094,0.0108,0.9177,0.9177,0.8,2,3.403,…,GOOD,…
Barnes cohort A,video-test53,0.8652,0.1127,0.011,0.011,0.8762,0.8762,0.8333,2,1.767,…,REVIEW,…
```

Asked _"summarise this cohort"_, a correct answer looks like this:

> Three trials, one cohort, one parameter set — all three rows share
> `parameters_hash 9c3cf1d9fcc3…` and `barnestrack v0.1.0 (5e11c0a)`, so they are directly
> comparable.
>
> One trial is `ok` (test51: escaped at 45.1 s, 1 primary error, spatial). Two are `review`:
> test50 never escaped, so its `total_latency_s` is blank — it reached the target at 95.9 s after 7
> primary errors and 12 in total, classified serial; test53 escaped at 27.3 s with 4 errors,
> classified random, and is flagged because its video is `REVIEW` tier at 0.865 tracked with
> 11.3 % of trial frames carrying no detection.
>
> I have not averaged the latencies: one of three is blank, and with n = 3 across two groups
> (control: test50, test51 — both animal M12; lesion: test53) there is nothing to compare
> statistically. Each trial carries 1 correction, but every `strategy_source` is `auto`, so the
> strategy calls are the rule engine's own.
>
> Before building on this: test53's tier is `REVIEW`, so its path length of 374 cm rests on the
> least complete track of the three.

Note what that answer does: it checks the hash first, reports the status mix rather than hiding it,
refuses the mean it was implicitly asked for and says why, distinguishes corrected from automatic,
and leads with the quality caveat instead of burying it.
