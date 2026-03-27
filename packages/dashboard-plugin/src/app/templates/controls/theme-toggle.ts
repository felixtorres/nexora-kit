/**
 * Theme toggle control — dark/light mode switch button.
 */

export function renderThemeToggle(): string {
  return `
    <button class="btn-sm" id="theme-toggle" onclick="window.__toggleTheme()" title="Toggle theme">
      <span id="theme-icon">&#9789;</span> Theme
    </button>
  `;
}
