#!/usr/bin/env python3
"""CLI: seal-session.py <spec_id> <session_id> [base_dir]
Idempotent seal step for /ship: register the chat session as owner, backfill
the main-session cost on the window, regenerate cost-report.json. Writes no
status and removes nothing. Fail-open."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cost_report  # noqa: E402
from hook_runtime import register_observed_session, read_yaml_scalar  # noqa: E402


def main(argv):
    if len(argv) < 2:
        print("usage: seal-session.py <spec_id> <session_id> [base_dir]", file=sys.stderr)
        return 2
    spec_id, session_id = argv[0], argv[1]
    base = Path(argv[2]) if len(argv) > 2 else Path(".agent-session")
    session_dir = base / spec_id
    yml = session_dir / "session.yml"
    if not yml.exists():
        print(f"seal: no session at {session_dir}", file=sys.stderr)
        return 1
    try:
        register_observed_session(yml, session_id)
        window = (read_yaml_scalar(yml, "created_at"), read_yaml_scalar(yml, "closed_at"))
        cost_report.backfill_main_session(session_dir, window, cost_report._load_prices_safe())
        cost_report.write_cost_report_json(session_dir)
    except Exception as e:  # fail-open
        print(f"seal: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
