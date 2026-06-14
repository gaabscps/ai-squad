#!/usr/bin/env python3
"""Tests for observe_report.py — deterministic markdown parecer from facts.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_observe_report.py -v
"""
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from observe_report import build_observe_report_md  # noqa: E402


def _facts():
    return {
        "spec_id": "OBS-010",
        "squad": "observed",
        "feature_name": "validar UI do pré-cadastro",
        "output_locale": "pt-BR",
        "outcome": "success",
        "work_units": [{
            "id": "OBS-010", "title": "validar UI do pré-cadastro",
            "final_status": "done",
            "decisions": [
                {"what": "usa VPButton", "why": "é o botão do DS", "rejected": "Button legacy"},
            ],
            "files_changed": ["src/register.jsx"],
            "evidence_refs": ["ran: npm test", "git status -> clean"],
        }],
        "gate": {"role": "human", "status": "done"},
        "timeline": {"started_at": "2026-06-14T01:01:03Z", "completed_at": "2026-06-14T02:00:00Z"},
    }


class TestObserveReport(unittest.TestCase):
    def test_md_has_all_sections(self):
        md = build_observe_report_md(_facts())
        self.assertIn("validar UI do pré-cadastro", md)
        self.assertIn("src/register.jsx", md)
        self.assertIn("npm test", md)
        self.assertIn("usa VPButton", md)
        self.assertIn("é o botão do DS", md)
        self.assertIn("Button legacy", md)

    def test_locale_en_uses_english_headings(self):
        f = _facts(); f["output_locale"] = "en"
        md = build_observe_report_md(f)
        self.assertIn("## What was done", md)

    def test_empty_facts_does_not_crash(self):
        md = build_observe_report_md({"work_units": [{}]})
        self.assertIsInstance(md, str)


if __name__ == "__main__":
    unittest.main()
