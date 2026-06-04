export interface ReportData {
  totalDollars: number;
  totalTokens: number;
  byPhase: {
    planning?: { dollars: number; tokens: number };
    orchestration?: { dollars: number; tokens: number };
    implementation?: { dollars: number; tokens: number };
  };
}

function parseTokenCount(raw: string): number | null {
  const m = raw.trim().match(/^([\d.]+)([MK])$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  const suffix = m[2].toUpperCase();
  if (suffix === "M") return Math.round(n * 1_000_000);
  if (suffix === "K") return Math.round(n * 1_000);
  return Math.round(n);
}

export function parseReport(html: string): ReportData | null {
  try {
    if (!html || typeof html !== "string") return null;

    // Extract total dollars and tokens from: Cost · $179.23 · 229.5M tokens
    const lblMatch = html.match(/Cost\s*·\s*\$([\d.]+)\s*·\s*([\d.]+[MK]?)\s*tokens/i);
    if (!lblMatch) return null;

    const totalDollars = parseFloat(lblMatch[1]);
    if (isNaN(totalDollars)) return null;

    const totalTokens = parseTokenCount(lblMatch[2]);
    if (totalTokens === null) return null;

    // Extract phase dollars from legend: planning $7.92 · 🔷 orchestration $142.06 · 🟢 implementation $29.25
    const legendMatch = html.match(
      /planning\s*\$([\d.]+)\s*·[^·]*orchestration\s*\$([\d.]+)\s*·[^·]*implementation\s*\$([\d.]+)/i
    );
    if (!legendMatch) return null;

    const planningDollars = parseFloat(legendMatch[1]);
    const orchestrationDollars = parseFloat(legendMatch[2]);
    const implementationDollars = parseFloat(legendMatch[3]);

    if (
      isNaN(planningDollars) ||
      isNaN(orchestrationDollars) ||
      isNaN(implementationDollars)
    )
      return null;

    // Extract phase tokens from table rows.
    // Each row: <tr><th>Phase</th>...<td>7.5M <span ...>...</span></td></tr>
    // The last <td> in each phase row is the Total column.
    const phaseTokens = extractPhaseTokens(html);
    if (!phaseTokens) return null;

    return {
      totalDollars,
      totalTokens,
      byPhase: {
        planning: { dollars: planningDollars, tokens: phaseTokens.planning },
        orchestration: { dollars: orchestrationDollars, tokens: phaseTokens.orchestration },
        implementation: { dollars: implementationDollars, tokens: phaseTokens.implementation },
      },
    };
  } catch {
    return null;
  }
}

function extractPhaseTokens(
  html: string
): { planning: number; orchestration: number; implementation: number } | null {
  const planning = extractRowTokens(html, "Planning");
  const orchestration = extractRowTokens(html, "Orchestration");
  const implementation = extractRowTokens(html, "Implementation");

  if (planning === null || orchestration === null || implementation === null) return null;
  return { planning, orchestration, implementation };
}

function extractRowTokens(html: string, phase: string): number | null {
  // The Total column is the last <td> in the row. We find the row, then find all <td> blocks.
  const rowMatch = html.match(
    new RegExp(`<tr[^>]*>\\s*<th>${phase}</th>(.*?)</tr>`, "is")
  );
  if (!rowMatch) return null;

  const rowContent = rowMatch[1];
  // Find all <td> contents (token value is before the <span>)
  const tdMatches = [...rowContent.matchAll(/<td>([\d.]+[MK]?)\s*<span/gi)];
  if (tdMatches.length === 0) return null;

  // The last <td> with a token+span is the Total column
  const lastTd = tdMatches[tdMatches.length - 1];
  return parseTokenCount(lastTd[1]);
}
