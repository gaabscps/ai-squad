#!/usr/bin/env python3
"""CLI: python3 .claude/hooks/cost-report.py <FEAT-NNN> [base_dir]
Writes <session_dir>/cost-report.json and prints the markdown table.

Lives in the hooks dir so it deploys with the per-repo hook bundle and can
import its sibling cost_report module in any consumer repo.
base_dir defaults to .agent-session (relative to cwd in the consumer repo)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cost_report  # noqa: E402


def main(argv):
    if not argv:
        print("usage: cost-report.py <FEAT-NNN> [base_dir]", file=sys.stderr)
        return 2
    task_id = argv[0]
    base = Path(argv[1]) if len(argv) > 1 else Path(".agent-session")
    session_dir = base / task_id
    session_dir.mkdir(parents=True, exist_ok=True)
    rep = cost_report.write_cost_report_json(session_dir)
    if rep is None:  # no costs/ yet — still print the (empty) table, write nothing
        rep = cost_report.build_cost_report(session_dir)
    print(cost_report.render_markdown(rep, task_id))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
