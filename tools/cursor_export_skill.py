#!/usr/bin/env python3
"""
Emit a Cursor Agent Skill (SKILL.md) from an ai-squad Claude Code skill.md or agent .md.

Strips Claude-only frontmatter (hooks, model, tools, effort, etc.). Cursor loads skills
from ~/.cursor/skills/<name>/SKILL.md (personal) or .cursor/skills/ in a repo.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

_CALLOUT = """> **Cursor (IDE / CLI):** Run **`/spec-writer`**, **`/orchestrator`**, etc. (slash + skill name), use **`@skill`**, or open the **Skills** picker — see [Cursor Skills](https://cursor.com/docs/agent/chat/commands). For `AskUserQuestion`, use numbered options or explicit Yes/No in chat. For worker roles, use **`/dev`**, **`@dev`**, or **Task** when your build supports it. **`./tools/deploy-cursor.sh`** installs the same hook **scripts** as Claude (see `squads/sdd/hooks/`) into `~/.cursor/hooks/ai-squad/` and merges `squads/sdd/hooks/cursor-hooks.json` into `~/.cursor/hooks.json`. Cursor accepts Claude-style `hookSpecificOutput` JSON; project root is taken from `workspace_roots` / `cwd` when `CLAUDE_PROJECT_DIR` is unset. **Note:** `guard-session-scope` (orchestrator may not edit source files) is **not** in the Cursor merge list — it would block every `Write` including `dev`; keep that enforcement via **Claude Code** (skill hooks) or **Third-party Claude hooks** in Cursor. Global **`block-git-write`**, **`verify-audit-dispatch`**, and **`verify-output-packet`** are merged and safe for Cursor.

"""

_ORCHESTRATOR_CURSOR_HARD_RULES = """> **Cursor — orchestrator hard rules** (`guard-session-scope` is **not** wired globally here; treat this as mandatory):
> - **Never** use file-writing tools on paths **outside** `.agent-session/<task_id>/`. Session manifests, inputs, `session.yml`, handoff prose — **only** under `.agent-session/`.
> - **Every** change to consumer source files flows through **`dev`** via **Task**, with a Work Packet and explicit `scope_files`. Do not “just fix” a file in the repo yourself.
> - **Never** run git **write** operations from this role (`commit`, `add`, `push`, `reset`, …); read-only (`status`, `diff`, `log`) is fine. The human commits after handoff.
> - If you are about to edit product code directly, **stop** — dispatch `dev` instead.

"""


def _split_frontmatter(raw: str) -> tuple[str, str]:
    if not raw.startswith("---"):
        raise ValueError("expected YAML frontmatter opening ---")
    # First line is ---; find second ---
    after_first = raw[3:].lstrip("\n")
    idx = after_first.find("\n---")
    if idx == -1:
        raise ValueError("expected closing --- for frontmatter")
    fm_block = after_first[:idx].strip("\n")
    rest = after_first[idx + 4 :].lstrip("\n")
    if after_first.startswith("---"):
        # edge: malformed
        pass
    return fm_block, rest


def _parse_name_description(fm_block: str) -> tuple[str, str]:
    name: str | None = None
    desc: str | None = None
    for line in fm_block.splitlines():
        m = re.match(r"^name:\s*(.+)\s*$", line)
        if m:
            name = m.group(1).strip()
            continue
        m = re.match(r"^description:\s*(.+)\s*$", line)
        if m:
            desc = m.group(1).strip()
            continue
    if not name or not desc:
        raise ValueError("frontmatter must contain name: and description: (single-line each)")
    return name, desc


def _emit_skill_md(name: str, description: str, body: str) -> str:
    # Keep description under Cursor's 1024 limit — append short suffix only if room.
    suffix = " | ai-squad"
    if len(description) + len(suffix) <= 1000:
        description = f"{description}{suffix}"
    front = (
        "---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        "disable-model-invocation: true\n"
        "---\n\n"
    )
    orch_extra = _ORCHESTRATOR_CURSOR_HARD_RULES if name == "orchestrator" else ""
    return front + _CALLOUT + orch_extra + body


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: cursor_export_skill.py <source.md> <destination/SKILL.md>",
            file=sys.stderr,
        )
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    raw = src.read_text(encoding="utf-8")
    fm, body = _split_frontmatter(raw)
    name, desc = _parse_name_description(fm)
    out = _emit_skill_md(name, desc, body)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(out, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
