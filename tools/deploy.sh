#!/bin/bash
# Installs ai-squad skills (squads/<squad>/skills/), subagents
# (squads/<squad>/agents/), and hooks (squads/<squad>/hooks/) into ~/.claude/.
#
# Usage:
#   ./tools/deploy.sh             Deploy ALL squads under squads/
#   ./tools/deploy.sh sdd         Deploy only the named squad(s)
#   ./tools/deploy.sh sdd discovery
#
# Skills land flat under ~/.claude/skills/<skill>/, Subagents under
# ~/.claude/agents/<agent>.md, and hook scripts under ~/.claude/hooks/<name>.py.
# Claude Code does not have a per-squad namespace, so naming inside each squad
# must stay globally unique.
#
# Hook scripts are referenced from component frontmatter as
# `python3 $HOME/.claude/hooks/<name>.py` — global install, no per-project setup.
# Requirement: Python 3.8+ on PATH.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQUADS_ROOT="$REPO_ROOT/squads"
SKILLS_DST="$HOME/.claude/skills"
AGENTS_DST="$HOME/.claude/agents"
HOOKS_DST="$HOME/.claude/hooks"

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

# Verify Python 3 is available — hook scripts are pure-stdlib Python 3.
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found on PATH. ai-squad hooks require Python 3.8+." >&2
  echo "  Install via: brew install python3 (macOS) or your distro's package manager." >&2
  exit 1
fi

echo "ai-squad deploy"
echo "  squads:  ${SQUADS[*]}"
echo "  skills:  -> $SKILLS_DST  (cap: $SKILL_LINE_CAP lines)"
echo "  agents:  -> $AGENTS_DST  (cap: $AGENT_LINE_CAP lines)"
echo "  hooks:   -> $HOOKS_DST   (Python 3 stdlib; chmod +x preserved)"
echo ""

mkdir -p "$SKILLS_DST" "$AGENTS_DST" "$HOOKS_DST"

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

  if [ -d "$squad_root/hooks" ]; then
    for hook_file in "$squad_root/hooks"/*.py; do
      [ -f "$hook_file" ] || continue
      hook=$(basename "$hook_file")
      dst="$HOOKS_DST/$hook"
      if [ -f "$dst" ]; then echo "  [update hook]    $hook"
      else                   echo "  [install hook]   $hook"
      fi
      cp "$hook_file" "$dst"
      chmod +x "$dst"
    done
  fi
done

echo ""
echo "Done. ai-squad available in Claude Code."
