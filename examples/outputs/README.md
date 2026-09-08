# Example outputs

These four files are the export BarnesTrack wrote during the recorded demo, at
commit `bc81fe7`, from the three sample videos (`test50.mp4`, `test51.mp4`,
`test53.mp4`). They are the app's own output, copied here unmodified — nothing
was reformatted, re-ordered or hand-edited.

| File | What it is |
| --- | --- |
| `trials.csv` | One row per video: latencies, errors, path measures, strategy, status, and every parameter that produced them. |
| `events.csv` | One row per detected event (hole investigation, escape entry, tracking failure) with the evidence sentence the UI shows. |
| `quality.csv` | One row per video: tracked/positioned fractions, gaps, timestamp anomalies, drift, scale, and the quality tier. |
| `parameters.json` | The full parameter set the run used, the thing `parameters_hash` hashes. |

Every row carries `tool_version` (`barnestrack v0.1.0 (bc81fe7)`),
`schema_version` and `parameters_hash`; the hash is identical across all three
files, so the numbers and the parameters that made them cannot drift apart.

The export also writes `barnestrack_export.xlsx` (the same three tables as
sheets) and a copy of the session file. Neither is committed: the XLSX adds
nothing the CSVs do not have, and the session file is 11 MB, well over the 2 MB
limit the pre-commit guard enforces. The bundled example cohort in
`public/examples/` is built from that same session file by
`scripts/build-example-bundle.ts`, gzipped, so the app can load this run without
the videos.

## Reproducing them

Open the app, add the three sample videos (or press **Load example cohort**,
which loads this same run's tracking without needing the videos), and press
**Export**. The parameters are the shipped defaults, so the numbers come out the
same.
