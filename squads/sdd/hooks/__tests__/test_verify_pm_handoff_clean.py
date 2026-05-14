#!/usr/bin/env python3
"""
Tests for verify-pm-handoff-clean.py.

Covers (T-008 scope — AC-014, AC-015, AC-016 plus prior ACs):
  AC-001 — each of 6 debt markers blocks Stop, evidence contains file:line
  AC-002 — zero matches → allow
  AC-004 — excluded paths (.agent-session/, node_modules/, vendor/, dist/,
            build/, .next/) are not scanned
  AC-014 — scan thread catches BaseException; hook emits scan_failed: <TypeName>
  AC-015 — _output_written sentinel ensures non-zero exit + block on unexpected exit
  AC-016 — tests cover AC-014 and AC-015 paths
  NFR-003 — refusal output is a valid markdown table

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_verify_pm_handoff_clean
OR:
  python3 squads/sdd/hooks/__tests__/test_verify_pm_handoff_clean.py
"""
import atexit
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Skill-scope gate stub (added with detect_active_skill gating in verify-pm-handoff-clean).
# The hook now refuses to scan unless the active Skill is positively
# identified as `pm`. Tests must simulate that context by providing a
# transcript file containing the Skill marker.
_PM_TRANSCRIPT = Path(tempfile.NamedTemporaryFile(
    mode="w", suffix=".jsonl", delete=False
).name)
_PM_TRANSCRIPT.write_text(
    "Base directory for this Skill: /tmp/.claude/skills/pm\n",
    encoding="utf-8",
)
atexit.register(lambda: _PM_TRANSCRIPT.unlink(missing_ok=True))

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
_BASE_PAYLOAD = {
    "stop_hook_active": False,
    "transcript_path": str(_PM_TRANSCRIPT),
}


def _make_hook_script(tmp: Path, fake_pm_shared_src: str) -> Path:
    """Return path to the copied hook script with fake _pm_shared injected.

    Copies the real hook script and hook_runtime.py into a sandbox directory
    under *tmp*, then writes *fake_pm_shared_src* as _pm_shared.py so the
    hook resolves the fake module instead of the real one.
    """
    hook_dir = tmp / "hook_sandbox"
    hook_dir.mkdir()

    shutil.copy(str(_HOOK_SCRIPT), str(hook_dir / "verify-pm-handoff-clean.py"))
    real_hook_runtime = _HOOKS_DIR / "hook_runtime.py"
    shutil.copy(str(real_hook_runtime), str(hook_dir / "hook_runtime.py"))
    (hook_dir / "_pm_shared.py").write_text(fake_pm_shared_src, encoding="utf-8")

    return hook_dir / "verify-pm-handoff-clean.py"


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
        # Annotation-prefix forms must block (fix for Issue #2: restrict pending
        # to intentional debt annotation syntax only).
        result = self._assert_blocks_with_marker(
            "pending", "@pending\n"
        )
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


# ===========================================================================
# AC-003 / NFR-001 — scan_failed fallback (T-005)
# ===========================================================================

class TestScanFailedFallback(unittest.TestCase):
    """AC-003 + NFR-001: when the scan errors or times out, the hook must block
    with reason starting with 'scan_failed:' — never silently allow.

    Injection strategy: copy the hook script + hook_runtime.py into a temp
    directory alongside a fake _pm_shared.py.  The hook computes
    _HOOKS_DIR = Path(__file__).resolve().parent, so running the copied script
    causes Python to resolve _pm_shared from the temp dir (fake) instead of
    the real hooks directory.
    """

    def test_scan_error_blocks_with_scan_failed_reason(self):
        """Patch enumerate_working_tree_files to raise; hook must block with scan_failed."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            fake_src = (
                'from pathlib import Path\n'
                '_DEBT_MARKER_EXEMPT_PATHS = ()\n'
                'def _is_exempt(f, r): return False\n'
                'def enumerate_working_tree_files(root):\n'
                '    raise RuntimeError("simulated scan error")\n'
                'def grep_debt_markers(files, patterns, root=None): return []\n'
                'def atomic_manifest_mutate(p, m): pass\n'
            )
            hook_script = _make_hook_script(tmp, fake_src)

            result = subprocess.run(
                [sys.executable, str(hook_script)],
                input=json.dumps({**_BASE_PAYLOAD, "cwd": tmp_str}),
                capture_output=True,
                text=True,
                timeout=10,
                env=os.environ,
            )
            stdout = result.stdout.strip()
            self.assertTrue(stdout, "Hook must emit JSON on scan error (not empty stdout)")
            out = json.loads(stdout)
            self.assertEqual(
                out.get("decision"), "block",
                f"scan error must block, got: {out}",
            )
            reason = out.get("reason", "")
            self.assertTrue(
                reason.startswith("scan_failed:"),
                f"reason must start with 'scan_failed:', got: {reason!r}",
            )
            # AC-014: reason must contain exception type name, not message string
            self.assertIn("RuntimeError", reason,
                          f"reason must contain exception type name 'RuntimeError': {reason!r}")

    def test_scan_error_never_allows(self):
        """Under no scan-error condition must the hook emit an allow decision."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            fake_src = (
                'from pathlib import Path\n'
                '_DEBT_MARKER_EXEMPT_PATHS = ()\n'
                'def _is_exempt(f, r): return False\n'
                'def enumerate_working_tree_files(root):\n'
                '    raise OSError("disk read error")\n'
                'def grep_debt_markers(files, patterns, root=None): return []\n'
                'def atomic_manifest_mutate(p, m): pass\n'
            )
            hook_script = _make_hook_script(tmp, fake_src)

            result = subprocess.run(
                [sys.executable, str(hook_script)],
                input=json.dumps({**_BASE_PAYLOAD, "cwd": tmp_str}),
                capture_output=True,
                text=True,
                timeout=10,
                env=os.environ,
            )
            stdout = result.stdout.strip()
            out = json.loads(stdout) if stdout else {}
            decision = out.get("decision", "allow")
            self.assertNotEqual(
                decision, "allow",
                f"scan error must never allow, got: {out}",
            )

    def test_timeout_blocks_with_scan_failed_reason(self):
        """A scan that exceeds the 4.5 s budget must block with scan_failed:timeout."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Fake _pm_shared that sleeps > 4.5 s (6 s) on enumerate.
            fake_src = (
                'import time\n'
                'from pathlib import Path\n'
                '_DEBT_MARKER_EXEMPT_PATHS = ()\n'
                'def _is_exempt(f, r): return False\n'
                'def enumerate_working_tree_files(root):\n'
                '    time.sleep(6)\n'
                '    return []\n'
                'def grep_debt_markers(files, patterns, root=None): return []\n'
                'def atomic_manifest_mutate(p, m): pass\n'
            )
            hook_script = _make_hook_script(tmp, fake_src)

            result = subprocess.run(
                [sys.executable, str(hook_script)],
                input=json.dumps({**_BASE_PAYLOAD, "cwd": tmp_str}),
                capture_output=True,
                text=True,
                timeout=15,   # outer subprocess guard (larger than hook budget)
                env=os.environ,
            )
            stdout = result.stdout.strip()
            self.assertTrue(stdout, "Hook must emit JSON on timeout (not empty stdout)")
            out = json.loads(stdout)
            self.assertEqual(
                out.get("decision"), "block",
                f"timeout must block, got: {out}",
            )
            reason = out.get("reason", "")
            self.assertTrue(
                reason.startswith("scan_failed:"),
                f"reason must start with 'scan_failed:' on timeout, got: {reason!r}",
            )
            self.assertIn("timeout", reason.lower(),
                          f"reason must mention 'timeout': {reason!r}")

    def test_nfr001_hook_completes_within_5s(self):
        """NFR-001: hook must complete within 5 s on a representative session tree."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Seed a representative small tree (no markers → allow path).
            for i in range(20):
                f = tmp / "src" / f"module_{i}.py"
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(f"# module {i}\ndef func(): return {i}\n", encoding="utf-8")
            payload = {**_BASE_PAYLOAD, "cwd": tmp_str}
            start = time.monotonic()
            result = _run_hook(payload)
            elapsed = time.monotonic() - start
            self.assertLess(
                elapsed, 5.0,
                f"NFR-001: hook took {elapsed:.2f}s (> 5s limit)",
            )
            decision = result.get("decision", "allow")
            self.assertEqual(decision, "allow",
                             f"Expected allow on clean tree, got: {result}")


# ===========================================================================
# AC-014, AC-015, AC-016 — BaseException + _output_written sentinel (T-008)
# ===========================================================================

class TestBaseExceptionSentinel(unittest.TestCase):
    """AC-014 / AC-015 / AC-016: BaseException in scan thread → hook emits block, not empty."""

    def test_system_exit_in_scan_thread_emits_block(self):
        """AC-014: SystemExit raised inside scan thread must cause hook to emit block."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Fake _pm_shared raises SystemExit inside enumerate_working_tree_files.
            fake_src = (
                'from pathlib import Path\n'
                '_DEBT_MARKER_EXEMPT_PATHS = ()\n'
                'def _is_exempt(f, r): return False\n'
                'def enumerate_working_tree_files(root):\n'
                '    raise SystemExit("simulated SystemExit in scan")\n'
                'def grep_debt_markers(files, patterns, root=None): return []\n'
                'def atomic_manifest_mutate(p, m): pass\n'
            )
            hook_script = _make_hook_script(tmp, fake_src)

            result = subprocess.run(
                [sys.executable, str(hook_script)],
                input=json.dumps({**_BASE_PAYLOAD, "cwd": tmp_str}),
                capture_output=True,
                text=True,
                timeout=10,
                env=os.environ,
            )
            stdout = result.stdout.strip()
            # AC-014: must emit non-empty JSON with decision=block
            self.assertTrue(
                stdout,
                "AC-014: hook must emit JSON even when SystemExit raised in scan thread (not empty stdout)",
            )
            out = json.loads(stdout)
            self.assertEqual(
                out.get("decision"), "block",
                f"AC-014: SystemExit in scan thread must emit block, got: {out}",
            )
            # AC-015: must exit non-zero
            self.assertNotEqual(
                result.returncode, 0,
                f"AC-015: hook must exit non-zero on scan BaseException, got returncode={result.returncode}",
            )
            # reason must match scan_failed: <TypeName> (not message string)
            reason = out.get("reason", "")
            self.assertRegex(
                reason,
                r"^scan_failed: [A-Za-z]+",
                f"AC-014: reason must be 'scan_failed: <TypeName>', got: {reason!r}",
            )
            self.assertIn(
                "SystemExit", reason,
                f"AC-014: reason must contain exception type name 'SystemExit', got: {reason!r}",
            )

    def test_base_exception_scan_never_silently_allows(self):
        """AC-015: hook must not silently allow when BaseException raised in scan."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            fake_src = (
                'from pathlib import Path\n'
                '_DEBT_MARKER_EXEMPT_PATHS = ()\n'
                'def _is_exempt(f, r): return False\n'
                'def enumerate_working_tree_files(root):\n'
                '    raise MemoryError("simulated MemoryError")\n'
                'def grep_debt_markers(files, patterns, root=None): return []\n'
                'def atomic_manifest_mutate(p, m): pass\n'
            )
            hook_script = _make_hook_script(tmp, fake_src)

            result = subprocess.run(
                [sys.executable, str(hook_script)],
                input=json.dumps({**_BASE_PAYLOAD, "cwd": tmp_str}),
                capture_output=True,
                text=True,
                timeout=10,
                env=os.environ,
            )
            stdout = result.stdout.strip()
            out = json.loads(stdout) if stdout else {}
            decision = out.get("decision", "allow")
            self.assertNotEqual(
                decision, "allow",
                f"AC-015: MemoryError in scan must never silently allow, got: {out}",
            )
            # AC-015: must exit non-zero
            self.assertNotEqual(
                result.returncode, 0,
                f"AC-015: hook must exit non-zero on scan BaseException, got returncode={result.returncode}",
            )

    def test_finally_sentinel_fires_on_unexpected_exception_in_main(self):
        """AC-016: _output_written sentinel must emit block if main() crashes unexpectedly."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Fake _pm_shared that makes grep_debt_markers raise after scan succeeds,
            # so the exception happens outside the thread (in main body) after _run_scan.
            fake_src = (
                'from pathlib import Path\n'
                '_DEBT_MARKER_EXEMPT_PATHS = ()\n'
                'def _is_exempt(f, r): return False\n'
                'def enumerate_working_tree_files(root):\n'
                '    return []\n'
                'class _BadResult:\n'
                '    def get(self, k, d=None):\n'
                '        raise RuntimeError("simulated crash in main after scan")\n'
                'def grep_debt_markers(files, patterns, root=None):\n'
                '    return _BadResult()\n'
                'def atomic_manifest_mutate(p, m): pass\n'
            )
            hook_script = _make_hook_script(tmp, fake_src)

            result = subprocess.run(
                [sys.executable, str(hook_script)],
                input=json.dumps({**_BASE_PAYLOAD, "cwd": tmp_str}),
                capture_output=True,
                text=True,
                timeout=10,
                env=os.environ,
            )
            stdout = result.stdout.strip()
            # AC-016: sentinel must have fired — stdout must contain block decision
            self.assertTrue(
                stdout,
                "AC-016: finally sentinel must emit block JSON when main() crashes (not empty stdout)",
            )
            out = json.loads(stdout)
            self.assertEqual(
                out.get("decision"), "block",
                f"AC-016: finally sentinel must emit block, got: {out}",
            )
            # AC-015: sentinel path must also exit non-zero
            self.assertNotEqual(
                result.returncode, 0,
                f"AC-015: finally sentinel must exit non-zero, got returncode={result.returncode}",
            )


if __name__ == "__main__":
    unittest.main()
