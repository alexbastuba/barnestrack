#!/usr/bin/env bash
# PostToolUse hook on Edit|Write|MultiEdit|Bash: typechecks and lints the .ts
# files a tool just wrote. Reads the hook JSON from stdin. See CLAUDE.md.
#
# The Bash branch exists because a shell heredoc (`cat > src/foo.ts <<'EOF'`)
# writes a source file without ever going through Edit or Write, and so used to
# slip past this check entirely. Files should still be edited with Edit/Write;
# this is the backstop, not the route.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

HOOK_INPUT="$(cat)"

# One path per line: `file_path` for Edit/Write/MultiEdit, or every .ts path
# under src/ or tests/ that a Bash command redirects or pipes output into.
FILES="$(node -e '
let d = "";
process.stdin.on("data", c => (d += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(d);
  } catch {
    process.stdout.write("");
    return;
  }
  const input = payload.tool_input || {};
  if (typeof input.file_path === "string" && input.file_path) {
    process.stdout.write(input.file_path);
    return;
  }
  const command = typeof input.command === "string" ? input.command : "";
  if (!command) {
    process.stdout.write("");
    return;
  }
  // `> path`, `>> path`, `tee path`, `tee -a path`. Quotes optional.
  const pattern = /(?:>>?|\btee\b(?:\s+-[a-zA-Z]+)*)\s*["\x27]?((?:\.\/)?(?:src|tests)\/[A-Za-z0-9_.\/-]+\.ts)["\x27]?/g;
  const found = new Set();
  let match;
  while ((match = pattern.exec(command)) !== null) found.add(match[1]);
  process.stdout.write([...found].join("\n"));
});
' <<<"$HOOK_INPUT")"

# Nothing a .ts file was written to: say nothing and cost nothing. Without this
# the whole-project tsc would run on every single Bash call.
if [[ -z "$FILES" ]]; then
  exit 0
fi

TSC_BIN="./node_modules/.bin/tsc"
ESLINT_BIN="./node_modules/.bin/eslint"

TARGETS=()
while IFS= read -r path; do
  [[ "$path" == *.ts ]] || continue
  [[ -f "$path" ]] || continue
  TARGETS+=("$path")
done <<<"$FILES"

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  exit 0
fi

TSC_OUTPUT="$("$TSC_BIN" --noEmit -p tsconfig.json 2>&1)" && TSC_STATUS=0 || TSC_STATUS=$?
ESLINT_OUTPUT="$("$ESLINT_BIN" "${TARGETS[@]}" 2>&1)" && ESLINT_STATUS=0 || ESLINT_STATUS=$?

if [[ "$TSC_STATUS" -ne 0 || "$ESLINT_STATUS" -ne 0 ]]; then
  echo "post-edit-check: ${TARGETS[*]} failed checks" >&2
  [[ "$TSC_STATUS" -ne 0 ]] && printf -- '--- tsc ---\n%s\n' "$TSC_OUTPUT" >&2
  [[ "$ESLINT_STATUS" -ne 0 ]] && printf -- '--- eslint ---\n%s\n' "$ESLINT_OUTPUT" >&2
  exit 2
fi

exit 0
