#!/usr/bin/env bash
# PostToolUse hook on Edit|Write|MultiEdit: typechecks and lints a .ts file
# right after it's edited. Reads the hook JSON from stdin. See CLAUDE.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

HOOK_INPUT="$(cat)"

FILE_PATH="$(node -e '
let d = "";
process.stdin.on("data", c => (d += c));
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(d);
    process.stdout.write(payload.tool_input && payload.tool_input.file_path ? payload.tool_input.file_path : "");
  } catch {
    process.stdout.write("");
  }
});
' <<<"$HOOK_INPUT")"

if [[ "$FILE_PATH" != *.ts ]]; then
  exit 0
fi

TSC_BIN="./node_modules/.bin/tsc"
ESLINT_BIN="./node_modules/.bin/eslint"

TSC_OUTPUT="$("$TSC_BIN" --noEmit -p tsconfig.json 2>&1)" && TSC_STATUS=0 || TSC_STATUS=$?
ESLINT_OUTPUT="$("$ESLINT_BIN" "$FILE_PATH" 2>&1)" && ESLINT_STATUS=0 || ESLINT_STATUS=$?

if [[ "$TSC_STATUS" -ne 0 || "$ESLINT_STATUS" -ne 0 ]]; then
  echo "post-edit-check: $FILE_PATH failed checks" >&2
  [[ "$TSC_STATUS" -ne 0 ]] && printf -- '--- tsc ---\n%s\n' "$TSC_OUTPUT" >&2
  [[ "$ESLINT_STATUS" -ne 0 ]] && printf -- '--- eslint ---\n%s\n' "$ESLINT_OUTPUT" >&2
  exit 2
fi

exit 0
