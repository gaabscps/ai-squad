#!/usr/bin/env python3
"""
Tests for _pm_shared.py helpers.

Covers:
  - enumerate_working_tree_files: git ls-files path + fallback rglob + excludes
  - grep_debt_markers: each canonical marker, word-boundary, file/line/snippet
  - atomic_manifest_mutate: reads JSON, applies mutator, atomically writes result

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_pm_shared
OR:
  python3 squads/sdd/hooks/__tests__/test_pm_shared.py
"""
import importlib.util
import json
import multiprocessing
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

# ---------------------------------------------------------------------------
# Module loading
# ---------------------------------------------------------------------------
_HOOKS_DIR = Path(__file__).resolve().parent.parent
_MOD_FILE = _HOOKS_DIR / "_pm_shared.py"

_spec = importlib.util.spec_from_file_location("_pm_shared", _MOD_FILE)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

enumerate_working_tree_files = _mod.enumerate_working_tree_files
grep_debt_markers = _mod.grep_debt_markers
atomic_manifest_mutate = _mod.atomic_manifest_mutate

# Canonical pattern used by verify-pm-handoff-clean.py (T-004).
# @skip and mock-only cannot use pure \b anchoring because @ and - are
# non-word characters; they use lookahead/lookaround instead.
# \b anchors TODO/FIXME/xfail/pending against identifier false-positives.
#
# Lookahead uses (?![-\w]) (not just (?!\w)) so that a trailing hyphen also
# blocks the match — e.g. "mock-only-fixture" must NOT match "mock-only", and
# "@skip-slow" must NOT match "@skip".
_CANONICAL_PATTERN = r"\b(TODO|FIXME|xfail|pending)\b|(?<!\w)(@skip)(?![-\w])|(?<!\w)(mock-only)(?![-\w])"


# ===========================================================================
# enumerate_working_tree_files — git path
# ===========================================================================


class TestEnumerateGitPath(unittest.TestCase):
    """When root is a real git tree, results come from git ls-files."""

    def setUp(self):
        self.repo_root = Path(_HOOKS_DIR).parents[2]  # ai-squad/

    def test_returns_list(self):
        result = enumerate_working_tree_files(self.repo_root)
        self.assertIsInstance(result, list)
        self.assertGreater(len(result), 0)

    def test_all_paths_are_path_objects(self):
        result = enumerate_working_tree_files(self.repo_root)
        for p in result:
            self.assertIsInstance(p, Path, f"Not a Path: {p!r}")

    def test_paths_are_absolute(self):
        result = enumerate_working_tree_files(self.repo_root)
        for p in result:
            self.assertTrue(p.is_absolute(), f"Non-absolute: {p}")

    def test_excludes_agent_session(self):
        result = enumerate_working_tree_files(self.repo_root)
        for p in result:
            self.assertNotIn(
                ".agent-session", p.parts,
                f"Should exclude .agent-session: {p}",
            )

    def test_excludes_node_modules(self):
        result = enumerate_working_tree_files(self.repo_root)
        for p in result:
            self.assertNotIn(
                "node_modules", p.parts,
                f"Should exclude node_modules: {p}",
            )


# ===========================================================================
# enumerate_working_tree_files — fallback (non-git dir)
# ===========================================================================


class TestEnumerateFallback(unittest.TestCase):
    """When outside a git tree, falls back to rglob with hard-coded excludes."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _make(self, rel: str, content: str = "x") -> Path:
        p = self.tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p

    def test_returns_files(self):
        self._make("file_a.txt", "hello")
        self._make("file_b.py", "world")
        result = enumerate_working_tree_files(self.tmp)
        names = {p.name for p in result}
        self.assertIn("file_a.txt", names)
        self.assertIn("file_b.py", names)

    def test_paths_absolute(self):
        self._make("x.py")
        result = enumerate_working_tree_files(self.tmp)
        for p in result:
            self.assertTrue(p.is_absolute())

    def test_excludes_agent_session(self):
        self._make(".agent-session/secret.md", "TODO: do not scan this")
        self._make("real.py", "code here")
        result = enumerate_working_tree_files(self.tmp)
        names = {p.name for p in result}
        self.assertNotIn("secret.md", names)
        self.assertIn("real.py", names)

    def test_excludes_node_modules(self):
        self._make("node_modules/vendor.js", "vendored")
        self._make("src.py", "src")
        result = enumerate_working_tree_files(self.tmp)
        names = {p.name for p in result}
        self.assertNotIn("vendor.js", names)
        self.assertIn("src.py", names)

    def test_excludes_vendor(self):
        self._make("vendor/dep.py", "dep")
        self._make("main.py", "main")
        result = enumerate_working_tree_files(self.tmp)
        names = {p.name for p in result}
        self.assertNotIn("dep.py", names)
        self.assertIn("main.py", names)

    def test_excludes_dist(self):
        self._make("dist/bundle.js", "bundled")
        self._make("main.py", "main")
        result = enumerate_working_tree_files(self.tmp)
        names = {p.name for p in result}
        self.assertNotIn("bundle.js", names)
        self.assertIn("main.py", names)

    def test_excludes_build(self):
        self._make("build/out.js", "out")
        self._make("main.py", "main")
        result = enumerate_working_tree_files(self.tmp)
        names = {p.name for p in result}
        self.assertNotIn("out.js", names)
        self.assertIn("main.py", names)

    def test_excludes_next(self):
        self._make(".next/cache.js", "cached")
        self._make("page.py", "page")
        result = enumerate_working_tree_files(self.tmp)
        names = {p.name for p in result}
        self.assertNotIn("cache.js", names)
        self.assertIn("page.py", names)

    def test_excludes_git_dir(self):
        self._make(".git/config", "git config")
        self._make("main.py", "main")
        result = enumerate_working_tree_files(self.tmp)
        names = {p.name for p in result}
        self.assertNotIn("config", names)
        self.assertIn("main.py", names)

    def test_empty_dir_returns_empty_list(self):
        result = enumerate_working_tree_files(self.tmp)
        self.assertEqual(result, [])


# ===========================================================================
# grep_debt_markers
# ===========================================================================


class TestGrepDebtMarkersBasic(unittest.TestCase):
    """Basic detection and structure of match results."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _make(self, name: str, content: str) -> Path:
        p = self.tmp / name
        p.write_text(content, encoding="utf-8")
        return p

    def test_returns_list(self):
        f = self._make("f.py", "# TODO: fix me\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertIsInstance(result, list)

    def test_empty_files_no_matches(self):
        f = self._make("clean.py", "x = 1\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertEqual(result, [])

    def test_empty_file_list(self):
        result = grep_debt_markers([], [_CANONICAL_PATTERN])
        self.assertEqual(result, [])

    def test_result_has_required_keys(self):
        f = self._make("f.py", "# TODO: check\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertEqual(len(result), 1)
        entry = result[0]
        for key in ("file", "line", "marker", "snippet"):
            self.assertIn(key, entry, f"Missing key: {key}")

    def test_file_is_absolute_path_string(self):
        f = self._make("f.py", "# TODO: check\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertTrue(Path(result[0]["file"]).is_absolute())

    def test_line_number_correct(self):
        content = "x = 1\ny = 2\n# TODO: on line 3\nz = 3\n"
        f = self._make("f.py", content)
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["line"], 3)

    def test_snippet_contains_marker(self):
        f = self._make("f.py", "# TODO: fix this thing\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertIn("TODO", result[0]["snippet"])

    def test_snippet_stripped(self):
        f = self._make("f.py", "    # TODO: indented\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        snippet = result[0]["snippet"]
        self.assertEqual(snippet, snippet.strip())


class TestGrepDebtMarkersCanonical(unittest.TestCase):
    """Each canonical debt marker is independently detected."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _test_marker(self, marker: str):
        safe_name = marker.replace("@", "AT").replace("-", "_")
        content = f"# {marker}: something here\n"
        f = self.tmp / f"file_{safe_name}.py"
        f.write_text(content, encoding="utf-8")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertEqual(len(result), 1, f"Expected 1 match for {marker!r}, got {result}")
        self.assertEqual(result[0]["marker"], marker)

    def test_detects_TODO(self):
        self._test_marker("TODO")

    def test_detects_FIXME(self):
        self._test_marker("FIXME")

    def test_detects_xfail(self):
        self._test_marker("xfail")

    def test_detects_at_skip(self):
        self._test_marker("@skip")

    def test_detects_pending(self):
        self._test_marker("pending")

    def test_detects_mock_only(self):
        self._test_marker("mock-only")


class TestGrepDebtMarkersEdgeCases(unittest.TestCase):
    """Word-boundary behavior and multi-file/multi-marker scenarios."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _make(self, name: str, content: str) -> Path:
        p = self.tmp / name
        p.write_text(content, encoding="utf-8")
        return p

    def test_no_false_positive_pending_in_identifier(self):
        """'pending_human' must NOT match because \bpending\b fails at underscore boundary."""
        f = self._make("f.py", "pending_human = True\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        markers = [r["marker"] for r in result]
        self.assertNotIn("pending", markers)

    def test_multiple_markers_in_file(self):
        content = "# TODO: first\n# FIXME: second\nclean line\n"
        f = self._make("f.py", content)
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertEqual(len(result), 2)
        markers = {r["marker"] for r in result}
        self.assertIn("TODO", markers)
        self.assertIn("FIXME", markers)

    def test_multiple_files(self):
        f1 = self._make("a.py", "# TODO: in a\n")
        f2 = self._make("b.py", "# FIXME: in b\n")
        result = grep_debt_markers([f1, f2], [_CANONICAL_PATTERN])
        self.assertEqual(len(result), 2)

    def test_skip_missing_file(self):
        """Missing file is skipped without crashing."""
        ghost = self.tmp / "nonexistent.py"
        result = grep_debt_markers([ghost], [_CANONICAL_PATTERN])
        self.assertEqual(result, [])

    def test_large_file_stream_safe(self):
        """Function handles large files without loading entire file into memory."""
        lines = [f"x = {i}\n" for i in range(50_000)]
        lines[25_000] = "# TODO: in the middle\n"
        f = self._make("large.py", "".join(lines))
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["line"], 25_001)  # 1-indexed

    def test_line_numbers_correct_multi_match(self):
        content = "# TODO: line 1\nclean\n# FIXME: line 3\n"
        f = self._make("f.py", content)
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        result.sort(key=lambda r: r["line"])
        self.assertEqual(result[0]["line"], 1)
        self.assertEqual(result[1]["line"], 3)


# ===========================================================================
# atomic_manifest_mutate
# ===========================================================================


class TestAtomicManifestMutate(unittest.TestCase):
    """atomic_manifest_mutate reads, applies mutator, atomically writes manifest."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _write_manifest(self, data: dict) -> Path:
        p = self.tmp / "dispatch-manifest.json"
        p.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return p

    def test_basic_mutate(self):
        manifest = self._write_manifest({"schema_version": 1, "actual_dispatches": []})

        def add_field(doc: dict) -> dict:
            doc["pm_sessions"] = []
            return doc

        atomic_manifest_mutate(manifest, add_field)
        result = json.loads(manifest.read_text())
        self.assertEqual(result["pm_sessions"], [])
        self.assertEqual(result["schema_version"], 1)

    def test_mutator_receives_dict(self):
        manifest = self._write_manifest({"foo": "bar"})
        received = []

        def capture(doc: dict) -> dict:
            received.append(type(doc).__name__)
            return doc

        atomic_manifest_mutate(manifest, capture)
        self.assertEqual(received, ["dict"])

    def test_append_to_array(self):
        manifest = self._write_manifest({"pm_sessions": []})
        entry = {"session_id": "s-001", "cost_usd": 0.05}

        def append_entry(doc: dict) -> dict:
            doc.setdefault("pm_sessions", []).append(entry)
            return doc

        atomic_manifest_mutate(manifest, append_entry)
        result = json.loads(manifest.read_text())
        self.assertEqual(len(result["pm_sessions"]), 1)
        self.assertEqual(result["pm_sessions"][0]["session_id"], "s-001")

    def test_original_fields_preserved(self):
        original = {
            "schema_version": 1,
            "task_id": "FEAT-004",
            "actual_dispatches": [{"dispatch_id": "d-001"}],
        }
        manifest = self._write_manifest(original)

        atomic_manifest_mutate(manifest, lambda d: {**d, "pm_sessions": []})
        result = json.loads(manifest.read_text())
        self.assertEqual(result["schema_version"], 1)
        self.assertEqual(result["task_id"], "FEAT-004")
        self.assertEqual(result["actual_dispatches"][0]["dispatch_id"], "d-001")

    def test_result_is_valid_json(self):
        manifest = self._write_manifest({"x": 1})
        atomic_manifest_mutate(manifest, lambda d: {**d, "y": 2})
        result = json.loads(manifest.read_text(encoding="utf-8"))
        self.assertEqual(result["y"], 2)

    def test_concurrent_writes_produce_valid_json(self):
        """Concurrent atomic_manifest_mutate calls produce valid JSON (no torn writes)."""
        manifest = self._write_manifest({"counter": 0})
        errors = []

        def increment(doc: dict) -> dict:
            doc["counter"] = doc.get("counter", 0) + 1
            return doc

        def worker():
            try:
                atomic_manifest_mutate(manifest, increment)
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [], f"Concurrent errors: {errors}")
        result = json.loads(manifest.read_text(encoding="utf-8"))
        self.assertIsInstance(result["counter"], int)
        self.assertGreater(result["counter"], 0)

    def test_raises_on_missing_file(self):
        ghost = self.tmp / "nonexistent.json"
        with self.assertRaises(Exception):
            atomic_manifest_mutate(ghost, lambda d: d)

    def test_raises_on_invalid_json(self):
        bad = self.tmp / "bad.json"
        bad.write_text("this is not json", encoding="utf-8")
        with self.assertRaises(Exception):
            atomic_manifest_mutate(bad, lambda d: d)

    def test_manifest_exists_after_mutate(self):
        """File exists at the original path after atomic rename."""
        manifest = self._write_manifest({"ok": True})
        atomic_manifest_mutate(manifest, lambda d: {**d, "done": True})
        self.assertTrue(manifest.exists())
        result = json.loads(manifest.read_text())
        self.assertTrue(result["done"])


# ===========================================================================
# f-001: cross-process atomic_manifest_mutate (multiprocessing, stable inode)
# ===========================================================================


def _increment_worker(manifest_path_str: str, results_queue) -> None:  # type: ignore[type-arg]
    """Worker function run in a separate OS process; increments counter."""
    # Re-import the module in the child process (fresh interpreter state).
    import importlib.util
    from pathlib import Path

    _hooks_dir = Path(__file__).resolve().parent.parent
    _mod_file = _hooks_dir / "_pm_shared.py"
    _spec = importlib.util.spec_from_file_location("_pm_shared", _mod_file)
    _mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
    _spec.loader.exec_module(_mod)  # type: ignore[union-attr]
    atomic_manifest_mutate = _mod.atomic_manifest_mutate

    manifest_path = Path(manifest_path_str)
    try:
        atomic_manifest_mutate(manifest_path, lambda d: {**d, "counter": d.get("counter", 0) + 1})
        results_queue.put(("ok", None))
    except Exception as exc:
        results_queue.put(("err", str(exc)))


class TestAtomicManifestMutateCrossProcess(unittest.TestCase):
    """f-001: sidecar-lock strategy survives cross-process concurrent access."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _write_manifest(self, data: dict) -> Path:
        p = self.tmp / "dispatch-manifest.json"
        p.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return p

    def test_cross_process_no_torn_write(self):
        """N concurrent OS processes must each complete without error (no torn JSON)."""
        manifest = self._write_manifest({"counter": 0})
        n_procs = 8
        results_queue: multiprocessing.Queue = multiprocessing.Queue()

        procs = [
            multiprocessing.Process(
                target=_increment_worker,
                args=(str(manifest), results_queue),
            )
            for _ in range(n_procs)
        ]
        for p in procs:
            p.start()
        for p in procs:
            p.join(timeout=15)

        # Collect results
        outcomes = [results_queue.get_nowait() for _ in range(n_procs)]
        errors = [msg for status, msg in outcomes if status == "err"]
        self.assertEqual(errors, [], f"Cross-process errors: {errors}")

        # Final JSON must be parseable and counter > 0.
        result = json.loads(manifest.read_text(encoding="utf-8"))
        self.assertIsInstance(result["counter"], int)
        self.assertGreater(result["counter"], 0, "Counter never incremented")

    def test_cross_process_sidecar_lock_file_created(self):
        """Sidecar .lock file is created beside the manifest after mutation."""
        manifest = self._write_manifest({"x": 1})
        atomic_manifest_mutate(manifest, lambda d: {**d, "x": 2})
        lock_file = manifest.parent / (manifest.name + ".lock")
        self.assertTrue(lock_file.exists(), f"Sidecar lock not found: {lock_file}")

    def test_cross_process_manifest_still_valid_after_race(self):
        """Manifest remains valid JSON even when two processes race back-to-back."""
        manifest = self._write_manifest({"items": []})
        results_queue: multiprocessing.Queue = multiprocessing.Queue()

        procs = [
            multiprocessing.Process(
                target=_increment_worker,
                args=(str(manifest), results_queue),
            )
            for _ in range(4)
        ]
        for p in procs:
            p.start()
        for p in procs:
            p.join(timeout=10)

        result = json.loads(manifest.read_text(encoding="utf-8"))
        self.assertIn("counter", result)


# ===========================================================================
# f-002: suffix-hyphen boundary — @skip and mock-only
# ===========================================================================


class TestGrepDebtMarkersSuffixHyphen(unittest.TestCase):
    """f-002: trailing hyphen must NOT trigger a match for @skip or mock-only."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _make(self, name: str, content: str) -> Path:
        p = self.tmp / name
        p.write_text(content, encoding="utf-8")
        return p

    def test_mock_only_hyphen_suffix_no_match(self):
        """'mock-only-fixture' must NOT match 'mock-only'."""
        f = self._make("f.py", "# mock-only-fixture is not a debt marker\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        markers = [r["marker"] for r in result]
        self.assertNotIn("mock-only", markers, f"False positive: {result}")

    def test_mock_only_standalone_matches(self):
        """Standalone 'mock-only' must still match."""
        f = self._make("f.py", "# mock-only\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        markers = [r["marker"] for r in result]
        self.assertIn("mock-only", markers)

    def test_mock_only_at_end_of_line_matches(self):
        """'mock-only' at end of line (no trailing char) must match."""
        f = self._make("f.py", "x = mock-only")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        markers = [r["marker"] for r in result]
        self.assertIn("mock-only", markers)

    def test_skip_hyphen_suffix_no_match(self):
        """'@skip-slow' must NOT match '@skip'."""
        f = self._make("f.py", "# @skip-slow is not a bare marker\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        markers = [r["marker"] for r in result]
        self.assertNotIn("@skip", markers, f"False positive: {result}")

    def test_skip_standalone_matches(self):
        """Standalone '@skip' must still match."""
        f = self._make("f.py", "# @skip\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        markers = [r["marker"] for r in result]
        self.assertIn("@skip", markers)

    def test_mock_only_word_prefix_no_match(self):
        """'nomock-only' (word char before) must NOT match."""
        f = self._make("f.py", "nomock-only = True\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        markers = [r["marker"] for r in result]
        self.assertNotIn("mock-only", markers)

    def test_mock_only_followed_by_space_matches(self):
        """'mock-only some description' must match (space after is fine)."""
        f = self._make("f.py", "# mock-only some description\n")
        result = grep_debt_markers([f], [_CANONICAL_PATTERN])
        markers = [r["marker"] for r in result]
        self.assertIn("mock-only", markers)


# ===========================================================================
# f-003: rglob fallback .gitignore divergence (doc-assertion)
# ===========================================================================


class TestRglobGitignoreDivergence(unittest.TestCase):
    """f-003: document and test-assert that rglob fallback ignores .gitignore."""

    def test_rglob_docstring_documents_gitignore_limitation(self):
        """_rglob_files docstring must mention the .gitignore divergence."""
        rglob_files = _mod._rglob_files
        doc = rglob_files.__doc__ or ""
        self.assertIn(
            ".gitignore",
            doc,
            "_rglob_files docstring must document the .gitignore divergence (f-003)",
        )

    def test_rglob_fallback_does_not_filter_gitignored_file(self):
        """rglob fallback returns files that would normally be git-ignored.

        In a non-git temp directory, a file whose name would typically appear
        in a .gitignore (e.g. *.log) is returned by the fallback because the
        fallback has no access to .gitignore rules.  This test documents the
        known limitation: rglob and git-path can diverge on .gitignore scope.
        """
        tmp = Path(tempfile.mkdtemp())
        # Create a .gitignore that would exclude *.log
        (tmp / ".gitignore").write_text("*.log\n", encoding="utf-8")
        # Create a file that would be ignored by git
        log_file = tmp / "debug.log"
        log_file.write_text("log output\n", encoding="utf-8")
        # Create a normal source file
        src_file = tmp / "main.py"
        src_file.write_text("x = 1\n", encoding="utf-8")

        # The fallback rglob path returns the .log file even though .gitignore
        # would exclude it — this is the documented divergence.
        rglob_files = _mod._rglob_files
        result = rglob_files(tmp)
        names = {p.name for p in result}
        self.assertIn(
            "debug.log",
            names,
            "rglob fallback should return .gitignore-excluded files (known divergence from git path)",
        )
        self.assertIn("main.py", names)


# ===========================================================================
# FEAT-005 T-001/T-002: _is_exempt — expanded paths + glob support
# AC-001, AC-002, AC-003, AC-004
# ===========================================================================

_is_exempt = _mod._is_exempt


class TestIsExemptExpandedPaths(unittest.TestCase):
    """AC-001/AC-002: new exempt prefixes cover docs/, shared/concepts/,
    squads/sdd/skills/, and the three __tests__/ subdirectories."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def _make(self, rel: str) -> Path:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("TODO: marker here", encoding="utf-8")
        return p

    # AC-001 — docs/
    def test_docs_dir_is_exempt(self):
        f = self._make("docs/tech-debt.md")
        self.assertTrue(_is_exempt(f, self.root), "docs/ file must be exempt (AC-001)")

    # AC-001 — shared/concepts/
    def test_shared_concepts_is_exempt(self):
        f = self._make("shared/concepts/pm-bypass.md")
        self.assertTrue(_is_exempt(f, self.root), "shared/concepts/ file must be exempt (AC-001)")

    # AC-001 — squads/sdd/skills/
    def test_squads_sdd_skills_is_exempt(self):
        f = self._make("squads/sdd/skills/pm/skill.md")
        self.assertTrue(_is_exempt(f, self.root), "squads/sdd/skills/ file must be exempt (AC-001)")

    # AC-002 — squads/sdd/hooks/__tests__/
    def test_hooks_tests_is_exempt(self):
        f = self._make("squads/sdd/hooks/__tests__/test_foo.py")
        self.assertTrue(_is_exempt(f, self.root), "hooks/__tests__/ file must be exempt (AC-002)")

    # AC-002 — squads/sdd/agents/__tests__/
    def test_agents_tests_is_exempt(self):
        f = self._make("squads/sdd/agents/__tests__/test_bar.md")
        self.assertTrue(_is_exempt(f, self.root), "agents/__tests__/ file must be exempt (AC-002)")

    # AC-002 — squads/sdd/skills/__tests__/
    def test_skills_tests_is_exempt(self):
        f = self._make("squads/sdd/skills/__tests__/test_baz.md")
        self.assertTrue(_is_exempt(f, self.root), "skills/__tests__/ file must be exempt (AC-002)")

    # AC-004 — real source file outside all exempt paths must NOT be exempt
    def test_non_exempt_file_not_skipped(self):
        f = self._make("packages/agentops/src/index.ts")
        self.assertFalse(_is_exempt(f, self.root), "non-exempt file must not be skipped (AC-004)")

    # AC-004 — file that matches multiple exempt prefixes is still just exempt (no crash)
    def test_multiple_prefix_match_no_double_processing(self):
        # squads/sdd/skills/ AND squads/sdd/skills/__tests__/ both apply
        f = self._make("squads/sdd/skills/__tests__/fixture.py")
        # Simply checking that it returns True without crashing is the assertion
        result = _is_exempt(f, self.root)
        self.assertTrue(result, "file matching multiple prefixes must still be exempt (AC-004)")

    # AC-001 — exact-equality branch: literal filename entry matches exactly
    def test_exact_literal_filename_matches(self):
        """rel == prefix branch: a literal filename exempt entry matches exactly."""
        original = _mod._DEBT_MARKER_EXEMPT_PATHS
        try:
            _mod._DEBT_MARKER_EXEMPT_PATHS = (
                "squads/sdd/hooks/verify-pm-handoff-clean.py",
            )
            f = self._make("squads/sdd/hooks/verify-pm-handoff-clean.py")
            self.assertTrue(
                _is_exempt(f, self.root),
                "literal filename entry must match via rel == prefix (AC-001)",
            )
        finally:
            _mod._DEBT_MARKER_EXEMPT_PATHS = original

    # AC-004 — trailing-slash prefix must NOT match sibling dir with shared prefix
    def test_docs_prefix_does_not_match_docs2_dir(self):
        """'docs/' prefix must NOT match 'docs2/foo.py' (trailing-slash boundary)."""
        original = _mod._DEBT_MARKER_EXEMPT_PATHS
        try:
            _mod._DEBT_MARKER_EXEMPT_PATHS = ("docs/",)
            f = self._make("docs2/foo.py")
            self.assertFalse(
                _is_exempt(f, self.root),
                "'docs/' must not match 'docs2/foo.py' (AC-004 prefix false-positive)",
            )
        finally:
            _mod._DEBT_MARKER_EXEMPT_PATHS = original

    # AC-004 — file outside root must return False (ValueError branch)
    def test_file_outside_root_returns_false(self):
        """_is_exempt returns False when file_path resolves outside root."""
        other_tmp = Path(tempfile.mkdtemp())
        outside_file = other_tmp / "secret.py"
        outside_file.write_text("TODO: outside root", encoding="utf-8")
        self.assertFalse(
            _is_exempt(outside_file, self.root),
            "file outside root must return False (AC-004 ValueError branch)",
        )

    # as_posix() produces forward slashes on all platforms
    def test_forward_slash_path_separator_for_all_exempt_prefixes(self):
        """_is_exempt must work for every expanded prefix regardless of OS path separator.

        The as_posix() fix ensures rel uses '/' not '\\' so startswith("docs/")
        works correctly cross-platform (AC-001/AC-002).
        """
        exempt_cases = [
            "docs/tech-debt.md",
            "shared/concepts/something.md",
            "squads/sdd/skills/pm/skill.md",
            "squads/sdd/hooks/__tests__/test_foo.py",
            "squads/sdd/agents/__tests__/test_bar.py",
            "squads/sdd/skills/__tests__/test_baz.py",
        ]
        for rel_path in exempt_cases:
            f = self._make(rel_path)
            self.assertTrue(
                _is_exempt(f, self.root),
                f"as_posix() fix: {rel_path!r} must be exempt on all platforms",
            )


class TestIsExemptGlobSupport(unittest.TestCase):
    """AC-003: glob patterns (containing * or ?) in _DEBT_MARKER_EXEMPT_PATHS
    must be matched via fnmatch.fnmatch() instead of startswith()."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def _make(self, rel: str) -> Path:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("TODO: marker here", encoding="utf-8")
        return p

    def test_glob_pattern_matches_via_fnmatch(self):
        """Inject a glob entry into _DEBT_MARKER_EXEMPT_PATHS and verify _is_exempt dispatches via fnmatch."""
        original = _mod._DEBT_MARKER_EXEMPT_PATHS
        try:
            _mod._DEBT_MARKER_EXEMPT_PATHS = ("test_dir/*.py",)
            matching = self._make("test_dir/helpers.py")
            non_matching = self._make("other_dir/helpers.py")
            self.assertTrue(
                _is_exempt(matching, self.root),
                "glob entry 'test_dir/*.py' must match test_dir/helpers.py via fnmatch (AC-003)",
            )
            self.assertFalse(
                _is_exempt(non_matching, self.root),
                "glob entry 'test_dir/*.py' must NOT match other_dir/helpers.py (AC-003)",
            )
        finally:
            _mod._DEBT_MARKER_EXEMPT_PATHS = original

    def test_glob_added_to_exempt_list_matches_via_fnmatch(self):
        """When _DEBT_MARKER_EXEMPT_PATHS contains a glob, _is_exempt uses fnmatch."""
        # Temporarily patch the module-level list to inject a glob entry
        original = _mod._DEBT_MARKER_EXEMPT_PATHS
        try:
            _mod._DEBT_MARKER_EXEMPT_PATHS = original + ("docs/*.md",)
            f = self._make("docs/tech-debt.md")
            self.assertTrue(
                _is_exempt(f, self.root),
                "glob entry in exempt list must match via fnmatch (AC-003)",
            )
        finally:
            _mod._DEBT_MARKER_EXEMPT_PATHS = original

    def test_question_mark_wildcard_matches_single_char(self):
        """'?' wildcard in exempt entry matches exactly one character via fnmatch (AC-003)."""
        original = _mod._DEBT_MARKER_EXEMPT_PATHS
        try:
            _mod._DEBT_MARKER_EXEMPT_PATHS = (
                "squads/sdd/hooks/verify-pm-hand?.py",
            )
            f = self._make("squads/sdd/hooks/verify-pm-hando.py")
            self.assertTrue(
                _is_exempt(f, self.root),
                "'?' glob entry must match single-char wildcard via fnmatch (AC-003)",
            )
            non_matching = self._make("squads/sdd/hooks/verify-pm-handoff-clean.py")
            self.assertFalse(
                _is_exempt(non_matching, self.root),
                "'?' must NOT match multi-char segment (AC-003)",
            )
        finally:
            _mod._DEBT_MARKER_EXEMPT_PATHS = original

    def test_glob_star_does_not_match_outside_pattern(self):
        """A glob pattern must not over-match files outside its scope."""
        original = _mod._DEBT_MARKER_EXEMPT_PATHS
        try:
            _mod._DEBT_MARKER_EXEMPT_PATHS = ("docs/*.md",)
            f = self._make("packages/agentops/src/index.ts")
            self.assertFalse(
                _is_exempt(f, self.root),
                "glob entry must not match unrelated paths (AC-003/AC-004)",
            )
        finally:
            _mod._DEBT_MARKER_EXEMPT_PATHS = original

    def test_literal_prefix_still_works_when_glob_entries_present(self):
        """Literal prefix entries continue to work when glob entries co-exist."""
        original = _mod._DEBT_MARKER_EXEMPT_PATHS
        try:
            _mod._DEBT_MARKER_EXEMPT_PATHS = ("docs/", "squads/*.md")
            f = self._make("docs/notes.txt")
            self.assertTrue(
                _is_exempt(f, self.root),
                "literal prefix must still work alongside glob entries (AC-003)",
            )
        finally:
            _mod._DEBT_MARKER_EXEMPT_PATHS = original


if __name__ == "__main__":
    unittest.main()
