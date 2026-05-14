#!/usr/bin/env python3
"""
Tests for shared/lib/canonical_statuses.py.

AC-002: VALID_STATUSES derived from canonical schema.
AC-004: Fail-fast if schema structure is unrecognised.

Run with:
  python3 -m pytest shared/lib/__tests__/test_canonical_statuses.py -v
OR from repo root:
  python3 shared/lib/__tests__/test_canonical_statuses.py
"""
import importlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

# Ensure shared/lib is importable.
_LIB_DIR = Path(__file__).resolve().parent.parent
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

# ---------------------------------------------------------------------------
# Helper: reload canonical_statuses against an arbitrary schema dict
# ---------------------------------------------------------------------------

def _load_module_with_schema(schema: dict):
    """Return a freshly-imported canonical_statuses module backed by *schema*.

    Uses monkeypatching of Path.read_text so the module's fail-fast I/O is
    exercised without touching the real schema file.
    """
    schema_text = json.dumps(schema)
    # Remove cached module so importlib re-executes module body.
    sys.modules.pop("canonical_statuses", None)
    with patch("pathlib.Path.read_text", return_value=schema_text):
        import canonical_statuses  # noqa: PLC0415
        mod = importlib.import_module("canonical_statuses")
    return mod


def _minimal_schema(status_prop: dict) -> dict:
    """Wrap *status_prop* in the minimal dispatch-manifest schema skeleton."""
    return {
        "properties": {
            "actual_dispatches": {
                "items": {
                    "properties": {
                        "status": status_prop,
                        "role": {"enum": ["dev", "qa"]},
                    }
                }
            }
        }
    }


# ---------------------------------------------------------------------------
# Tests for AC-002: VALID_STATUSES derived correctly from schema
# ---------------------------------------------------------------------------

class TestValidStatusesFromPlainEnum(unittest.TestCase):
    """Plain enum in schema → VALID_STATUSES contains all values."""

    def test_plain_enum_all_values_present(self):
        schema = _minimal_schema({"enum": ["done", "blocked", "escalate"]})
        mod = _load_module_with_schema(schema)
        self.assertEqual(mod.VALID_STATUSES, frozenset({"done", "blocked", "escalate"}))


class TestValidStatusesFromAnyOf(unittest.TestCase):
    """anyOf schema → VALID_STATUSES excludes deprecated variants."""

    def test_anyof_enum_variant_extracted(self):
        schema = _minimal_schema({
            "anyOf": [
                {"type": "string", "enum": ["done", "blocked"]},
                {"type": "string", "const": "partial", "deprecated": True},
            ]
        })
        mod = _load_module_with_schema(schema)
        self.assertIn("done", mod.VALID_STATUSES)
        self.assertIn("blocked", mod.VALID_STATUSES)

    def test_anyof_deprecated_const_excluded(self):
        schema = _minimal_schema({
            "anyOf": [
                {"type": "string", "enum": ["done", "blocked"]},
                {"type": "string", "const": "partial", "deprecated": True},
            ]
        })
        mod = _load_module_with_schema(schema)
        self.assertNotIn("partial", mod.VALID_STATUSES)

    def test_anyof_const_non_deprecated_included(self):
        """A non-deprecated const variant is included in VALID_STATUSES."""
        schema = _minimal_schema({
            "anyOf": [
                {"type": "string", "enum": ["done"]},
                {"type": "string", "const": "timeout"},  # not deprecated
            ]
        })
        mod = _load_module_with_schema(schema)
        self.assertIn("timeout", mod.VALID_STATUSES)


# ---------------------------------------------------------------------------
# Tests for AC-004 / f-001: fail-fast on unrecognised anyOf variant shape
# ---------------------------------------------------------------------------

class TestFailFastOnUnrecognisedAnyOfVariant(unittest.TestCase):
    """f-001 fix: non-deprecated anyOf variant without enum/const must raise.

    Before the fix the loop body did nothing for such a variant, silently
    producing incomplete VALID_STATUSES. After the fix a KeyError is raised
    at module import time.
    """

    def _load_with_bad_anyof(self):
        """Schema with a non-deprecated anyOf variant lacking enum/const."""
        schema = _minimal_schema({
            "anyOf": [
                {"type": "string", "enum": ["done"]},
                # This variant is non-deprecated and has neither enum nor const.
                {"type": "string", "pattern": "^un.*"},
            ]
        })
        return schema

    def test_raises_key_error_on_unrecognised_non_deprecated_variant(self):
        """KeyError raised when non-deprecated variant has unknown shape."""
        schema = self._load_with_bad_anyof()
        sys.modules.pop("canonical_statuses", None)
        schema_text = json.dumps(schema)
        with patch("pathlib.Path.read_text", return_value=schema_text):
            with self.assertRaises(KeyError) as ctx:
                import canonical_statuses  # noqa: PLC0415
                # Force module re-execution if already cached (shouldn't be
                # due to pop above, but be explicit).
                importlib.reload(canonical_statuses)
        # Error message must mention the unexpected keys.
        self.assertIn("pattern", str(ctx.exception))

    def test_deprecated_unrecognised_variant_skipped_not_raised(self):
        """A deprecated variant with unknown shape is still skipped (not raised).

        Only non-deprecated unrecognised shapes should fail-fast.
        """
        schema = _minimal_schema({
            "anyOf": [
                {"type": "string", "enum": ["done"]},
                # Deprecated + unknown shape → must NOT raise (skipped).
                {"type": "string", "pattern": "^old.*", "deprecated": True},
            ]
        })
        sys.modules.pop("canonical_statuses", None)
        schema_text = json.dumps(schema)
        with patch("pathlib.Path.read_text", return_value=schema_text):
            try:
                import canonical_statuses  # noqa: PLC0415
                importlib.reload(canonical_statuses)
                loaded = True
            except KeyError:
                loaded = False
        self.assertTrue(loaded, "Deprecated unrecognised variant should be skipped, not raise")


# ---------------------------------------------------------------------------
# Tests for format_valid_list helper
# ---------------------------------------------------------------------------

class TestFormatValidList(unittest.TestCase):
    def setUp(self):
        # Use the real module (backed by real schema on disk).
        sys.modules.pop("canonical_statuses", None)
        import canonical_statuses
        self.mod = canonical_statuses

    def test_sorted_output(self):
        result = self.mod.format_valid_list(frozenset({"done", "blocked", "escalate"}))
        self.assertEqual(result, "blocked, done, escalate")

    def test_empty_frozenset(self):
        result = self.mod.format_valid_list(frozenset())
        self.assertEqual(result, "")


if __name__ == "__main__":
    unittest.main()
