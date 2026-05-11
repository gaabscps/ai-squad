#!/usr/bin/env python3
"""
Tests for verify-pm-handoff-clean.py.

Covers (T-007 subset for T-004 scope):
  AC-001 — each of 6 debt markers blocks Stop, evidence contains file:line
  AC-002 — zero matches → allow
  AC-004 — excluded paths (.agent-session/, node_modules/, vendor/, dist/,
            build/, .next/) are not scanned
  NFR-003 — refusal output is a valid markdown table

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_verify_pm_handoff_clean
OR:
  python3 squads/sdd/hooks/__tests__/test_verify_pm_handoff_clean.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# ---------------------------------------------------------------------------
# Locate the hook script
# ---------------------------------------------------------------------------
_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "verify-pm-handoff-clean.py"


def _run_hook(payload: dict) -> dict:
    """Run the hook subprocess with the given payload on stdin.

    Returns the parsed JSON object emitted by the hook on stdout.
    If stdout is empty, returns {} (allow / no-op decision).
    """
    result = subprocess.run(
        [sys.executable, str(_HOOK_SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=10,
        env=os.environ,
    )
    stdout = result.stdout.strip()
    if not stdout:
        return {}
    return json.loads(stdout)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tree(tmp: Path, files: dict[str, str]) -> None:
    """Create files under *tmp* with given {relative_path: content} mapping."""
    for rel, content in files.items():
        p = tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")


# Standard hook payload (stop hook — no tool_input).
_BASE_PAYLOAD = {"stop_hook_active": False}


# ===========================================================================
# AC-002 — zero matches allows Stop
# ===========================================================================

class TestAllowOnCleanTree(unittest.TestCase):
    """AC-002: clean working tree must yield allow (no block)."""

    def test_clean_tree_allows(self):
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {
                "src/main.py": "def hello():\n    return 'world'\n",
                "README.md": "# Project\nNo markers here.\n",
            })
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            # Either empty output (allow by default) or explicit allow
            decision = result.get("decision", "allow")
            self.assertEqual(decision, "allow",
                             f"Expected allow for clean tree, got: {result}")

    def test_empty_tree_allows(self):
        with tempfile.TemporaryDirectory() as tmp_str:
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            decision = result.get("decision", "allow")
            self.assertEqual(decision, "allow",
                             f"Expected allow for empty tree, got: {result}")


# ===========================================================================
# AC-001 — each of 6 canonical markers triggers a block
# ===========================================================================

class TestBlockOnMarker(unittest.TestCase):
    """AC-001: each debt marker independently triggers a block with file:line evidence."""

    def _assert_blocks_with_marker(self, marker: str, content: str) -> dict:
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            safe = marker.replace("@", "AT").replace("-", "_")
            fname = f"src/file_{safe}.py"
            _make_tree(tmp, {fname: content})
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertEqual(
                result.get("decision"), "block",
                f"Expected block for marker {marker!r}, got: {result}",
            )
            return result

    def _extract_evidence(self, result: dict) -> list[dict]:
        """Extract evidence list from hook output (supports evidence[] or reason str)."""
        ev = result.get("evidence")
        if isinstance(ev, list):
            return ev
        # Some implementations embed file:line in reason string — check both
        return ev or []

    def test_TODO_blocks(self):
        result = self._assert_blocks_with_marker(
            "TODO", "# TODO: fix this later\n"
        )
        # evidence should contain the match
        evidence = self._extract_evidence(result)
        self.assertGreater(len(evidence), 0,
                           f"Expected at least one evidence entry for TODO: {result}")

    def test_FIXME_blocks(self):
        result = self._assert_blocks_with_marker(
            "FIXME", "# FIXME: broken logic\n"
        )
        evidence = self._extract_evidence(result)
        self.assertGreater(len(evidence), 0,
                           f"Expected at least one evidence entry for FIXME: {result}")

    def test_xfail_blocks(self):
        result = self._assert_blocks_with_marker(
            "xfail", "@xfail\ndef test_broken(): pass\n"
        )
        evidence = self._extract_evidence(result)
        self.assertGreater(len(evidence), 0,
                           f"Expected at least one evidence entry for xfail: {result}")

    def test_at_skip_blocks(self):
        result = self._assert_blocks_with_marker(
            "@skip", "# @skip\n"
        )
        evidence = self._extract_evidence(result)
        self.assertGreater(len(evidence), 0,
                           f"Expected at least one evidence entry for @skip: {result}")

    def test_pending_blocks(self):
        result = self._assert_blocks_with_marker(
            "pending", "status = 'pending'\n"
        )
        # 'pending' word-boundary: must match bare 'pending' but test with
        # unambiguous standalone usage
        result2 = self._assert_blocks_with_marker(
            "pending", "# pending: implement me\n"
        )
        evidence = self._extract_evidence(result2)
        self.assertGreater(len(evidence), 0,
                           f"Expected at least one evidence entry for pending: {result2}")

    def test_mock_only_blocks(self):
        result = self._assert_blocks_with_marker(
            "mock-only", "# mock-only\n"
        )
        evidence = self._extract_evidence(result)
        self.assertGreater(len(evidence), 0,
                           f"Expected at least one evidence entry for mock-only: {result}")

    def test_evidence_contains_file_and_line(self):
        """AC-001 + NFR-003: evidence entries must include file path and line number."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {"src/app.py": "x = 1\n# TODO: refactor\ny = 2\n"})
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertEqual(result.get("decision"), "block")
            evidence = self._extract_evidence(result)
            self.assertGreater(len(evidence), 0)
            entry = evidence[0]
            # Must have 'file' (path string) and 'line' (int)
            self.assertIn("file", entry, f"Evidence entry missing 'file': {entry}")
            self.assertIn("line", entry, f"Evidence entry missing 'line': {entry}")
            self.assertIsInstance(entry["line"], int,
                                  f"'line' must be int, got: {type(entry['line'])}")
            # line number should be 2 (second line of the file above)
            self.assertEqual(entry["line"], 2,
                             f"Expected line 2, got {entry['line']}")


# ===========================================================================
# AC-004 — excluded paths are not scanned
# ===========================================================================

class TestExcludedPaths(unittest.TestCase):
    """AC-004: debt markers under excluded prefixes must not trigger a block."""

    def _assert_excluded(self, rel_path: str, marker_content: str):
        """Place marker-content at rel_path and assert the hook still allows."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {rel_path: marker_content})
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            decision = result.get("decision", "allow")
            self.assertEqual(
                decision, "allow",
                f"Expected allow (excluded path {rel_path!r}), got: {result}",
            )

    def test_excludes_agent_session(self):
        self._assert_excluded(
            ".agent-session/FEAT-004/notes.md",
            "# TODO: session metadata\n",
        )

    def test_excludes_node_modules(self):
        self._assert_excluded(
            "node_modules/somelib/index.js",
            "// TODO: vendored\n",
        )

    def test_excludes_vendor(self):
        self._assert_excluded(
            "vendor/dep/dep.py",
            "# FIXME: upstream bug\n",
        )

    def test_excludes_dist(self):
        self._assert_excluded(
            "dist/bundle.js",
            "// TODO: generated\n",
        )

    def test_excludes_build(self):
        self._assert_excluded(
            "build/output.js",
            "// FIXME: compiled\n",
        )

    def test_excludes_next(self):
        self._assert_excluded(
            ".next/cache/page.js",
            "// TODO: cached\n",
        )

    def test_excludes_only_excluded_path_not_sibling(self):
        """Marker in excluded path does NOT block; marker in real source DOES."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {
                ".agent-session/notes.md": "# TODO: ignore me\n",
                "src/real.py": "# TODO: catch me\n",
            })
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertEqual(
                result.get("decision"), "block",
                f"Expected block for marker in src/, got: {result}",
            )


# ===========================================================================
# NFR-003 — refusal evidence rendered as markdown table
# ===========================================================================

class TestRefusalMarkdownTable(unittest.TestCase):
    """NFR-003: the refusal output must contain a valid markdown table listing matches."""

    def _get_table_text(self, result: dict) -> str:
        """Extract the markdown table from the hook's reason string."""
        reason = result.get("reason", "")
        return reason

    def test_refusal_reason_contains_markdown_table(self):
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {"src/code.py": "# TODO: refactor\n# FIXME: broken\n"})
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertEqual(result.get("decision"), "block")
            reason = result.get("reason", "")
            # Markdown table must have pipe characters and header separator
            self.assertIn("|", reason,
                          f"Expected markdown table (pipes) in reason: {reason!r}")
            # Must have the separator row (---|--- pattern)
            self.assertRegex(reason, r"[-|]{3,}",
                             f"Expected table separator row in reason: {reason!r}")

    def test_refusal_reason_lists_each_match(self):
        """Every match file:line must appear in the reason output."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {
                "a.py": "# TODO: first\n",
                "b.py": "# FIXME: second\n",
            })
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertEqual(result.get("decision"), "block")
            reason = result.get("reason", "")
            evidence = result.get("evidence", [])
            # Each evidence file name should appear in the reason string
            for entry in evidence:
                fname = Path(entry["file"]).name
                self.assertIn(fname, reason,
                              f"Expected {fname!r} in reason table: {reason!r}")

    def test_output_is_valid_json(self):
        """Hook output is always valid JSON (required by Claude Code hook contract)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {"src/x.py": "# TODO: fix\n"})
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            # _run_hook already parsed JSON; if we got here without exception, it's valid
            self.assertIsInstance(result, dict)

    def test_decision_field_present_on_block(self):
        """Hook contract: blocked response must always have 'decision' field."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {"src/x.py": "# TODO: fix\n"})
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertIn("decision", result,
                          f"'decision' field missing from hook output: {result}")


# ===========================================================================
# Edge cases — stop_hook_active guard
# ===========================================================================

class TestStopHookActiveGuard(unittest.TestCase):
    """When stop_hook_active is True, hook must not block (avoids infinite loop)."""

    def test_stop_hook_active_passes(self):
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {"src/x.py": "# TODO: should be ignored when re-entrant\n"})
            payload = {"stop_hook_active": True, "cwd": tmp_str}
            result = _run_hook(payload)
            decision = result.get("decision", "allow")
            self.assertNotEqual(
                decision, "block",
                f"stop_hook_active=True must not block, got: {result}",
            )


# ===========================================================================
# Binary file false-positive fix (AC-001 / logic-reviewer finding)
# ===========================================================================

class TestBinaryFileFalsePositive(unittest.TestCase):
    """Binary files containing literal TODO/FIXME bytes must NOT trigger a block."""

    def test_binary_file_with_todo_bytes_not_blocked(self):
        """A binary file (null byte present) with TODO bytes must be skipped."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Write a file with a null byte (binary marker) + ASCII "TODO"
            binary_path = tmp / "image.png"
            binary_path.write_bytes(b"\x89PNG\r\n\x1a\x00TODO FIXME\x00more binary")
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            decision = result.get("decision", "allow")
            self.assertEqual(
                decision, "allow",
                f"Binary file with TODO bytes must not block, got: {result}",
            )

    def test_pdf_like_binary_not_blocked(self):
        """PDF-like binary (null byte) containing TODO text must be skipped."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            pdf_path = tmp / "doc.pdf"
            # Simulate PDF header + null byte + embedded text with debt marker
            pdf_path.write_bytes(b"%PDF-1.4\x00\nTODO: implement section\nFIXME: layout\x00")
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            decision = result.get("decision", "allow")
            self.assertEqual(
                decision, "allow",
                f"PDF-like binary with TODO/FIXME must not block, got: {result}",
            )

    def test_text_file_without_null_bytes_still_blocked(self):
        """A plain text file (no null bytes) with TODO must still be detected."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            text_path = tmp / "notes.txt"
            text_path.write_bytes(b"# TODO: fix this\nsome text\n")
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertEqual(
                result.get("decision"), "block",
                f"Text file with TODO must still block, got: {result}",
            )


# ===========================================================================
# Symlink-to-outside-root (AC-004 / logic-reviewer finding)
# ===========================================================================

class TestSymlinkOutsideRoot(unittest.TestCase):
    """Symlinks resolving outside the project root must be skipped (not scanned)."""

    def test_symlink_outside_root_not_scanned(self):
        """A symlink pointing outside the working tree root must not be followed."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Create a real file outside the project root in a sibling tmp dir
            with tempfile.TemporaryDirectory() as outside_str:
                outside = Path(outside_str)
                outside_file = outside / "secret.py"
                outside_file.write_text("# TODO: outside root\n", encoding="utf-8")
                # Create a symlink inside the project tree pointing outside
                link = tmp / "src" / "link.py"
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(outside_file)
                payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
                result = _run_hook(payload)
                decision = result.get("decision", "allow")
                self.assertEqual(
                    decision, "allow",
                    f"Symlink outside root must be skipped (not trigger block), got: {result}",
                )


# ===========================================================================
# Multi-marker line — NFR-003 every match (logic-reviewer finding)
# ===========================================================================

class TestMultiMarkerLine(unittest.TestCase):
    """A line with multiple distinct markers must emit one evidence entry per marker."""

    def test_multi_marker_line_emits_multiple_entries(self):
        """Line with both TODO and FIXME must appear as two evidence entries."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Single line with two different markers
            _make_tree(tmp, {"src/combo.py": "x = 1  # TODO: fix AND FIXME: now\n"})
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertEqual(result.get("decision"), "block")
            evidence = result.get("evidence", [])
            # Both TODO and FIXME must appear in evidence
            markers_found = {e["marker"] for e in evidence}
            self.assertIn("TODO", markers_found,
                          f"TODO missing from multi-marker evidence: {evidence}")
            self.assertIn("FIXME", markers_found,
                          f"FIXME missing from multi-marker evidence: {evidence}")

    def test_multi_marker_line_line_numbers_correct(self):
        """Both entries for a multi-marker line must share the same line number."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_tree(tmp, {"src/multi.py": "clean line\n# TODO: a  FIXME: b\nend\n"})
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            result = _run_hook(payload)
            self.assertEqual(result.get("decision"), "block")
            evidence = result.get("evidence", [])
            line_numbers = {e["line"] for e in evidence}
            self.assertIn(2, line_numbers,
                          f"Expected line 2 in multi-marker evidence: {evidence}")


# ===========================================================================
# Exempt paths — dogfood invariant (logic-reviewer finding)
# ===========================================================================

class TestExemptPaths(unittest.TestCase):
    """Files in _DEBT_MARKER_EXEMPT_PATHS must not trigger false-positive blocks."""

    def test_exempt_paths_constant_exists(self):
        """_DEBT_MARKER_EXEMPT_PATHS must be importable from _pm_shared."""
        import sys
        hooks_dir = str(Path(__file__).resolve().parent.parent)
        if hooks_dir not in sys.path:
            sys.path.insert(0, hooks_dir)
        from _pm_shared import _DEBT_MARKER_EXEMPT_PATHS  # noqa: PLC0415
        self.assertIsInstance(_DEBT_MARKER_EXEMPT_PATHS, tuple)
        self.assertGreater(len(_DEBT_MARKER_EXEMPT_PATHS), 0)
        # Must include the hook itself and pm skill directory
        joined = " ".join(_DEBT_MARKER_EXEMPT_PATHS)
        self.assertIn("verify-pm-handoff-clean.py", joined,
                      "verify-pm-handoff-clean.py must be in exempt paths")
        self.assertIn("squads/sdd/skills/pm/", joined,
                      "squads/sdd/skills/pm/ must be in exempt paths")

    def test_exempt_path_marker_not_blocked(self):
        """A file under an exempt path prefix must not trigger a block.

        This is a unit-level test of the exemption logic in _pm_shared directly.
        The hook integration test for real exempt files (e.g. pm/skill.md) cannot
        run in isolation (they live in the real working tree, not a tmp dir), so
        we test the shared helper's _is_exempt function directly.
        """
        import sys
        hooks_dir = str(Path(__file__).resolve().parent.parent)
        if hooks_dir not in sys.path:
            sys.path.insert(0, hooks_dir)
        from _pm_shared import _is_exempt  # noqa: PLC0415

        with tempfile.TemporaryDirectory() as tmp_str:
            root = Path(tmp_str)
            # Create a fake "squads/sdd/skills/pm/skill.md" under tmp root
            exempt_file = root / "squads" / "sdd" / "skills" / "pm" / "skill.md"
            exempt_file.parent.mkdir(parents=True, exist_ok=True)
            exempt_file.write_text("# TODO: doc marker\n", encoding="utf-8")
            self.assertTrue(
                _is_exempt(exempt_file, root),
                f"skill.md should be recognized as exempt: {exempt_file}",
            )

            # A non-exempt file should NOT be exempt
            real_file = root / "src" / "app.py"
            real_file.parent.mkdir(parents=True, exist_ok=True)
            real_file.write_text("# TODO: real debt\n", encoding="utf-8")
            self.assertFalse(
                _is_exempt(real_file, root),
                f"src/app.py should NOT be exempt: {real_file}",
            )


if __name__ == "__main__":
    unittest.main()
