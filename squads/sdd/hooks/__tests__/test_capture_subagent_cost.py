import importlib.util
import io
import json
import sys
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("capture_subagent_cost", str(_HOOKS / "capture-subagent-cost.py"))
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


def _make_transcript(p):
    p.write_text(
        '{"type":"assistant","timestamp":"2026-05-27T10:00:00Z","message":'
        '{"id":"x","model":"m","usage":{"input_tokens":10,"output_tokens":5}}}\n'
    )


def test_writes_cost_file(tmp_path):
    tr = tmp_path / "agent-abc.jsonl"
    _make_transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    prices = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}

    out = mod.capture(agent_id="abc", transcript_path=str(tr),
                      session_dir=session_dir, prices=prices)

    f = session_dir / "costs" / "agent-abc.json"
    assert f.exists()
    data = json.loads(f.read_text())
    assert data["agent_id"] == "abc"
    assert data["total_cost_usd"] == 20.0
    assert data["scope"] == "implementation"
    assert out == 0


def test_slugify_project_replaces_slash_and_dot():
    # Claude Code's project-dir slug turns BOTH '/' and '.' into '-'
    # (e.g. /repo/.claude/worktrees -> -repo--claude-worktrees).
    assert mod._slugify_project("/Users/x/Developer/bettersmp") == "-Users-x-Developer-bettersmp"
    assert mod._slugify_project("/Users/x/repo/.claude/wt") == "-Users-x-repo--claude-wt"


def test_glob_fallback_finds_transcript_in_current_project(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    slug = mod._slugify_project("/fake/projA")
    d = tmp_path / ".claude" / "projects" / slug / "sess1" / "subagents"
    d.mkdir(parents=True)
    tr = d / "agent-XYZ.jsonl"
    tr.write_text("{}\n")
    found = mod._glob_subagent_transcript("/fake/projA", "XYZ")
    assert found == str(tr)


def test_glob_fallback_ignores_homonym_in_other_project(tmp_path, monkeypatch):
    # The bug class: a wide projects/*/* glob would match an agent id that
    # happens to exist under a DIFFERENT project. Scoping to this project's slug
    # must exclude it.
    monkeypatch.setenv("HOME", str(tmp_path))
    mine = tmp_path / ".claude" / "projects" / mod._slugify_project("/fake/projA") / "s1" / "subagents"
    other = tmp_path / ".claude" / "projects" / mod._slugify_project("/fake/projB") / "s2" / "subagents"
    mine.mkdir(parents=True)
    other.mkdir(parents=True)
    (mine / "agent-DUP.jsonl").write_text("{}\n")
    (other / "agent-DUP.jsonl").write_text("{}\n")
    found = mod._glob_subagent_transcript("/fake/projA", "DUP")
    assert found == str(mine / "agent-DUP.jsonl")                # mine
    assert mod._slugify_project("/fake/projB") not in (found or "")  # never the other project


def test_idempotent_skip(tmp_path):
    tr = tmp_path / "agent-abc.jsonl"
    _make_transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    (session_dir / "costs").mkdir(parents=True)
    existing = session_dir / "costs" / "agent-abc.json"
    existing.write_text('{"agent_id":"abc","total_cost_usd":999.0}')
    prices = {"m": {"input_per_mtok": 1.0, "output_per_mtok": 1.0}}

    mod.capture(agent_id="abc", transcript_path=str(tr), session_dir=session_dir, prices=prices)
    assert json.loads(existing.read_text())["total_cost_usd"] == 999.0  # untouched


def test_missing_transcript_fails_open(tmp_path):
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    rc = mod.capture(agent_id="abc", transcript_path=str(tmp_path / "nope.jsonl"),
                     session_dir=session_dir, prices={})
    assert rc == 0  # never blocks


def test_captures_tokens_without_prices(tmp_path):
    """Decoupling invariant: with no price table, tokens are still captured.

    The model is recorded as unpriced (cost_usd null) — tokens are never
    dropped just because USD conversion is unavailable.
    """
    tr = tmp_path / "agent-abc.jsonl"
    _make_transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)

    out = mod.capture(agent_id="abc", transcript_path=str(tr),
                      session_dir=session_dir, prices={})

    f = session_dir / "costs" / "agent-abc.json"
    assert f.exists()
    data = json.loads(f.read_text())
    assert data["by_model"]["m"]["input_tokens"] == 10   # tokens preserved
    assert data["by_model"]["m"]["output_tokens"] == 5
    assert data["unpriced_models"] == ["m"]              # flagged, not dropped
    assert data["by_model"]["m"]["cost_usd"] is None
    assert out == 0


def test_main_survives_missing_price_table(tmp_path, monkeypatch):
    """Regression: main() must not crash when load_prices() raises.

    Before the fix, load_prices() was called eagerly outside the try/except,
    so a missing model_prices.json aborted capture entirely (empty costs/).
    """
    tr = tmp_path / "agent-abc.jsonl"
    _make_transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text("task_id: FEAT-001\n")

    def _boom(*a, **k):
        raise FileNotFoundError("model_prices.json")

    monkeypatch.setattr(mod.pricing, "load_prices", _boom)
    monkeypatch.setattr(mod, "resolve_project_root", lambda payload: str(tmp_path))
    monkeypatch.setattr(
        sys, "stdin",
        io.StringIO(json.dumps({"agent_id": "abc", "agent_transcript_path": str(tr)})),
    )

    rc = mod.main()

    assert rc == 0
    f = session_dir / "costs" / "agent-abc.json"
    assert f.exists()                                    # tokens captured despite no prices
    assert json.loads(f.read_text())["unpriced_models"] == ["m"]
