#!/bin/bash
# Validates that every squad skill.md and agent .md can be exported for Cursor.
# Does not install to ~/.cursor/.

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPORT_PY="$REPO_ROOT/tools/cursor_export_skill.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

count=0
while IFS= read -r -d '' f; do
  rel=${f#"$REPO_ROOT/"}
  safe=$(echo "$rel" | tr '/' '_')
  python3 "$EXPORT_PY" "$f" "$TMP/${safe}.SKILL.md"
  count=$((count + 1))
done < <(find "$REPO_ROOT/squads" \( -path '*/skills/*/skill.md' -o -path '*/agents/*.md' \) -print0)

echo "smoke-cursor-export: OK ($count files)"
exit 0
