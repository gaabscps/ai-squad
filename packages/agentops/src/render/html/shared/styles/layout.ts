/**
 * Layout CSS: kpi-bar, main, story, story-card, flow-grid, flow-card.
 */
export const LAYOUT_CSS = `
.kpi-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1.25rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.kpi-bar h1 {
  flex: 1 1 auto;
  font-size: 1rem;
  margin: 0;
}
.kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  font-size: 13px;
  color: var(--fg-muted);
}
main {
  max-width: 960px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem;
}
.story {
  margin-bottom: 2rem;
}
.story-card { padding: var(--space-4); border-radius: var(--radius-md); background: var(--color-surface); display: flex; flex-direction: column; gap: var(--space-3); border: 1px solid var(--color-border); }
.story-card header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
.story-card header h3 { margin: 0; font-size: var(--text-base); font-weight: 600; }
.story-card header h3 .dot { color: var(--color-text-tertiary); margin: 0 0.4em; }

.story-card__stats { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: baseline; font-size: var(--text-sm); color: var(--color-text-secondary); }
.story-card__stat { display: inline-flex; gap: 0.3em; align-items: baseline; }
.story-card__stat-label { color: var(--color-text-tertiary); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.04em; }
.story-card__stat-value { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }

.story-card__pipeline { display: inline-flex; flex-wrap: wrap; gap: 0.4em; color: var(--color-text-secondary); font-size: var(--text-sm); }

.story-card__summary { margin: 0; font-size: var(--text-sm); color: var(--color-text-secondary); line-height: 1.45; }
.story-card__summary--empty { color: var(--color-text-tertiary); font-style: italic; }

.story-card__retry { padding: var(--space-2) var(--space-3); background: var(--color-warn-bg); border-left: 3px solid var(--color-warn); border-radius: var(--radius-sm); font-size: var(--text-sm); color: var(--color-text-primary); }

.story-card__drilldowns { display: flex; flex-direction: column; gap: var(--space-2); }
.story-card__drilldowns details { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); }
.story-card__drilldowns details > summary { cursor: pointer; font-size: var(--text-sm); color: var(--color-text-secondary); user-select: none; }
.story-card__drilldowns details > summary:hover { color: var(--color-text-primary); }
.story-card__drilldowns details[open] > summary { margin-bottom: var(--space-2); color: var(--color-text-primary); }
.story-card__drilldowns table { width: 100%; border-collapse: collapse; font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.story-card__drilldowns th { text-align: left; color: var(--color-text-tertiary); font-weight: 500; padding: 0.25em 0.5em 0.25em 0; border-bottom: 1px solid var(--color-border); }
.story-card__drilldowns td { padding: 0.25em 0.5em 0.25em 0; }
.story-card__drilldowns ul { margin: 0; padding-left: var(--space-3); font-size: var(--text-xs); }
.story-card__drilldowns ul li { margin-bottom: 0.3em; }
.story-card__pmnote { margin: 0; font-size: var(--text-xs); white-space: pre-wrap; color: var(--color-text-secondary); }

@media (max-width: 767px) {
  .story-card__stats { font-size: var(--text-xs); }
  .story-card header { flex-direction: column; align-items: flex-start; }
}
.kpi-sub {
  font-size: 12px;
  opacity: 0.8;
}
.cost-section {
  margin: 0 0 2rem;
  padding: 1.25rem;
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.cost-section > h2 {
  margin: 0;
}
.cost-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.cost-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.cost-card {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.75rem 0.9rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.cost-card .cost-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}
.cost-card .cost-value {
  font-size: 1.4rem;
  font-weight: 600;
  color: var(--fg);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.cost-card small {
  font-size: 11px;
  color: var(--fg-muted);
}
.cost-models {
  margin-top: 0.5rem;
  font-size: 12px;
}
.cost-models td,
.cost-models th {
  font-variant-numeric: tabular-nums;
}
.cost-breakdown {
  margin-top: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  padding: 0;
}
.cost-breakdown > summary {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  list-style: none;
}
.cost-breakdown > summary::-webkit-details-marker {
  display: none;
}
.cost-breakdown > summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 0.4rem;
  color: var(--fg-muted);
  transition: transform 0.15s;
}
.cost-breakdown[open] > summary::before {
  transform: rotate(90deg);
}
.cost-breakdown > .cost-models {
  margin: 0;
  border-top: 1px solid var(--border);
  border-radius: 0 0 6px 6px;
}
.cost-note {
  margin: 0.75rem 0 0;
  font-size: 12px;
  color: var(--fg-muted);
}
.cost-empty {
  margin: 0;
  color: var(--fg-muted);
}
.flow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}
.flow-card {
  display: block;
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem 1rem;
  color: var(--fg);
  text-decoration: none;
  transition: border-color 0.15s;
}
.flow-card:hover {
  border-color: var(--accent);
  text-decoration: none;
}
.flow-card header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.flow-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 12px;
  color: var(--fg-muted);
  margin-bottom: 0.5rem;
}
.trends {
  display: flex;
  gap: 0.75rem;
  font-size: 12px;
  color: var(--fg-muted);
  align-items: center;
}`;
