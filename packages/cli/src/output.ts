/** Minimal terminal output helpers — no external dependencies. */

const isColorSupported = process.env['NO_COLOR'] === undefined && process.stdout.isTTY;

function color(code: number, text: string): string {
  return isColorSupported ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const fmt = {
  bold: (t: string) => color(1, t),
  dim: (t: string) => color(2, t),
  green: (t: string) => color(32, t),
  yellow: (t: string) => color(33, t),
  red: (t: string) => color(31, t),
  cyan: (t: string) => color(36, t),
};

export function success(msg: string): void {
  console.log(fmt.green('✓') + ' ' + msg);
}

export function warn(msg: string): void {
  console.log(fmt.yellow('⚠') + ' ' + msg);
}

export function error(msg: string): void {
  console.error(fmt.red('✗') + ' ' + msg);
}

export function info(msg: string): void {
  console.log(fmt.cyan('ℹ') + ' ' + msg);
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );

  const sep = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const formatRow = (row: string[]) =>
    row.map((cell, i) => ` ${(cell ?? '').padEnd(widths[i])} `).join('│');

  console.log(formatRow(headers));
  console.log(sep);
  for (const row of rows) {
    console.log(formatRow(row));
  }
}
