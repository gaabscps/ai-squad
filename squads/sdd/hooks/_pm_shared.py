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
import fnmatch
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

# ---------------------------------------------------------------------------
# Canonical exempt paths — files/directories whose content intentionally
# contains debt-marker tokens as part of their specification or documentation.
# These are skipped during debt-marker scanning to avoid self-referential
# false positives (e.g. the hook script itself documenting the marker list).
#
# Values are relative path prefixes from the project root (as returned by
# Path.relative_to(root)).  A file is exempt when its relative path starts
# with any of these prefix strings.
# ---------------------------------------------------------------------------
_DEBT_MARKER_EXEMPT_PATHS: tuple[str, ...] = (
    "squads/sdd/skills/pm/",
    "squads/sdd/hooks/verify-pm-handoff-clean.py",
    "squads/sdd/hooks/_pm_shared.py",
    # Avoid false positives when /pm runs on the ai-squad repo itself.
    "docs/",
    "shared/concepts/",
    "squads/sdd/skills/",
    "squads/sdd/hooks/__tests__/",
    "squads/sdd/agents/__tests__/",
    "squads/sdd/skills/__tests__/",
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
    """Return True if *p* should be skipped — excluded prefix or outside root.

    Two exclusion conditions:
      1. Symlink resolves outside *root* — e.g. a symlink pointing to /etc.
         Detected by resolving *p* and checking ``is_relative_to(root)``.
         Paths outside the working tree are always skipped (AC-004).
      2. Any component of *p* relative to *root* matches an excluded name
         (e.g. ``node_modules``, ``.agent-session``).  Checked across ALL
         path parts so nested occurrences like
         ``packages/agentops/node_modules/`` are also caught.
    """
    try:
        resolved = p.resolve()
        # Symlink (or any path) that resolves outside the working tree is skipped.
        resolved.relative_to(root)
    except ValueError:
        # resolve() succeeded but the result is not under root → skip.
        return True

    try:
        rel = resolved.relative_to(root)
    except ValueError:
        return True

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


def _is_binary(file_path: Path) -> bool:
    """Return True when *file_path* appears to be a binary file.

    Reads the first 8 KB and checks for a null byte (``\\x00``).  Binary
    files (images, PDFs, compiled artifacts) may contain the byte sequence
    for ASCII "TODO"/"FIXME" coincidentally.  Skipping them avoids
    false-positive debt-marker blocks (AC-001 binary false-positive fix).
    """
    _SNIFF_BYTES = 8192
    try:
        with file_path.open("rb") as fh:
            chunk = fh.read(_SNIFF_BYTES)
        return b"\x00" in chunk
    except (OSError, IOError):
        # Unreadable → not binary (caller handles OSError on the text open).
        return False


def _is_exempt(file_path: Path, root: Path) -> bool:
    """Return True if *file_path* is one of the canonical exempt sources.

    Exempt files contain debt-marker tokens intentionally (e.g. as spec
    documentation).  Matching is done against ``_DEBT_MARKER_EXEMPT_PATHS``
    prefix strings relative to *root*.

    Both *file_path* and *root* are resolved before comparison to handle
    macOS symlinked tmp directories (``/var → /private/var``).
    """
    try:
        rel = file_path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return False
    for prefix in _DEBT_MARKER_EXEMPT_PATHS:
        if "*" in prefix or "?" in prefix:
            if fnmatch.fnmatch(rel, prefix):
                return True
        elif rel == prefix or rel.startswith(prefix):
            return True
    return False


def grep_debt_markers(
    files: list[Path],
    patterns: list[str],
    root: Path | None = None,
) -> list[dict]:
    """Scan *files* for debt markers matching any pattern in *patterns*.

    Uses Python's ``re`` module on a streaming line-by-line read to stay
    memory-safe on large files.  Each pattern is compiled as a ``re.Pattern``
    with word-boundary anchors baked into the pattern string itself (callers
    are expected to pass patterns like ``r"\\b(TODO|FIXME|...)\\b"``).

    Binary files are detected via null-byte sniff (first 8 KB) and skipped
    to prevent false positives from binary payloads that happen to contain
    debt-marker byte sequences.

    When *root* is provided, files matching ``_DEBT_MARKER_EXEMPT_PATHS`` are
    skipped (canonical sources that document the marker list itself).

    Uses ``re.finditer`` so that a line with multiple distinct markers emits
    one evidence entry per match (NFR-003: every match with file:line).

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
        # Skip canonical exempt sources (dogfood invariant).
        if root is not None and _is_exempt(file_path, root):
            continue

        # Skip binary files to avoid false positives from coincidental bytes.
        if _is_binary(file_path):
            continue

        try:
            with file_path.open("r", encoding="utf-8", errors="replace") as fh:
                for lineno, raw_line in enumerate(fh, start=1):
                    stripped = raw_line.rstrip("\n").strip()
                    seen_spans: list[tuple[int, int]] = []
                    for pat in compiled:
                        for m in pat.finditer(stripped):
                            # Skip overlapping spans (two patterns matching the
                            # same text range) to avoid duplicating a single hit.
                            if any(
                                m.start() < end and m.end() > start
                                for start, end in seen_spans
                            ):
                                continue
                            seen_spans.append((m.start(), m.end()))
                            # Pick the first non-None capture group so we always
                            # get the bare marker text (e.g. "@skip", not the
                            # full match including lookaround context).
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
