/**
 * Details/summary expand-collapse CSS.
 */
export const DETAILS_CSS = `
details > summary {
  cursor: pointer;
  padding: 0.5rem 0.75rem;
  font-weight: 600;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
details > summary::before {
  content: "▶";
  font-size: 10px;
  transition: transform 0.15s;
}
details[open] > summary::before {
  transform: rotate(90deg);
}
details[open] > summary {
  border-bottom: 1px solid var(--border);
}
details {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 0.5rem;
  overflow: hidden;
}
details > *:not(summary) {
  padding: 0.75rem;
}
.drilldown {
  margin-bottom: 2rem;
}
.raw-data {
  margin-bottom: 2rem;
}`;
