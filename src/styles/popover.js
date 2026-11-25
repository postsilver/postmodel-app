// Shared popover look, from the Postmodel controls panel (Figma node 67:480).
// Used by the controls panel and by every tooltip so they stay identical.

// Surface background, Background border, 5px radius, soft drop shadow
export const POPOVER_SURFACE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-background)',
  borderRadius: 5,
  boxShadow: '0 4px 4px 0 rgba(0,0,0,0.25)',
}

// The one tooltip style: popover surface + the panel's Exo 2 13px text
export const TOOLTIP_STYLE = {
  ...POPOVER_SURFACE,
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-heading)',
  fontSize: 'var(--font-size-label)',
  lineHeight: 1.2,
  padding: '6px 8px',
  maxWidth: 240,
  boxSizing: 'border-box',
  pointerEvents: 'auto', // hoverable: the pointer can move onto it without it closing
}
