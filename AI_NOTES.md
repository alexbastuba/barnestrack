# AI_NOTES

## Tools and configuration

BarnesTrack was built with Claude Code, vanilla — no third-party extensions. `CLAUDE.md` is the
working agreement: hard constraints, per-session ownership boundaries, conventions. Every session
ran in plan mode, so the builder's questions arrived before any code existed.

A reviewer subagent (`.claude/agents/reviewer.md`) ran in fresh context and tried to break each
chunk before approving it. `/finish-chunk` runs lint, typecheck, tests and build, invokes the
reviewer, fixes blocking findings in new commits and re-runs the reviewer once — two passes per
chunk. Two hooks guard the rest: staged videos, oversized files and key-shaped strings are refused,
and every edited `.ts` is typechecked and linted. Each was created at the point of first need
(`git log -- .claude/`).

One chat per chunk acted as arbiter: it answered the builder's plan-gate questions, then reviewed
the diff and returned PASS, FIX or ESCALATE. A master thread ruled on decisions and directed
merges. Models: Fable for chunks 1, 2, 5, 6 and the read-only trust audit, Opus for the other
chunks, Sonnet for chunk 0; the reviewer ran on a different model from the builder where possible.
Decisions live in `docs/decisions.md`; an untracked log records every correction.

## Where it helped

The chunk-1 prompt specified the wrong tie-break for duplicate presentation timestamps. A
per-output monotone assertion, written to catch a duplicate-timestamp collapse, fired at test50
frame 174. Diagnosis with `ffmpeg -bsf:v trace_headers` led to a slice-header parser and a
tie-break by picture order count (`d05ce36`, D45 in `07d0a9c`), with the failing rule kept in the
prototype so it stays reproducible.

I leaned toward SAM 3 plus a pose estimator. The model argued classical CV: CPU inference at
0.2–3 s per frame cannot process 7,185 frames while a user watches, and a mask still leaves the
nose to be inferred from shape. It marked its own inference figures as estimates, not measurements.
Settled as D6.

The trust audit found A1 before the export was wired to the UI: export rows read the persisted
`derived` cache while only the selected video was re-derived, so one `trials.csv` could carry two
`parameters_hash` values. Fixed in `a107d15` — the store drops every derived layer when parameters,
map or a transform change, and the export re-derives the cohort and refuses a mismatched row —
before `35c211c` mounted the export. Ruled D56.

## Where it was wrong

A compressed conflict-resolution one-liner emptied two files. `open(p,'w')` truncates before the
argument `open(p).read()` runs, so `docs/known-limitations.md` and `tests/browser/README.md` were
committed empty at `e23d382`. Typecheck and tests cannot see a prose file go blank, so the gate
passed it. The next chunk's arbiter caught it at its plan gate from `git show e23d382 --stat`;
restored in `bb463e7`.

Pushing a red `main` was a call I took on the model's recommendation — push through the expected
D52 breakage after merging chunks 5 and 8. `e7ad7fe` carried 26 typecheck errors behind two green
branch CI runs, and because the post-edit hook runs a whole-project `tsc`, it blocked every source
write in all four sessions branched from it. Chunk 7a's builder found it at plan time and asked
instead of working around it (`baa91ed`, cherry-picked as `1242028`). The merge gate is mandatory
since; on Sep 7 it caught three more semantic conflicts no textual conflict pointed at (chunk 7a
against a moved `main`; `07c6a98`; `3f1dfc1`).

A user's "animal in the escape box from here" range short-circuits the hole test in chunk 5's event
code. Pressed 59 cm from any hole on test51 it returns an escape entry, `escaped = yes`,
`status = ok` and a 23.36 s latency, beside a card printing "Min nose distance: 59.07 cm". No test
caught it. Chunk 7b found it by running the acceptance scenario by hand and recorded both measured
outcomes rather than implementing a definition it had not been given (`85f8b38`). Ruled D57.

## How the work was verified

Chunk reports were not taken on trust. Each arbiter read the whole diff and re-derived numbers
outside the builder's test runner: chunk 1's MP4 parser re-run in plain Node against the committed
ffprobe fixtures, chunk 5's analysis engine re-run to reproduce every number in its `RESULTS.md`.
The reviewer's second pass earned its place — in chunks 3, 5, 7a and 9b its blocking findings were
regressions introduced by the first pass's own fixes. CI runs `npm ci`, lint, typecheck, test and
build on a clean install, beside a `browser-smoke` job not marked `continue-on-error`. The trust
audit shipped 13 runnable reproductions, one per finding.
