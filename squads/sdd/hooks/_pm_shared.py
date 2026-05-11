"""
Shared helpers for FEAT-004 PM enforcement hooks.

Used by:
  - verify-pm-handoff-clean.py  (T-004 / AC-001)
  - verify-tier-calibration.py  (T-008/T-009 / AC-005)
  - capture-pm-usage.py         (T-016 / AC-013)

Python 3.8+. No external dependencies (stdlib only).
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

# ---------------------------------------------------------------------------
# Hard-coded exclude prefixes for the fallback rglob path.
# These are relative top-level directory names (not nested paths).
# ---------------------------------------------------------------------------
_FALLBACK_EXCLUDES: tuple[str, ...] = (
    ".agent-session",
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".next",
    ".git",
)


def enumerate_working_tree_files(root: Path) -> list[Path]:
    """Return all relevant source files under *root*.

    Strategy (in order):
      1. Try ``git ls-files -co --exclude-standard`` when *root* is inside a git
         working tree.  Paths returned by git are relative to the repo root; this
         function makes them absolute and filters out any path whose parts include
         one of the hard-coded exclude prefixes (e.g. ``.agent-session/``,
         ``node_modules/``).
      2. Fall back to ``Path.rglob("*")`` when git is unavailable or the directory
         is not inside a git working tree.  Applies the same exclude-prefix logic.

    Returns absolute ``Path`` objects.  Streaming: directories are never returned.
    """
    root = root.resolve()

    # --- attempt git path ---
    try:
        result = subprocess.run(
            ["git", "ls-files", "-co", "--exclude-standard"],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            paths: list[Path] = []
            for line in result.stdout.splitlines():
                line = line.strip()
                if not line:
                    continue
                # git ls-files returns paths relative to the repo root, but when
                # cwd=root the paths are relative to root.
                p = (root / line).resolve()
                if _is_excluded(p, root):
                    continue
                paths.append(p)
            return paths
    except (subprocess.SubprocessError, OSError, FileNotFoundError):
        pass

    # --- fallback: rglob ---
    return _rglob_files(root)


def _is_excluded(p: Path, root: Path) -> bool:
    """Return True if any component of *p* relative to *root* is an excluded name.

    Checks ALL path components (not only the top-level one) so that nested
    occurrences like ``packages/agentops/node_modules/`` are also excluded.
    """
    try:
        rel = p.relative_to(root)
    except ValueError:
        return False
    for part in rel.parts:
        if part in _FALLBACK_EXCLUDES:
            return True
    return False


def _rglob_files(root: Path) -> list[Path]:
    """Fallback: walk *root* with rglob, skip excluded top-level directories.

    Known limitation: this path does NOT honour ``.gitignore`` rules.  When
    ``git ls-files`` is available (primary path), git applies
    ``--exclude-standard`` which respects ``.gitignore``.  The rglob fallback
    only applies the hard-coded ``_FALLBACK_EXCLUDES`` prefix list.  As a
    result, files that are tracked by the repo (i.e. not git-ignored) but would
    be excluded by a user's ``.gitignore`` may appear in rglob results but not
    in the git-path results.  Introducing ``pathspec`` as an optional dependency
    was evaluated and rejected to keep the stdlib-only constraint (see spec
    constraint "No new external dependencies").  Callers in non-git environments
    should be aware of this divergence.
    """
    results: list[Path] = []
    for p in root.rglob("*"):
        if p.is_dir():
            continue
        if _is_excluded(p, root):
            continue
        results.append(p.resolve())
    return results


# ---------------------------------------------------------------------------
# grep_debt_markers
# ---------------------------------------------------------------------------


def grep_debt_markers(
    files: list[Path],
    patterns: list[str],
) -> list[dict]:
    """Scan *files* for debt markers matching any pattern in *patterns*.

    Uses Python's ``re`` module on a streaming line-by-line read to stay
    memory-safe on large files.  Each pattern is compiled as a ``re.Pattern``
    with word-boundary anchors baked into the pattern string itself (callers
    are expected to pass patterns like ``r"\\b(TODO|FIXME|...)\\b"``).

    Returns a list of dicts::

        {
            "file":    str  — absolute path to the file,
            "line":    int  — 1-indexed line number,
            "marker":  str  — the matched marker text,
            "snippet": str  — the stripped source line,
        }

    Unreadable or missing files are silently skipped (AC-003 scan_failed is
    handled at the hook level, not here).
    """
    compiled = [re.compile(pat) for pat in patterns]
    matches: list[dict] = []

    for file_path in files:
        try:
            with file_path.open("r", encoding="utf-8", errors="replace") as fh:
                for lineno, raw_line in enumerate(fh, start=1):
                    stripped = raw_line.rstrip("\n").strip()
                    for pat in compiled:
                        m = pat.search(stripped)
                        if m:
                            # When the pattern uses multiple capture groups (e.g.
                            # alternates for @skip and mock-only that can't use \b),
                            # pick the first non-None group so we always get the
                            # bare marker text (e.g. "@skip", not the full match).
                            groups = [g for g in m.groups() if g is not None]
                            marker = groups[0] if groups else m.group(0)
                            matches.append(
                                {
                                    "file": str(file_path.resolve()),
                                    "line": lineno,
                                    "marker": marker,
                                    "snippet": stripped,
                                }
                            )
                            break  # report each line once even if multiple patterns match
        except (OSError, IOError):
            # Missing or unreadable file — skip silently
            continue

    return matches


# ---------------------------------------------------------------------------
# atomic_manifest_mutate
# ---------------------------------------------------------------------------


def atomic_manifest_mutate(
    manifest_path: Path,
    mutator: Callable[[dict], dict],
) -> None:
    """Read *manifest_path* as JSON, apply *mutator*, write back atomically.

    Uses ``fcntl.LOCK_EX`` on a **sidecar lock file** (``<manifest>.lock``)
    rather than on the manifest itself.  This avoids a cross-process inode race:
    after ``os.replace`` the manifest gets a new inode, so any process that
    locked the original fd holds a lock that is invisible to a new opener.  The
    sidecar file's inode is stable — it is never renamed — so all concurrent
    processes contend on the same inode.

    Lock acquisition order:
      1. Open (or create) ``<manifest_path>.lock`` — never read/written, only
         used as a stable inode for the advisory lock.
      2. Acquire ``LOCK_EX`` on the sidecar fd.
      3. Open, read, mutate, and atomically write the manifest (tmp + rename).
      4. Release ``LOCK_EX`` on the sidecar fd (via context-manager exit).

    Raises ``FileNotFoundError`` if *manifest_path* does not exist.
    Raises ``json.JSONDecodeError`` if the file is not valid JSON.
    All other I/O errors propagate to the caller.

    Pattern mirrors ``capture-subagent-usage.py:update_manifest``.
    """
    manifest_path = manifest_path.resolve()
    lock_path = manifest_path.parent / (manifest_path.name + ".lock")

    # Raise FileNotFoundError early (before acquiring lock) when manifest absent.
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")

    # Open the sidecar lock file (creates it if absent; its content is never
    # read or written — it exists solely as a stable-inode lock target).
    with lock_path.open("a", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
        try:
            # Read the manifest while holding the lock.
            with manifest_path.open("r", encoding="utf-8") as fh:
                # May raise json.JSONDecodeError — propagate to caller.
                doc = json.load(fh)

            mutated = mutator(doc)

            # Write to a sibling tmp file, then atomically rename.
            tmp_dir = manifest_path.parent
            fd, tmp_path = tempfile.mkstemp(
                dir=str(tmp_dir),
                prefix=".tmp-manifest-",
                suffix=".json",
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as tmp_fh:
                    json.dump(mutated, tmp_fh, indent=2)
                    tmp_fh.write("\n")
                os.replace(tmp_path, str(manifest_path))
            except Exception:
                # Clean up tmp file on error, then re-raise.
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
        finally:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
