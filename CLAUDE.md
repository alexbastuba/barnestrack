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

- `src/contracts/` TypeScript types for the track, session, maze map and export-row data contracts (D7–D12)
- `src/video/` MP4 demuxing, decoding, sample-table frame identity
- `src/analysis/` pure metric/event/cleaning functions, no DOM or video dependency
- `src/session/` session file read/write, IndexedDB autosave, correction application
- `src/ui/` DOM + canvas UI: timeline, frame viewer, correction tools, exports
- `prototypes/` throwaway spikes, not part of the shipped build
- `scripts/` one-off maintenance/build scripts
- `tests/` unit tests for everything in `src/analysis/`, `src/contracts/` and file I/O
- `docs/` data-contracts.md, decisions.md, known-limitations.md
- `.claude/` agents and commands used to build this project (committed deliberately)
- `AI_NOTES.md` written at the end; do not generate or pad it speculatively

## Workflow

- A `/finish-chunk` command (added in chunk 1) runs the test suite, invokes the reviewer subagent
  against the diff, and prompts for a known-limitations update before a chunk is reported done.
- Every chunk ends with the test suite green and `docs/known-limitations.md` reviewed for anything
  discovered during that chunk (D39, D40).
