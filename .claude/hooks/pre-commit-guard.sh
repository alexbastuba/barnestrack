#!/usr/bin/env bash
# PreToolUse hook on Bash: blocks `git commit` when the staged changes
# contain video files, oversized blobs, .env*/notes/ paths, or key-shaped
# strings. Reads the hook JSON from stdin. See CLAUDE.md / docs/decisions.md D40.
set -euo pipefail

HOOK_INPUT="$(cat)"

COMMAND="$(node -e '
let d = "";
process.stdin.on("data", c => (d += c));
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(d);
    process.stdout.write(payload.tool_input && payload.tool_input.command ? payload.tool_input.command : "");
  } catch {
    process.stdout.write("");
  }
});
' <<<"$HOOK_INPUT")"

if [[ "$COMMAND" != *"git commit"* ]]; then
  exit 0
fi

STAGED_FILES="$(git diff --cached --name-only || true)"

if [[ -z "$STAGED_FILES" ]]; then
  exit 0
fi

fail() {
  echo "pre-commit-guard: $1" >&2
  exit 2
}

while IFS= read -r path; do
  [[ -z "$path" ]] && continue

  if [[ "$path" =~ \.(mp4|avi|mov|mkv|webm)$ ]]; then
    fail "staged path '$path' is a video file; sample data stays in the upstream take-home repo, never committed here."
  fi

  if [[ "$path" == .env* || "$path" == notes/* ]]; then
    fail "staged path '$path' matches an excluded prefix (.env*, notes/) and must not be committed."
  fi

  BLOB_SIZE="$(git cat-file -s ":$path" 2>/dev/null || echo 0)"
  if [[ "$BLOB_SIZE" -gt 2097152 ]]; then
    fail "staged path '$path' is $BLOB_SIZE bytes, over the 2 MB limit."
  fi
done <<<"$STAGED_FILES"

SECRET_PATTERN='AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----'

if git diff --cached | grep -E -q "$SECRET_PATTERN"; then
  fail "staged diff matches a key-shaped string (AWS/OpenAI/GitHub/Slack token or private-key header). Remove it before committing."
fi

exit 0
