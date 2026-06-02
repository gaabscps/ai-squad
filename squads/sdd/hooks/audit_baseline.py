#!/usr/bin/env python3
"""ai-squad helper — audit baseline (Spec A).

Shared, deterministic computation behind the audit-agent's Check 6 baseline
exemption. NOT a hook: it is imported by capture-baseline.py (to snapshot the
working tree) and invoked as a read-only CLI by the audit-agent (to compute the
delta the agent reconciles against dev packets).

The single source of truth for "what counts as a dirty path" lives here
(`dirty_paths`), so the baseline snapshot and the Check 6 comparison can never
drift apart — the set subtraction only lines up if both sides parse git the same
way.

Pure stdlib. Python 3.8+. Read-only: only runs `git status`, never writes.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BASELINE_FILENAME = "audit-baseline.json"


def dirty_paths(project_dir) -> list:
    """Repo-relative paths currently dirty in the working tree.

    Uses `git status --porcelain` — the unified notion of "dirty" shared by the
    baseline snapshot and Check 6 (the legacy Check 6 used `git diff --name-only
    HEAD`, which ignored untracked files; porcelain covers both, so the
    subtraction is exact). Returns a sorted list. Any git failure (not a work
    tree, git missing) yields [] — callers treat that as best-effort, never crash.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(project_dir), "status", "--porcelain"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if out.returncode != 0:
        return []
    paths = set()
    for line in out.stdout.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]                       # strip the 2-char XY status + space
        if " -> " in path:                    # renamed: "ORIG -> NEW"; keep NEW
            path = path.split(" -> ", 1)[1]
        paths.add(path)
    return sorted(paths)


def load_baseline(session_dir):
    """Return the baseline's dirty_paths list, or None when no usable baseline
    exists (feature predates the hook, capture never ran, or the file is
    corrupt). None drives the audit-agent's whole-tree fail-safe."""
    f = Path(session_dir) / BASELINE_FILENAME
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    paths = data.get("dirty_paths") if isinstance(data, dict) else None
    return sorted(paths) if isinstance(paths, list) else None


def compute(project_dir, session_dir) -> dict:
    """Reconcile the current dirty set against the baseline.

    Returns:
      baseline_present: bool  — False => audit must use the whole-tree fail-safe.
      dirty_now: sorted list  — everything dirty now.
      baseline:  sorted list  — what was dirty before Phase 4 ([] if absent).
      delta:     sorted list  — dirty_now - baseline (pipeline-introduced; these
                                still require a dev packet to be legitimate).
      exempted:  sorted list  — dirty_now & baseline (pre-existing; never a finding).
    """
    now = dirty_paths(project_dir)
    base = load_baseline(session_dir)
    present = base is not None
    base = base or []
    base_set = set(base)
    delta = sorted(p for p in now if p not in base_set)
    exempted = sorted(p for p in now if p in base_set)
    return {
        "baseline_present": present,
        "dirty_now": now,
        "baseline": base,
        "delta": delta,
        "exempted": exempted,
    }


def main(argv) -> int:
    # CLI: audit_baseline.py <spec_id>  -> prints compute() as JSON.
    # project_dir = CWD (the audit-agent runs from the consumer repo root);
    # session_dir = .agent-session/<spec_id>/.
    if len(argv) < 2:
        print(json.dumps({"error": "usage: audit_baseline.py <spec_id>"}))
        return 2
    project_dir = Path.cwd()
    session_dir = project_dir / ".agent-session" / argv[1]
    print(json.dumps(compute(project_dir, session_dir), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
