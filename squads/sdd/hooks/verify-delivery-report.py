#!/usr/bin/env python3
"""ai-squad Stop hook (auto-becomes SubagentStop) — verify-delivery-report.

Wired to the chronicler's frontmatter. Fires when the chronicler attempts to stop.
Refuses the stop if `.agent-session/<spec_id>/delivery-report.json` is missing or
fails structural validation. Validation is MANUAL (required fields, the 11 answer
keys, and the closed enums) — no jsonschema dependency, mirroring
verify-output-packet.py — so it runs in any consumer repo with pure stdlib.

This closes the loop the first real run exposed: without a Stop-time gate the
chronicler (an LLM) drifted from the schema (emitted an `answers` map plus
traceability fields the old schema rejected). The schema now matches that natural
shape; this hook enforces it so a malformed report never reaches the aiOS.

Pure stdlib. Python 3.8+.
"""
import json
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import detect_active_subagent, find_active_session, resolve_project_root

# Mirror shared/schemas/delivery-report.schema.json (keep in sync).
_QUESTION_KEYS = {
    "what_was_done", "how_it_was_done", "why_this_way", "deviations_from_plan",
    "acceptance_criteria", "evidence", "impacts", "out_of_scope",
    "risks_and_pending", "how_to_validate", "final_verdict",
}
_CONFIDENCE = {"recorded", "inferred", "not_recorded"}
_AC_CLASS = {"met", "partially_met", "not_met", "not_validated"}
_VERDICT = {"approved", "approved_with_caveats", "needs_changes", "blocked", "needs_human_review"}


def validate_report(path: Path) -> tuple:
    """Return (ok, reason). Structural validation against the canonical schema."""
    try:
        rep = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return False, f"delivery-report.json unreadable ({exc})"
    if not isinstance(rep, dict):
        return False, "delivery-report.json must be a JSON object"
    for k in ("spec_id", "answers", "acceptance_criteria", "verdict"):
        if k not in rep:
            return False, f"delivery-report.json missing required field '{k}'"
    answers = rep["answers"]
    if not isinstance(answers, dict):
        return False, "delivery-report.json 'answers' must be a map keyed by the 11 question keys"
    missing = _QUESTION_KEYS - set(answers)
    if missing:
        return False, f"delivery-report.json 'answers' missing question keys: {sorted(missing)}"
    extra = set(answers) - _QUESTION_KEYS
    if extra:
        return False, f"delivery-report.json 'answers' has unknown keys: {sorted(extra)}"
    for k, a in answers.items():
        if not isinstance(a, dict) or "answer" not in a or "confidence" not in a:
            return False, f"delivery-report.json answers['{k}'] needs 'answer' and 'confidence'"
        if a["confidence"] not in _CONFIDENCE:
            return False, (
                f"delivery-report.json answers['{k}'].confidence '{a['confidence']}' "
                f"not in {sorted(_CONFIDENCE)}"
            )
    acs = rep["acceptance_criteria"]
    if not isinstance(acs, list):
        return False, "delivery-report.json 'acceptance_criteria' must be an array"
    for i, ac in enumerate(acs):
        if not isinstance(ac, dict) or "id" not in ac or "classification" not in ac:
            return False, f"delivery-report.json acceptance_criteria[{i}] needs 'id' and 'classification'"
        if ac["classification"] not in _AC_CLASS:
            return False, (
                f"delivery-report.json acceptance_criteria[{i}].classification "
                f"'{ac['classification']}' not in {sorted(_AC_CLASS)}"
            )
    verdict = rep["verdict"]
    if not isinstance(verdict, dict) or "value" not in verdict or "rationale" not in verdict:
        return False, "delivery-report.json 'verdict' needs 'value' and 'rationale'"
    if verdict["value"] not in _VERDICT:
        return False, (
            f"delivery-report.json verdict.value '{verdict['value']}' not in {sorted(_VERDICT)}"
        )
    return True, "valid"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"verify-delivery-report: malformed stdin ({exc})", file=sys.stderr)
        return 0

    if payload.get("stop_hook_active"):
        return 0  # avoid infinite loop

    # Only the chronicler owes a delivery-report. Any other subagent stops freely.
    if detect_active_subagent(payload) != "chronicler":
        return 0

    def _block(reason: str) -> int:
        print(json.dumps({"decision": "block", "reason": reason}))
        return 0

    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None:
        # Cannot locate the Session — fail open rather than trap the agent on infra ambiguity.
        return 0

    report_path = session_dir / "delivery-report.json"
    if not report_path.exists():
        return _block(
            f"chronicler stopped but {report_path.relative_to(project_dir)} is missing. "
            "Write delivery-report.json (per the shape in your body) before completing."
        )

    ok, reason = validate_report(report_path)
    if not ok:
        return _block(f"{reason}. Fix delivery-report.json and re-emit before completing.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
