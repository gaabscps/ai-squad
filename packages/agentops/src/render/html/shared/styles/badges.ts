/**
 * Badge CSS: .badge, .badge-pass, .badge-warn, .badge-fail, .badge-neutral.
 * Plus .compliance-notice for pré-padrão / pm-bypass banners.
 */
export const BADGES_CSS = `
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}
.badge-pass {
  background: var(--status-pass);
  color: white;
}
.badge-warn {
  background: var(--status-warn);
  color: white;
}
.badge-fail {
  background: var(--status-fail);
  color: white;
}
.badge-neutral {
  background: var(--border);
  color: var(--fg);
}
.compliance-notice {
  margin: 12px 0;
  padding: 10px 14px;
  border-radius: 6px;
  border-left: 4px solid var(--status-warn);
  background: color-mix(in srgb, var(--status-warn) 10%, transparent);
  color: var(--fg);
  font-size: 14px;
  line-height: 1.5;
}
.compliance-notice strong {
  font-weight: 600;
}
.compliance-notice code {
  background: color-mix(in srgb, var(--fg) 10%, transparent);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.compliance-pre-standard {
  border-left-color: var(--border);
  background: color-mix(in srgb, var(--border) 30%, transparent);
}`;
