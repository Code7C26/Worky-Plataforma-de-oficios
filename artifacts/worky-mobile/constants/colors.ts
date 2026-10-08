/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#17223a',
    tint: '#f58224',
    background: '#f9f6f0',
    foreground: '#17223a',
    card: '#fdfdfc',
    cardForeground: '#17223a',
    primary: '#f58224',
    primaryForeground: '#17223a',
    messageUnread: '#25D366',
    secondary: '#203655',
    secondaryForeground: '#fdfdfc',
    muted: '#efe9e1',
    mutedForeground: '#5e6b87',
    accent: '#f8c859',
    accentForeground: '#17223a',
    destructive: '#dd3c31',
    destructiveForeground: '#fdfdfc',
    border: '#e3ddd3',
    input: '#e3ddd3',
    authField: 'rgba(253, 253, 252, 0.09)',
    authBorder: 'rgba(253, 253, 252, 0.15)',
    authMuted: 'rgba(253, 253, 252, 0.65)',
    authPlaceholder: 'rgba(253, 253, 252, 0.38)',
  },

  radius: 14.4,
};

export default colors;
