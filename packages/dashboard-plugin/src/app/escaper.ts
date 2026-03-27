/**
 * XSS prevention utilities for the app generator.
 *
 * Every user-provided string must pass through one of these functions
 * before being injected into generated HTML templates.
 */

/** Escape HTML special characters to prevent XSS in text content. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for use inside double-quoted HTML attribute values. */
export function escapeAttr(str: string): string {
  return escapeHtml(str);
}

/**
 * Safely serialize a JS value for embedding inside a `<script>` tag.
 *
 * Prevents `</script>` injection and HTML comment injection within
 * JSON data that is embedded in inline scripts.
 */
export function escapeJsonForScript(value: unknown): string {
  const json = JSON.stringify(value);
  return json
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--');
}
