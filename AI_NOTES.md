# AI_NOTES

## Tools and configuration

BarnesTrack was built with Claude Code, vanilla — no third-party extensions and no MCP servers; the
agent interface shipped as a Claude skill (`skills/barnestrack-cohort/`, D42). `CLAUDE.md` is the
working agreement: hard constraints, ownership boundaries, conventions. Every session ran in plan
mode, so the builder's questions arrived before any code existed.

A reviewer subagent (`.claude/agents/reviewer.md`) ran in fresh context and tried to break each
chunk before approving it. `/finish-chunk` runs lint, typecheck, tests and build, invokes the
reviewer, fixes blocking findings in new commits and re-runs it once — two passes per chunk. Two
hooks refuse staged videos, oversized files and key-shaped strings, and typecheck and lint every
edited `.ts`. Each was created at the point of first need (`git log -- .claude/`).

One chat per chunk acted as arbiter: it answered the builder's plan-gate questions, then reviewed
the diff and returned PASS, FIX or ESCALATE. A master thread ruled on decisions and directed
merges. Independent chunks ran in parallel in git worktrees, each prompt naming the files it
owned; every merge passed `npm ci`, typecheck and tests before push, which on Sep 7 caught three
conflicts that had no textual conflict (`ab0b8db`, `07c6a98`, `3f1dfc1`). Models: Fable for chunks 1, 2, 5, 6 and the read-only trust audit, Opus for the other
chunks, Sonnet for chunk 0; the reviewer ran on a different model from the builder where possible.
Decisions live in `docs/decisions.md`; an untracked log records every correction.

## Where it helped

The chunk-1 prompt specified the wrong tie-break for duplicate presentation timestamps. A monotone
assertion on the decoder's output, written for exactly that collapse, fired at test50 frame 174.
Diagnosis with `ffmpeg -bsf:v trace_headers` led to a slice-header parser and a tie-break by
picture order count (`d05ce36`, D45 in `07d0a9c`); the failing rule stayed in the prototype,
reproducible.

I leaned toward SAM 3 plus a pose estimator. The model argued classical CV: CPU inference at
0.2–3 s per frame cannot process 7,185 frames while a user watches, and a mask still leaves the
nose to be inferred from shape. It flagged its own inference figures as estimates, not
measurements. Settled as D6.

## Where it was wrong

Every operational default carried a `Closes on:` line naming Gawel et al. 2019 or Illouz et al.
2020, and the numbers under them came from neither. The strategy rules were the tell: serial wanted
a run of at least 3 adjacent holes, spatial allowed up to 3 errors within ±2 holes of the target
(`cc0b86e`), and neither is in Gawel's Table 1 — a lab citing the paper would get a different call
from the tool than from the definition it cites. I read both papers and ruled the defaults myself.
Strategy is now Table 1's (D58), path efficiency is Illouz's rather than the tool's own (D61), and
gap filling — which put positions the tracker never saw into path length and speed — is off (D60).
No data is better than invented data.

A compressed conflict-resolution one-liner emptied two files: `open(p,'w')` truncates before the
argument `open(p).read()` runs, so `docs/known-limitations.md` and `tests/browser/README.md` were
committed empty at `e23d382`. Typecheck and tests cannot see a prose file go blank, so the gate
passed it. The next chunk's arbiter caught it from `git show e23d382 --stat` at its plan gate;
restored in `bb463e7`.

A user's "animal in the escape box from here" range short-circuited the hole test in chunk 5's
event code. Pressed 59 cm from any hole on test51 it returned an escape entry, `escaped = yes` and
a 23.36 s latency, beside a card printing "Min nose distance: 59.07 cm". No test caught it; chunk
7b found it by running the acceptance scenario by hand and recorded both outcomes rather than
inventing a definition (`85f8b38`). Ruled D57, implemented in `2b86ed7`.

## How the work was verified

Chunk reports were not taken on trust. Each arbiter read the whole diff and re-derived numbers
outside the builder's test runner: chunk 1's MP4 parser in plain Node against the committed ffprobe
fixtures, chunk 5's analysis engine to reproduce every number in its `RESULTS.md`. The reviewer's
second pass earned its place — in chunks 3, 5, 7a and 9b its blocking findings were regressions
introduced by the first pass's fixes. CI runs `npm ci`, lint, typecheck, test and build on a clean
install, beside a `browser-smoke` job not marked `continue-on-error`. The trust audit shipped 13
runnable reproductions, one per finding.
