#!/usr/bin/env python3
"""CLI: python3 scripts/cost-report.py <FEAT-NNN> [base_dir]
Writes <session_dir>/cost-report.json and prints the markdown table.

base_dir defaults to .agent-session (relative to cwd in the consumer repo)."""
import json
import sys
from pathlib import Path

# Append, not insert(0): shared/lib/warnings.py shadows the stdlib `warnings`
# module if shared/lib lands at the front of sys.path (circular import via pathlib).
sys.path.append(str(Path(__file__).resolve().parent.parent / "shared" / "lib"))
import cost_report  # noqa: E402


def main(argv):
    if not argv:
        print("usage: cost-report.py <FEAT-NNN> [base_dir]", file=sys.stderr)
        return 2
    task_id = argv[0]
    base = Path(argv[1]) if len(argv) > 1 else Path(".agent-session")
    session_dir = base / task_id
    rep = cost_report.build_cost_report(session_dir)
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "cost-report.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    print(cost_report.render_markdown(rep, task_id))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
