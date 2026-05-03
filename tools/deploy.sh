#!/bin/bash
# Installs ai-squad skills (skills/) and subagents (agents/) into ~/.claude/

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/skills"
AGENTS_SRC="$REPO_ROOT/agents"
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

echo "ai-squad deploy"
echo "  skills:  $SKILLS_SRC -> $SKILLS_DST  (cap: $SKILL_LINE_CAP lines)"
echo "  agents:  $AGENTS_SRC -> $AGENTS_DST  (cap: $AGENT_LINE_CAP lines)"
echo ""

mkdir -p "$SKILLS_DST" "$AGENTS_DST"

for skill_dir in "$SKILLS_SRC"/*/; do
  [ -d "$skill_dir" ] || continue
  skill=$(basename "$skill_dir")
  dst="$SKILLS_DST/$skill"
  if [ -d "$dst" ]; then echo "  [update skill]   $skill"
  else                   echo "  [install skill]  $skill"; mkdir -p "$dst"
  fi
  check_length "$skill_dir/skill.md" "$SKILL_LINE_CAP" "$skill/skill.md"
  cp "$skill_dir/skill.md" "$dst/skill.md"
done

for agent_file in "$AGENTS_SRC"/*.md; do
  [ -f "$agent_file" ] || continue
  agent=$(basename "$agent_file" .md)
  dst="$AGENTS_DST/$agent.md"
  if [ -f "$dst" ]; then echo "  [update agent]   $agent"
  else                   echo "  [install agent]  $agent"
  fi
  check_length "$agent_file" "$AGENT_LINE_CAP" "$agent.md"
  cp "$agent_file" "$dst"
done

echo ""
echo "Done. ai-squad available in Claude Code."
