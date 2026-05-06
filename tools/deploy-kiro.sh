#!/bin/bash
# Installs ai-squad for Kiro CLI.
#
# Mapping rationale:
#   Kiro has three primitives — Skills (context resources), Custom Agents
#   (invokable + per-agent hooks), and Hooks (agent-scoped scripts). ai-squad
#   entry-points (spec-writer, orchestrator, etc.) need invocation + hooks, so
#   they map to Kiro Custom Agents, NOT to Kiro Skills (which can't carry hooks
#   and are loaded as resources by an agent). Subagents likewise become Custom
#   Agents (Kiro dispatches them via the `delegate` tool).
#
#   squads/<squad>/skills/*/skill.md  → ~/.kiro/agents/<name>.json
#   squads/<squad>/agents/*.md        → ~/.kiro/agents/<name>.json
#   squads/<squad>/hooks/*.py         → ~/.kiro/hooks/<name>.py
#
# Does not modify ~/.claude/, ~/.cursor/, or ~/.kiro/skills/ — those flows
# stay unchanged. (Kiro's native Skills primitive is left alone for the user
# to use independently.)
#
# Usage:
#   ./tools/deploy-kiro.sh             all squads under squads/
#   ./tools/deploy-kiro.sh sdd         only listed squads
#   ./tools/deploy-kiro.sh sdd discovery
#
# Env:
#   KIRO_AGENTS_DST   override agents install path (default: ~/.kiro/agents)
#   KIRO_HOOKS_DST    override hooks  install path (default: ~/.kiro/hooks)
#
# Requirements: Python 3.8+

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQUADS_ROOT="$REPO_ROOT/squads"
AGENTS_DST="${KIRO_AGENTS_DST:-$HOME/.kiro/agents}"
HOOKS_DST="${KIRO_HOOKS_DST:-$HOME/.kiro/hooks}"
CONVERT_AGENT_PY="$REPO_ROOT/tools/kiro_convert_agent.py"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found on PATH. ai-squad hooks require Python 3.8+." >&2
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

echo "ai-squad Kiro deploy"
echo "  squads:  ${SQUADS[*]}"
echo "  agents:  -> $AGENTS_DST"
echo "  hooks:   -> $HOOKS_DST"
echo ""

mkdir -p "$AGENTS_DST" "$HOOKS_DST"

for squad in "${SQUADS[@]}"; do
  echo "[squad: $squad]"
  squad_root="$SQUADS_ROOT/$squad"

  # Skills → Custom Agent JSON (entry-points need invocation + hooks; Kiro
  # Skills can't carry hooks, so we map to Custom Agents).
  if [ -d "$squad_root/skills" ]; then
    for skill_dir in "$squad_root/skills"/*/; do
      [ -d "$skill_dir" ] || continue
      skill=$(basename "$skill_dir")
      src="$skill_dir/skill.md"
      [ -f "$src" ] || continue
      dst="$AGENTS_DST/$skill.json"
      echo "  [agent]  $skill (entry-point)"
      python3 "$CONVERT_AGENT_PY" "$src" "$dst"
    done
  fi

  # Subagents → Custom Agent JSON (Kiro dispatches them via `delegate`).
  if [ -d "$squad_root/agents" ]; then
    for agent_file in "$squad_root/agents"/*.md; do
      [ -f "$agent_file" ] || continue
      agent=$(basename "$agent_file" .md)
      dst="$AGENTS_DST/$agent.json"
      echo "  [agent]  $agent (subagent)"
      python3 "$CONVERT_AGENT_PY" "$agent_file" "$dst"
    done
  fi

  # Hooks → .py (same scripts as Claude Code — hook_runtime already handles
  # Kiro's `cwd` payload; agent JSONs reference them via $HOME/.kiro/hooks/).
  if [ -d "$squad_root/hooks" ]; then
    for hook_file in "$squad_root/hooks"/*.py; do
      [ -f "$hook_file" ] || continue
      hook=$(basename "$hook_file")
      echo "  [hook]   $hook"
      cp "$hook_file" "$HOOKS_DST/$hook"
      chmod +x "$HOOKS_DST/$hook"
    done
  fi
done

echo ""
echo "Done. Launch an ai-squad agent with: kiro-cli --agent <name>"
echo "  or, inside a Kiro chat session, run /agent and pick from the list."
echo "  e.g. kiro-cli --agent spec-writer  |  kiro-cli --agent discovery-lead"
