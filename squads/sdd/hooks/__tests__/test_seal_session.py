import json
import os
import subprocess
import sys
from pathlib import Path

_SEAL = Path(__file__).resolve().parent.parent / "seal-session.py"


def test_seal_registers_session_and_backfills(tmp_path):
    session_dir = tmp_path / ".agent-session" / "OBS-009"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text(
        "mode: observed\ncreated_at: 2026-06-21T06:00:00Z\n", encoding="utf-8")
    slug = str(tmp_path).replace("/", "-")
    proj = tmp_path / "home" / ".claude" / "projects" / slug
    proj.mkdir(parents=True)
    (proj / "chatX.jsonl").write_text(json.dumps({
        "type": "assistant", "timestamp": "2026-06-21T06:30:00Z",
        "message": {"id": "m1", "model": "claude-opus-4-8",
                    "usage": {"input_tokens": 10, "output_tokens": 5}}}) + "\n")
    env = {**os.environ, "HOME": str(tmp_path / "home")}
    code = subprocess.run([sys.executable, str(_SEAL), "OBS-009", "chatX", str(tmp_path / ".agent-session")],
                          env=env, capture_output=True, text=True).returncode
    assert code == 0
    yml = (session_dir / "session.yml").read_text()
    assert "observed_sessions:" in yml and "chatX" in yml
    assert (session_dir / "cost-report.json").exists()
    assert (session_dir / "costs" / "session-chatX.json").exists()
