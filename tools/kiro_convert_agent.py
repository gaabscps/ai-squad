#!/usr/bin/env python3
"""
Emit a Kiro agent JSON (~/.kiro/agents/<name>.json) from an ai-squad agent or skill .md.

Translates Claude Code frontmatter fields to Kiro agent config format:
  - model:           sonnet/opus → "auto"  |  haiku → "claude-haiku-4.5"
  - tools:           Claude names → Kiro tool names
  - permissionMode:  bypassPermissions → allowedTools ["*"]
  - hooks.Stop:      → hooks.stop[], path rewritten $HOME/.claude/ → ~/.kiro/
  - hooks.PreToolUse → hooks.preToolUse[], matcher translated Claude → Kiro tool names
  - effort/fan_out:  discarded (no Kiro equivalent)
  - body (Markdown): → prompt field (inline)

Skills with hooks (e.g. orchestrator) are also supported — the converter is used
by deploy-kiro.sh for both agents/*.md and any skill that declares hooks.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# ── Model map ────────────────────────────────────────────────────────────────
# Edit here when Kiro adds new models or you want to pin specific versions.
MODEL_MAP: dict[str, str] = {
    "sonnet": "auto",
    "opus":   "auto",
    "haiku":  "claude-haiku-4.5",
}

# ── Tool name map ─────────────────────────────────────────────────────────────
# Canonical Kiro tool names (per ~/.kiro/agents/agent_config.json.example).
# Legacy aliases like fs_read / fs_write / execute_bash are still accepted by
# Kiro CLI for backwards compatibility, but we emit the canonical form.
# WebSearch / WebFetch have no built-in equivalent in Kiro — they require an
# MCP server, so we drop them with a warning at parse time.
TOOL_MAP: dict[str, str] = {
    "Read":  "read",
    "Edit":  "write",
    "Write": "write",
    "Bash":  "shell",
    "Grep":  "grep",
    "Glob":  "glob",
}

# Tools with no Kiro built-in equivalent — dropped with a stderr warning.
TOOLS_REQUIRES_MCP: set[str] = {"WebSearch", "WebFetch"}


def _split_frontmatter(raw: str) -> tuple[str, str]:
    if not raw.startswith("---"):
        raise ValueError("expected YAML frontmatter opening ---")
    after = raw[3:].lstrip("\n")
    idx = after.find("\n---")
    if idx == -1:
        raise ValueError("expected closing --- for frontmatter")
    return after[:idx].strip("\n"), after[idx + 4:].lstrip("\n")


def _parse_frontmatter(fm: str) -> dict:
    """Minimal YAML parser for the flat+nested structure used in agent frontmatter."""
    result: dict = {}
    lines = fm.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        # top-level key: value
        m = re.match(r"^(\w[\w-]*):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val:
                result[key] = val
            else:
                # nested block — collect indented lines
                block: list[str] = []
                i += 1
                while i < len(lines) and (lines[i].startswith(" ") or lines[i].startswith("\t")):
                    block.append(lines[i])
                    i += 1
                result[key] = "\n".join(block)
                continue
        i += 1
    return result


def _parse_tools(tools_str: str) -> list[str]:
    """'Read, Edit, Write, Bash' → deduplicated Kiro tool names."""
    seen: set[str] = set()
    out: list[str] = []
    for t in re.split(r"[,\s]+", tools_str.strip()):
        t = t.strip()
        if not t:
            continue
        if t in TOOLS_REQUIRES_MCP:
            print(
                f"warning: tool '{t}' has no built-in Kiro equivalent — dropped "
                "(install an MCP server that provides it and reference via @<server>/<tool>)",
                file=sys.stderr,
            )
            continue
        kiro = TOOL_MAP.get(t, t.lower())
        if kiro not in seen:
            seen.add(kiro)
            out.append(kiro)
    return out


# Claude PreToolUse matcher → Kiro tool name (canonical)
MATCHER_MAP: dict[str, str] = {
    "Edit|Write|MultiEdit": "write",
    "Bash":                 "shell",
}


def _rewrite_cmd(cmd: str) -> str:
    return cmd.replace("$HOME/.claude/hooks/", "~/.kiro/hooks/")


def _parse_hooks(hooks_block: str) -> dict:
    """Parse the full hooks YAML block → Kiro hooks dict with preToolUse and stop."""
    # Normalize indentation: strip common leading whitespace so section headers are at indent 0
    lines_raw = hooks_block.splitlines()
    non_empty = [l for l in lines_raw if l.strip()]
    if not non_empty:
        return {}
    base_indent = min(len(l) - len(l.lstrip()) for l in non_empty)
    lines = [l[base_indent:] for l in lines_raw]

    stop: list[dict] = []
    pre: list[dict] = []

    section: str | None = None
    current_matcher: str | None = None
    current_cmd: str | None = None
    current_timeout: int | None = None

    def _flush_pre() -> None:
        nonlocal current_matcher, current_cmd, current_timeout
        if current_cmd is not None:
            entry: dict = {"command": _rewrite_cmd(current_cmd)}
            if current_matcher:
                kiro_matcher = MATCHER_MAP.get(current_matcher, current_matcher.lower())
                entry["matcher"] = kiro_matcher
            if current_timeout is not None:
                entry["timeout_ms"] = current_timeout * 1000
            pre.append(entry)
        current_matcher = current_cmd = current_timeout = None

    for line in lines:
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())

        # Top-level section headers (indent 0 after normalization)
        if indent == 0 and re.match(r"(Stop|PreToolUse)\s*:", stripped):
            if section == "PreToolUse":
                _flush_pre()
            section = "Stop" if stripped.startswith("Stop") else "PreToolUse"
            continue

        if section == "Stop":
            m = re.match(r'command:\s*"?([^"]+)"?\s*$', stripped)
            if m:
                entry = {"command": _rewrite_cmd(m.group(1))}
                stop.append(entry)
            m = re.match(r'timeout:\s*(\d+)', stripped)
            if m and stop:
                stop[-1]["timeout_ms"] = int(m.group(1)) * 1000

        elif section == "PreToolUse":
            # Strip YAML list prefix and skip pure structural keys
            item = re.sub(r"^-\s*", "", stripped)
            if item in ("hooks:", "") or re.match(r"^type:\s*", item):
                continue
            m = re.match(r'matcher:\s*"?([^"]+)"?\s*$', item)
            if m:
                _flush_pre()
                current_matcher = m.group(1)
                continue
            m = re.match(r'command:\s*"?([^"]+)"?\s*$', item)
            if m:
                current_cmd = m.group(1)
                continue
            m = re.match(r'timeout:\s*(\d+)', stripped)
            if m:
                current_timeout = int(m.group(1))

    if section == "PreToolUse":
        _flush_pre()

    result: dict = {}
    if pre:
        result["preToolUse"] = pre
    if stop:
        result["stop"] = stop
    return result


def convert(src: Path) -> dict:
    raw = src.read_text(encoding="utf-8")
    fm_raw, body = _split_frontmatter(raw)
    fm = _parse_frontmatter(fm_raw)

    name = fm.get("name", src.stem)
    description = fm.get("description", "")
    model_alias = fm.get("model", "sonnet")
    model = MODEL_MAP.get(model_alias, "auto")
    bypass = fm.get("permissionMode", "") == "bypassPermissions"

    config: dict = {
        "name": name,
        "description": description,
        "model": model,
        "prompt": body.strip(),
    }

    tools_str = fm.get("tools", "")
    if tools_str:
        tools = _parse_tools(tools_str)
        config["tools"] = tools

    if bypass:
        config["allowedTools"] = ["*"]

    hooks_block = fm.get("hooks", "")
    if hooks_block:
        hooks = _parse_hooks(hooks_block)
        if hooks:
            config["hooks"] = hooks

    return config


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: kiro_convert_agent.py <source.md> <destination.json>", file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    config = convert(src)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
