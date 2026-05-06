#!/bin/bash
# Installs ai-squad as Cursor Agent Skills under ~/.cursor/skills/<role>/,
# syncs enforcement hooks to ~/.cursor/hooks/ai-squad/, and merges hook entries
# into ~/.cursor/hooks.json (same Python scripts as Claude — no duplicated logic).
#
# Does not modify ~/.claude/ — Claude Code flow stays unchanged.
#
# Usage:
#   ./tools/deploy-cursor.sh              all squads under squads/
#   ./tools/deploy-cursor.sh sdd          only listed squads
#   ./tools/deploy-cursor.sh discovery
#
# Env:
#   SKIP_CURSOR_HOOK_MERGE=1  — do not merge ~/.cursor/hooks.json
#
# Requirements: Python 3.8+ (same as hook scripts).

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQUADS_ROOT="$REPO_ROOT/squads"
SKILLS_DST="${CURSOR_SKILLS_DST:-$HOME/.cursor/skills}"
HOOKS_DST="${CURSOR_HOOKS_DST:-$HOME/.cursor/hooks/ai-squad}"
EXPORT_PY="$REPO_ROOT/tools/cursor_export_skill.py"
MERGE_HOOKS_PY="$REPO_ROOT/tools/merge_ai_squad_cursor_hooks.py"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found on PATH." >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  SQUADS=("$@")
  for squad in "${SQUADS[@]}"; do
    if [ ! -d "$SQUADS_ROOT/$squad" ]; then
      echo "ERROR: unknown squad '$squad' (not found at $SQUADS_ROOT/$squad)" >&2
      exit 1
    fi
  done
else
  SQUADS=()
  for squad_dir in "$SQUADS_ROOT"/*/; do
    [ -d "$squad_dir" ] || continue
    SQUADS+=("$(basename "$squad_dir")")
  done
fi

echo "ai-squad Cursor deploy"
echo "  squads: ${SQUADS[*]}"
echo "  skills: -> $SKILLS_DST"
echo "  hooks:  -> $HOOKS_DST (scripts; + merge into ~/.cursor/hooks.json unless SKIP_CURSOR_HOOK_MERGE=1)"
echo ""

mkdir -p "$SKILLS_DST" "$HOOKS_DST"

for squad in "${SQUADS[@]}"; do
  echo "[squad: $squad]"
  squad_root="$SQUADS_ROOT/$squad"

  if [ -d "$squad_root/skills" ]; then
    for skill_dir in "$squad_root/skills"/*/; do
      [ -d "$skill_dir" ] || continue
      skill=$(basename "$skill_dir")
      src="$skill_dir/skill.md"
      [ -f "$src" ] || continue
      dst="$SKILLS_DST/$skill/SKILL.md"
      echo "  [skill] $skill -> $dst"
      python3 "$EXPORT_PY" "$src" "$dst"
    done
  fi

  if [ -d "$squad_root/agents" ]; then
    for agent_file in "$squad_root/agents"/*.md; do
      [ -f "$agent_file" ] || continue
      agent=$(basename "$agent_file" .md)
      dst="$SKILLS_DST/$agent/SKILL.md"
      echo "  [agent] $agent -> $dst"
      python3 "$EXPORT_PY" "$agent_file" "$dst"
    done
  fi
done

# SDD enforcement hooks — always sync (even for `deploy-cursor.sh discovery-only`).
if [ -d "$SQUADS_ROOT/sdd/hooks" ]; then
  echo "[hooks] squads/sdd/hooks -> $HOOKS_DST"
  for hook_file in "$SQUADS_ROOT/sdd/hooks"/*.py; do
    [ -f "$hook_file" ] || continue
    hook=$(basename "$hook_file")
    cp "$hook_file" "$HOOKS_DST/$hook"
    chmod +x "$HOOKS_DST/$hook"
    echo "  [hook]  $hook (sync)"
  done
fi

if [ -z "${SKIP_CURSOR_HOOK_MERGE:-}" ]; then
  echo ""
  echo "[hooks] merging ai-squad entries into ~/.cursor/hooks.json"
  python3 "$MERGE_HOOKS_PY"
else
  echo ""
  echo "[hooks] SKIP_CURSOR_HOOK_MERGE set — merge skipped (run: python3 $MERGE_HOOKS_PY)"
fi

echo ""
echo "Done. Open Cursor → Skills and load the ai-squad skill you need (e.g. spec-writer, discovery-lead)."
