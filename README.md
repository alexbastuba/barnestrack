# BarnesTrack

Turn a folder of Barnes maze videos into latencies, errors, path measures and search-strategy
calls that you can defend six months later — in a browser tab, with nothing to install.

**Live:** <https://barnestrack.pages.dev>
**Demo video:** <!-- DEMO_URL --> _placeholder — link added when the recording is made._
**Nothing to hand?** Press **Load example cohort** on the Videos step to open a worked cohort with
every result already computed. _(Placeholder: the button ships with the demo-state chunk.)_

## What it does, and who it is for

BarnesTrack is for the person who runs the maze: a student or postdoc with sixty videos, a
deadline, and no wish to become a software operator. It does not need a terminal, an install, an
account, a GPU or admin rights, because it is a static page that runs entirely in the browser
already on the laptop.

The work is four steps, and the page says the same thing at the top of each one:

1. **Videos** — "Load the videos of one cohort. Each file is read in this browser: BarnesTrack
   parses its frame table and fingerprints its contents so the session can find the same file again
   after a reload. Nothing is uploaded."
2. **Maze** — "Mark the platform, generate the hole ring, name the target hole and enter the
   platform diameter. The map belongs to the whole session, so hole 7 means the same hole in every
   video; a second video only needs to say where that maze sits in its own frame." A new maze costs
   five clicks on the image; reusing it on a video shot on the same rig costs none, and three when
   the camera moved. The panel shows the running count.
3. **Track** — "Run the automatic tracking pass over each video and watch it work. Tracking runs in
   the background, so you can keep working on the Videos and Maze steps while it does." A
   3-minute video takes a few seconds, and the page stays responsive while it happens.
4. **Review & Export** — "Read the events, latencies, errors, path measures and search strategy for
   each trial, check the quality report, and export tidy CSVs and an XLSX workbook." _(This step is
   mounted as a placeholder in the current build; it lands with the review chunk.)_

Three things shape everything else:

- **A missing frame stays missing.** Tracking failures are flagged, never quietly interpolated. If
  a documented cleaning step fills a gap, the filled points are drawn differently, counted, and
  labelled as filled.
- **Nothing is a bare (x, y).** Every position carries its named point, a confidence, a valid flag
  and where it came from — automatic, human-corrected, filled or imported.
- **A correction never edits a result.** It is stored beside the automatic layer, and everything
  downstream is recomputed. "Revert to automatic" is free, and re-running tracking cannot destroy
  an afternoon of human work.

Every threshold that decides a number is visible in the interface, adjustable, and written into
every export as its own column, alongside the tool version and a hash of the whole parameter set.
Two spreadsheets that disagree can always be reconciled.

## How to run it

### As a user

Open <https://barnestrack.pages.dev> and drop in your videos. There is no sign-in, no upload and no
setup.

Supported browsers: **Chrome or Edge 94 and later, Safari 16.4 and later, or Firefox 130 and
later**. The page checks at load and says so in plain language if the browser cannot decode video
frames; it does not fall back to a lower-fidelity path, because every measurement is tied to a
specific frame of the file (see D7 and D4 in [`docs/decisions.md`](docs/decisions.md)). An old
laptop is fine — Chrome decodes H.264 in software and the tracker runs on the CPU at over a
thousand frames per second. Input is MP4 with H.264 video; anything else is listed with the reason
and an `ffmpeg` line that converts it, never silently ignored.

### From a fresh clone

Node 24 or later (the version is in [`.nvmrc`](.nvmrc)). No environment variables, no API keys, no
services to provision.

```bash
npm ci          # dependencies are pinned to exact versions
npm run dev     # http://localhost:5173
npm test        # unit tests (vitest)
npm run lint
npm run typecheck
npm run build   # static site in dist/, deployable as-is
```

Two optional extras:

- `BARNESTRACK_SAMPLE_DIR=/path/to/data/barnes-maze npm test` includes the tests that read the
  sample videos. Without it those tests skip themselves and say so. No video is committed to this
  repository; the clips live in the sample-data repository.
- `npx playwright test` runs the browser checks against your installed Google Chrome. They are not
  part of CI; [`tests/browser/README.md`](tests/browser/README.md) says what each spec covers and
  records what was verified by hand instead.

CI runs lint, typecheck, tests and the build on every push
([`.github/workflows`](.github/workflows)).

One consequence worth stating plainly: the deployment configuration is not in this repository. The
site is built and served by Cloudflare Pages from the dashboard — build command `npm run build`,
output `dist`, no environment variables — so a fresh clone gives you the application but not the
hosting. The settings are written down in D43 of [`docs/decisions.md`](docs/decisions.md) so they
can be reproduced from the record rather than from memory.
