"""ai-squad cost pricing — pure stdlib. Applies per-model rates + universal cache multipliers."""
import json
from pathlib import Path

_DEFAULT_PRICES = Path(__file__).resolve().parent / "model_prices.json"


def load_prices(path=None):
    """Return {model_id: {input_per_mtok, output_per_mtok}} from the config file."""
    path = Path(path) if path else _DEFAULT_PRICES
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["models"]
