const VALID_ALIASES = new Set(["haiku", "sonnet", "opus"]);

/**
 * Converte o model-id resolvido pelo CLI em label legível.
 * Ex.: "claude-haiku-4-5-20251001" → "Haiku 4.5"
 * Retorna "" para null / undefined / string vazia.
 */
export function modelLabel(modelId: string | null | undefined): string {
  if (!modelId) return "";

  const withoutPrefix = modelId.startsWith("claude-") ? modelId.slice("claude-".length) : modelId;

  const parts = withoutPrefix.split("-");
  if (parts.length === 0) return "";

  const family = parts[0];
  const capitalizedFamily = family.charAt(0).toUpperCase() + family.slice(1);

  const versionParts: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (/^\d{8}$/.test(seg)) break;
    if (/^\d+$/.test(seg)) {
      versionParts.push(seg);
    }
  }

  if (versionParts.length === 0) return capitalizedFamily;

  const version = versionParts.slice(0, 2).join(".");
  return `${capitalizedFamily} ${version}`;
}

export const MODEL_ALIASES = ["haiku", "sonnet", "opus"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export function isValidAlias(value: string): value is ModelAlias {
  return VALID_ALIASES.has(value);
}
