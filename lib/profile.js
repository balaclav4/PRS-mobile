/**
 * Display name and the initials drawn in the dashboard corner.
 *
 * This is a local label, not an identity: there is no account behind it yet, so
 * it is whatever the user typed in Account. When it is blank the corner shows a
 * neutral mark rather than inventing a person.
 */

/** Up to two initials from a name. "Jane Rowan" → "JR", "jane" → "J". */
export function initialsFrom(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
