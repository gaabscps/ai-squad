/**
 * Utility CSS classes for the AgentOps HTML dashboard.
 * Inline style string — no separate .css files (self-contained HTML, AC-017).
 * Relies on CSS custom properties defined in tokens.css.ts.
 *
 * Split into themed modules (NFR-003: ≤ 250 lines/file):
 *   shared/styles/reset.ts    — box-sizing, body, typography, table, code
 *   shared/styles/layout.ts   — kpi-bar, story, story-card, flow-grid
 *   shared/styles/badges.ts   — .badge*
 *   shared/styles/details.ts  — <details> styling, drilldown, raw-data
 *   shared/styles/md-embed.ts — .md-embed, repo-health-*
 */
import { BADGES_CSS } from './styles/badges';
import { DETAILS_CSS } from './styles/details';
import { LAYOUT_CSS } from './styles/layout';
import { MD_EMBED_CSS } from './styles/md-embed';
import { RESET_CSS } from './styles/reset';

export { RESET_CSS } from './styles/reset';
export { LAYOUT_CSS } from './styles/layout';
export { BADGES_CSS } from './styles/badges';
export { DETAILS_CSS } from './styles/details';
export { MD_EMBED_CSS } from './styles/md-embed';

export const STYLES_CSS = RESET_CSS + LAYOUT_CSS + BADGES_CSS + DETAILS_CSS + MD_EMBED_CSS;
