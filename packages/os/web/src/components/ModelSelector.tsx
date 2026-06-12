import { useEffect, useState } from "react";
import { MODEL_ALIASES, isValidAlias } from "../lib/modelLabel";
import type { ModelAlias } from "../lib/modelLabel";

interface ModelSelectorProps {
  storageKey: string;
  defaultValue: ModelAlias;
  onChange: (v: ModelAlias) => void;
}

function readStoredAlias(storageKey: string, fallback: ModelAlias): ModelAlias {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && isValidAlias(stored)) return stored;
  } catch {
    // localStorage unavailable (SSR / private browsing restriction)
  }
  return fallback;
}

export function ModelSelector({ storageKey, defaultValue, onChange }: ModelSelectorProps) {
  const [selected, setSelected] = useState<ModelAlias>(() => readStoredAlias(storageKey, defaultValue));

  useEffect(() => {
    const restored = readStoredAlias(storageKey, defaultValue);
    if (restored !== defaultValue) {
      onChange(restored);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (!isValidAlias(next)) return;
    setSelected(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // localStorage unavailable — selection still works in memory
    }
    onChange(next);
  }

  return (
    <select className="model-selector" value={selected} onChange={handleChange}>
      {MODEL_ALIASES.map((alias) => (
        <option key={alias} value={alias}>
          {alias.charAt(0).toUpperCase() + alias.slice(1)}
        </option>
      ))}
    </select>
  );
}
