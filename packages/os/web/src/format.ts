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

/**
 * Formata um instante ISO como tempo relativo ao agora: "agora", "há 6 min",
 * "há 3 h", "há 2 dias". null ou data inválida viram "—". `now` é injetável pra
 * teste (default = relógio real). Só leitura de um valor que já existe; nada de
 * recalcular estado.
 */
export function fmtRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return "agora";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}
