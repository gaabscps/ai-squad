#!/bin/bash
# Validates that every agent .md converts to valid JSON and every skill.md
# exports cleanly for Kiro. Does not install to ~/.kiro/.

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONVERT_PY="$REPO_ROOT/tools/kiro_convert_agent.py"
EXPORT_PY="$REPO_ROOT/tools/cursor_export_skill.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

agents=0
skills=0
errors=0

# Agents → JSON
while IFS= read -r -d '' f; do
  rel=${f#"$REPO_ROOT/"}
  out="$TMP/$(echo "$rel" | tr '/' '_').json"
  if python3 "$CONVERT_PY" "$f" "$out" 2>&1; then
    # Validate JSON is parseable
    if ! python3 -c "import json,sys; json.load(open('$out'))" 2>/dev/null; then
      echo "FAIL (invalid JSON): $rel" >&2
      errors=$((errors + 1))
    else
      agents=$((agents + 1))
    fi
  else
    echo "FAIL (convert error): $rel" >&2
    errors=$((errors + 1))
  fi
done < <(find "$REPO_ROOT/squads" -path '*/agents/*.md' -print0)

# Skills → SKILL.md
while IFS= read -r -d '' f; do
  rel=${f#"$REPO_ROOT/"}
  out="$TMP/$(echo "$rel" | tr '/' '_').SKILL.md"
  if ! python3 "$EXPORT_PY" "$f" "$out" 2>/dev/null; then
    echo "FAIL (export error): $rel" >&2
    errors=$((errors + 1))
  else
    skills=$((skills + 1))
  fi
done < <(find "$REPO_ROOT/squads" -path '*/skills/*/skill.md' -print0)

if [ "$errors" -gt 0 ]; then
  echo "smoke-kiro-export: FAIL ($errors error(s))" >&2
  exit 1
fi

echo "smoke-kiro-export: OK ($agents agents, $skills skills)"
exit 0
