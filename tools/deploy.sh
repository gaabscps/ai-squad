#!/bin/bash
# Installs ai-squad skills (squads/<squad>/skills/) and subagents
# (squads/<squad>/agents/) into ~/.claude/.
#
# Usage:
#   ./tools/deploy.sh             Deploy ALL squads under squads/
#   ./tools/deploy.sh sdd         Deploy only the named squad(s)
#   ./tools/deploy.sh sdd discovery
#
# Skills land flat under ~/.claude/skills/<skill>/ and Subagents under
# ~/.claude/agents/<agent>.md — Claude Code does not have a per-squad namespace,
# so naming inside each squad must stay globally unique.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQUADS_ROOT="$REPO_ROOT/squads"
SKILLS_DST="$HOME/.claude/skills"
AGENTS_DST="$HOME/.claude/agents"

# Length budget — Subagent body becomes the system prompt and is paid every
# dispatch, so the cap is tight. Skill body loads on demand, so the cap is looser
# (Claude Code's official cap is 500 lines).
SKILL_LINE_CAP=300
AGENT_LINE_CAP=150

check_length() {
  local file="$1" cap="$2" label="$3"
  local lines
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$cap" ]; then
    echo "  [WARN] $label: $lines lines (cap: $cap)"
  fi
}

# Resolve the list of squads to deploy.
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

echo "ai-squad deploy"
echo "  squads:  ${SQUADS[*]}"
echo "  skills:  -> $SKILLS_DST  (cap: $SKILL_LINE_CAP lines)"
echo "  agents:  -> $AGENTS_DST  (cap: $AGENT_LINE_CAP lines)"
echo ""

mkdir -p "$SKILLS_DST" "$AGENTS_DST"

for squad in "${SQUADS[@]}"; do
  echo "[squad: $squad]"
  squad_root="$SQUADS_ROOT/$squad"

  if [ -d "$squad_root/skills" ]; then
    for skill_dir in "$squad_root/skills"/*/; do
      [ -d "$skill_dir" ] || continue
      skill=$(basename "$skill_dir")
      dst="$SKILLS_DST/$skill"
      if [ -d "$dst" ]; then echo "  [update skill]   $skill"
      else                   echo "  [install skill]  $skill"; mkdir -p "$dst"
      fi
      check_length "$skill_dir/skill.md" "$SKILL_LINE_CAP" "$skill/skill.md"
      cp "$skill_dir/skill.md" "$dst/skill.md"
    done
  fi

  if [ -d "$squad_root/agents" ]; then
    for agent_file in "$squad_root/agents"/*.md; do
      [ -f "$agent_file" ] || continue
      agent=$(basename "$agent_file" .md)
      dst="$AGENTS_DST/$agent.md"
      if [ -f "$dst" ]; then echo "  [update agent]   $agent"
      else                   echo "  [install agent]  $agent"
      fi
      check_length "$agent_file" "$AGENT_LINE_CAP" "$agent.md"
      cp "$agent_file" "$dst"
    done
  fi
done

echo ""
echo "Done. ai-squad available in Claude Code."
