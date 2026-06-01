/**
 * Formata tokens compactos: 1_400_000 → "1.4M", 775_000 → "775K", 350 → "350".
 * Espelha o fmt_tokens do report do ai-squad. NÃO recalcula nada — só formata
 * um número que já existe no CostRollup.
 */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Formata $ com 2 casas; null (sem dados de custo) vira "—". */
export function fmtUsd(v: number | null): string {
  return v === null ? "—" : `US$ ${v.toFixed(2)}`;
}
