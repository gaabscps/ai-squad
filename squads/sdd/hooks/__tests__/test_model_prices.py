import importlib.util
import json
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("pricing", str(_LIB / "pricing.py"))
pricing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pricing)


def test_load_prices_returns_known_models():
    prices = pricing.load_prices()
    assert "claude-opus-4-7" in prices
    assert prices["claude-opus-4-7"]["input_per_mtok"] > 0
    assert prices["claude-opus-4-7"]["output_per_mtok"] > 0


def test_load_prices_custom_path(tmp_path):
    p = tmp_path / "prices.json"
    p.write_text(json.dumps({"models": {"m": {"input_per_mtok": 2.0, "output_per_mtok": 4.0}}}))
    prices = pricing.load_prices(p)
    assert prices["m"] == {"input_per_mtok": 2.0, "output_per_mtok": 4.0}
