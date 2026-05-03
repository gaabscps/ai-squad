#!/bin/bash
# Installs ai-squad skills to ~/.claude/skills/

SKILLS_SRC="$(cd "$(dirname "$0")/.." && pwd)/skills"
SKILLS_DST="$HOME/.claude/skills"

echo "ai-squad deploy"
echo "  from: $SKILLS_SRC"
echo "  to:   $SKILLS_DST"
echo ""

for role_dir in "$SKILLS_SRC"/*/; do
  role=$(basename "$role_dir")
  dst="$SKILLS_DST/$role"

  if [ -d "$dst" ]; then
    echo "  [update] $role"
  else
    echo "  [install] $role"
    mkdir -p "$dst"
  fi

  cp "$role_dir/skill.md" "$dst/skill.md"
  [ -f "$role_dir/agent.yml" ] && cp "$role_dir/agent.yml" "$dst/agent.yml"
done

echo ""
echo "Done. Skills available in Claude Code."
