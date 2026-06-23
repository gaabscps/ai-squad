// Monta a query-string que liga uma sessão à página de export (aba nova).
export function exportHref(projectId: string, specId: string): string {
  const q = new URLSearchParams({ export: "1", projectId, specId });
  return `?${q.toString()}`;
}

// Lê o alvo de export de uma query-string; null se não for uma URL de export válida.
export function parseExportTarget(search: string): { projectId: string; specId: string } | null {
  const q = new URLSearchParams(search);
  if (q.get("export") !== "1") return null;
  const projectId = q.get("projectId");
  const specId = q.get("specId");
  if (!projectId || !specId) return null;
  return { projectId, specId };
}
