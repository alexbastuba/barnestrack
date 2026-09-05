---
description: Finish a chunk — checks, reviewer, known limitations, report
argument-hint: <base-commit>
---

Finish the current chunk. `$ARGUMENTS` is the base commit the chunk started from.

1. **Checks.** Run `npm run lint && npm run typecheck && npm test && npm run build`. If anything is
   red, stop here and show the failing output; do not continue to the reviewer.
2. **Reviewer.** Launch the `reviewer` subagent with: the base commit `$ARGUMENTS`, the chunk's
   acceptance criteria copied verbatim from the chunk prompt, and the instruction to read
   `docs/decisions.md`, `docs/data-contracts.md` and `git diff $ARGUMENTS..HEAD`. Wait for its
   `VERDICT:` line.
3. **Fix.** If the verdict is REJECT, fix each blocking or should-fix finding in a new commit with a
   real message (never squash, never amend), re-run the checks, and re-run the reviewer once with
   the same inputs. Record both verdicts. If the second verdict is still REJECT, report the
   remaining findings honestly instead of looping.
4. **Known limitations.** Ask whether anything discovered during the chunk — a defect not fixed,
   scope deliberately excluded, or a finding about the sample data — belongs in
   `docs/known-limitations.md`, and add it there in the matching section (D39).
5. **Report.** Print the chunk report in this exact format (and write it to
   `notes/cc/chunk-NN-report.md` when the chunk prompt asks for it):

```
=== CHUNK NN REPORT ===
STATUS: DONE | DONE WITH CAVEATS | BLOCKED
BASE: <base sha>   HEAD: <sha now>
COMMITS: (git log --oneline BASE..HEAD)
ACCEPTANCE: one line per criterion → PASS / FAIL / NOT TESTED, with the evidence
CHECKS: tail of lint / typecheck / test / build output
DECISIONS MADE: calls decisions.md did not settle (or "none")
KNOWN LIMITATIONS: lines added to docs/known-limitations.md (or "none")
HOOKS/REVIEWER: what the hooks and the reviewer reported, and what changed in response
NOTICED, NOT DONE: out-of-scope items (max 5, one line each)
QUESTIONS: max 3, only if they change the next chunk
=== END REPORT ===
```

STATUS rules: DONE = every criterion PASS. DONE WITH CAVEATS = all PASS except items listed under
KNOWN LIMITATIONS with a reason. BLOCKED = a criterion cannot pass without a decision or resource
the session does not have; say which.
