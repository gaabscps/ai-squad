#!/bin/bash
# Installs ai-squad skills (skills/) and subagents (agents/) into ~/.claude/

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/skills"
AGENTS_SRC="$REPO_ROOT/agents"
SKILLS_DST="$HOME/.claude/skills"
AGENTS_DST="$HOME/.claude/agents"

echo "ai-squad deploy"
echo "  skills:  $SKILLS_SRC -> $SKILLS_DST"
echo "  agents:  $AGENTS_SRC -> $AGENTS_DST"
echo ""

mkdir -p "$SKILLS_DST" "$AGENTS_DST"

for skill_dir in "$SKILLS_SRC"/*/; do
  [ -d "$skill_dir" ] || continue
  skill=$(basename "$skill_dir")
  dst="$SKILLS_DST/$skill"
  if [ -d "$dst" ]; then echo "  [update skill]   $skill"
  else                   echo "  [install skill]  $skill"; mkdir -p "$dst"
  fi
  cp "$skill_dir/skill.md" "$dst/skill.md"
done

for agent_file in "$AGENTS_SRC"/*.md; do
  [ -f "$agent_file" ] || continue
  agent=$(basename "$agent_file" .md)
  dst="$AGENTS_DST/$agent.md"
  if [ -f "$dst" ]; then echo "  [update agent]   $agent"
  else                   echo "  [install agent]  $agent"
  fi
  cp "$agent_file" "$dst"
done

echo ""
echo "Done. ai-squad available in Claude Code."
