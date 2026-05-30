#!/usr/bin/env python3
"""ai-squad SubagentStop hook — capture-subagent-cost.

Writes one cost file per subagent: .agent-session/<FEAT>/costs/agent-<agentId>.json
Filesystem-first: no manifest mutation, no lock. Idempotent + fail-open.
The audit-agent reconciles these against the subagent transcripts on disk.
"""
import glob
import json
import os
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

import pricing  # noqa: E402
import transcript_cost  # noqa: E402
from hook_runtime import resolve_project_root  # noqa: E402


def _find_active_session_dir(repo_root: Path):
    """Newest .agent-session/<ID>/ that has a session.yml. Best-effort."""
    base = repo_root / ".agent-session"
    if not base.is_dir():
        return None
    candidates = [d for d in base.iterdir() if (d / "session.yml").exists()]
    if not candidates:
        return None
    return max(candidates, key=lambda d: d.stat().st_mtime)


def capture(agent_id, transcript_path, session_dir, prices):
    """Core logic (unit-testable). Returns process exit code (always 0)."""
    try:
        session_dir = Path(session_dir)
        out_dir = session_dir / "costs"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"agent-{agent_id}.json"
        if out_file.exists():  # idempotent
            return 0
        result = transcript_cost.extract_transcript_cost(transcript_path, prices)
        payload = {
            "agent_id": agent_id,
            "transcript_path": str(transcript_path),
            "scope": "implementation",
            **result,
        }
        tmp = out_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, out_file)  # atomic
    except Exception as e:  # fail-open — never block a session
        print(f"capture-subagent-cost: {e}", file=sys.stderr)
    return 0


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    agent_id = payload.get("agent_id") or "unknown"
    transcript_path = payload.get("agent_transcript_path")
    repo_root = resolve_project_root(payload)
    session_dir = _find_active_session_dir(Path(repo_root))
    if session_dir is None:
        return 0
    # Fallback: if payload lacks the path, glob the newest subagent transcript.
    if not transcript_path:
        hits = glob.glob(os.path.expanduser(f"~/.claude/projects/*/*/subagents/agent-{agent_id}.jsonl"))
        transcript_path = max(hits, key=os.path.getmtime) if hits else None
    if not transcript_path:
        return 0
    # Decoupling: token capture must NEVER depend on the price table being
    # present. The tokens come from the transcript; pricing only converts them
    # to USD. If the table is missing (deploy gap), capture the tokens anyway —
    # the model is recorded as `unpriced` (cost_usd: null), never dropped.
    # Normal operation always has the table (deploy installs it per-repo +
    # global); this except is the safety net, not the happy path.
    try:
        prices = pricing.load_prices()
    except (FileNotFoundError, OSError, ValueError, KeyError) as e:
        print(
            f"capture-subagent-cost: price table unavailable ({e}); "
            "capturing tokens unpriced",
            file=sys.stderr,
        )
        prices = {}
    return capture(agent_id, transcript_path, session_dir, prices)


if __name__ == "__main__":
    sys.exit(main())
