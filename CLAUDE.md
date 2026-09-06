# CLAUDE.md

BarnesTrack — browser-based Barnes maze video tracking and analysis. Salk AIRC RSE take-home, Task 1.

## What this is

BarnesTrack turns a folder of Barnes maze videos into defensible, auditable behavioral metrics (latencies, errors, path measures, search-strategy classification) for neuroscientists who do not use a terminal. See README.md for product scope and design decisions; see docs/data-contracts.md for the file formats and internal representations.

## Hard constraints — never violate

- End users never touch a terminal, install software, or need a GPU. Old hardware, no admin rights.
- Tracking failures are **flagged, never silently interpolated**. A missing frame stays visibly missing unless a documented, parameterized cleaning step fills it — and then it is marked as filled.
- Every position estimate carries: named point(s), confidence, valid flag, and source (`auto` / `corrected` / `imported`). Never store a bare (x, y).
- Automatic vs human-corrected values are visually distinct in the UI, and corrections propagate by recomputation, not by patching outputs.
- Metric definitions are visible in the UI; thresholds adjustable. No magic numbers buried in code — parameters live in one configuration module and are embedded in every export along with the tool name and version (`barnestrack vX.Y.Z`).
- Metrics and event detection are pure functions over the internal representation, unit-tested, with no DOM or video dependencies.
- Data contracts (track representation, session JSON schema, CSV schema) are versioned. Do not change them without explicit sign-off from Alex; bump the schema version when they change.

## Engineering conventions

- Small, incremental commits with descriptive messages. Never squash. Commit generated sample outputs only where the task requires it (summary, event detail, quality report for the three sample videos).
- Never commit videos, large binaries, secrets, or scratch files. Sample data stays in the upstream take-home repo.
- Pin all dependencies exactly.
- Tests accompany any change to metrics, event detection, cleaning, or file I/O. Run the test suite before declaring any task done; show failing output honestly if it fails.
- Accessibility is a requirement, not polish: keyboard operability, no meaning in color alone, usable at 200% zoom, labeled controls. Check it when building UI, not after.
- When a defect or limitation is discovered and not fixed, add it to the Known Limitations draft in the same session.

## Working with Alex

- Alex has deep behavioral-neuroscience and animal-tracking experience; defer to him on operational definitions (hole investigation, primary latency/errors, search strategies) and flag anything in the spec that seems behaviorally wrong rather than silently implementing it.
- Prefer proposing 2–3 options with tradeoffs for design decisions rather than picking silently. Once Alex decides, record it in docs/decisions.md and don't relitigate.
- If Alex rejects or corrects a proposal, that's normal and useful — do not argue past one clear restatement of the tradeoff.

## Repo layout (keep current as it evolves)

- `src/contracts/` TypeScript types for the track, session, maze map and export-row data contracts (D7–D12, D47)
- `src/video/` MP4 demuxing, decoding, sample-table frame identity
- `src/analysis/` pure metric/event/cleaning functions, no DOM or video dependency
- `src/maze/` pure maze geometry — circle fit, parametric hole ring, similarity fit for map
  reuse, and the zoom/pan view transform. No DOM, no video (D10, D13, D15)
- `src/session/` session file read/write, IndexedDB autosave, video intake, correction application
- `src/ui/` DOM + canvas UI: app shell and stepper, videos step, maze step, two-layer canvas,
  scrubber; later the timeline, correction tools and exports
- `src/styles/` the one stylesheet; system fonts only, no external asset (D2)
- `prototypes/` dev-only evidence pages served by `npm run dev`, not part of the shipped build
  (`prototypes/frame-server/` records the chunk-1 frame-server measurements in its `RESULTS.md`)
- `scripts/` one-off maintenance/build scripts
- `tests/` unit tests for everything in `src/analysis/`, `src/contracts/`, `src/maze/`,
  `src/session/` and `src/video/` parsing and file I/O; `tests/fixtures/` holds the ffprobe
  per-frame timestamps of the sample videos; `tests/browser/` holds the Playwright specs.
  `tests/ui/` holds unit tests for the DOM-free parts of `src/ui/` only (string formatting and
  the like); the rest of `src/ui/` is DOM- and canvas-bound and the project has no DOM test
  environment, so it is covered by typecheck, by `tests/browser/` and by a recorded manual pass
- `docs/` data-contracts.md, decisions.md, known-limitations.md
- `.claude/` agents and commands used to build this project (committed deliberately)
- `AI_NOTES.md` written at the end; do not generate or pad it speculatively

## Workflow

- `.claude/agents/reviewer.md` is a fresh-context reviewer subagent that reads
  `docs/decisions.md`, `docs/data-contracts.md`, the chunk's acceptance criteria and
  `git diff <base>..HEAD`, and tries to break the chunk before approving (`VERDICT: APPROVE | REJECT`
  plus findings with evidence and the smallest fix).
- `.claude/commands/finish-chunk.md` (`/finish-chunk <base-commit>`) runs
  `npm run lint && npm run typecheck && npm test && npm run build`, invokes the reviewer, fixes
  REJECT findings in new commits and re-runs the reviewer once, prompts for a
  `docs/known-limitations.md` update, and prints the chunk report.
- `.claude/hooks/pre-commit-guard.sh` blocks commits that stage videos, files over 2 MB,
  `notes/` or `.env*` paths, or key-shaped strings; `.claude/hooks/post-edit-check.sh` typechecks
  and lints every edited `.ts` file.
- Every chunk ends with the test suite green and `docs/known-limitations.md` reviewed for anything
  discovered during that chunk (D39, D40).
- Browser-only behaviour (WebCodecs, drag-and-drop, reload) is checked with `npx playwright test`
  against the installed Google Chrome (`playwright.config.ts`, `tests/browser/`); it is not part of
  CI yet. Set `BARNESTRACK_SAMPLE_DIR` to the upstream `data/barnes-maze/` folder to include the
  sample videos in both Vitest and Playwright runs. `tests/browser/README.md` says what each spec
  covers and records the checks that were made by hand instead (D36).
