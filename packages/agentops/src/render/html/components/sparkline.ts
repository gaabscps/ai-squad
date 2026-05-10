/**
 * Generates an inline SVG sparkline for trend visualization.
 * Zero external dependencies — pure string generation.
 * Returns empty string if fewer than 2 values (no line can be drawn).
 */
export function sparkline(values: number[], width = 60, height = 20): string {
  if (values.length < 2) return '';

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="trend"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${points}"/></svg>`;
}
