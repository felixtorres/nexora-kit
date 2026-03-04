const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/';

export interface PlotlyFigure {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
}

export type VizResult =
  | { type: 'plotly'; figure: PlotlyFigure }
  | { type: 'image'; dataUrl: string };

type PyodideState = 'idle' | 'loading' | 'ready' | 'error';

let state: PyodideState = 'idle';
let pyodide: unknown = null;
let loadPromise: Promise<void> | null = null;
let loadError: string | null = null;
const installedPackages = new Set<string>();

interface PyodideInstance {
  loadPackage: (pkg: string | string[]) => Promise<void>;
  runPythonAsync: (code: string) => Promise<unknown>;
}

export function getPyodideState(): PyodideState {
  return state;
}

export function getPyodideError(): string | null {
  return loadError;
}

async function initPyodide(): Promise<void> {
  if (state === 'ready') return;
  if (loadPromise) return loadPromise;

  state = 'loading';
  loadError = null;

  loadPromise = (async () => {
    const { loadPyodide } = await import(
      /* webpackIgnore: true */
      `${PYODIDE_CDN}pyodide.mjs`
    );

    pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });

    const py = pyodide as PyodideInstance;
    await py.loadPackage('micropip');

    state = 'ready';
  })().catch((err) => {
    state = 'error';
    loadError = err instanceof Error ? err.message : String(err);
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

/**
 * Install packages needed by user code.
 * - Bundled packages (numpy, pandas, etc.) use loadPackage() — fast, pre-compiled.
 * - micropip packages (plotly, seaborn, etc.) are fetched from PyPI.
 * Already-installed packages are skipped via the installedPackages cache.
 */
async function ensurePackages(bundled: string[], micropipPkgs: string[]): Promise<void> {
  const py = pyodide as PyodideInstance;

  const neededBundled = bundled.filter((p) => !installedPackages.has(p));
  if (neededBundled.length > 0) {
    await py.loadPackage(neededBundled);
    for (const p of neededBundled) installedPackages.add(p);
  }

  const neededMicropip = micropipPkgs.filter((p) => !installedPackages.has(p));
  if (neededMicropip.length > 0) {
    const installList = neededMicropip.map((p) => `"${p}"`).join(', ');
    await py.runPythonAsync(`
import micropip
await micropip.install([${installList}])
`);
    for (const p of neededMicropip) installedPackages.add(p);
  }
}

// ── Plotly capture ──────────────────────────────────────────────────────

const PLOTLY_CAPTURE = `
import json as _json
_fig = None
for _name in reversed(list(dir())):
    if _name.startswith('_'):
        continue
    _obj = eval(_name)
    if hasattr(_obj, 'to_json') and callable(_obj.to_json):
        _fig = _obj
        break
if _fig:
    _result = _fig.to_json()
else:
    _result = _json.dumps({"error": "No Plotly figure found in scope"})
_result
`;

// ── Matplotlib/Seaborn capture ──────────────────────────────────────────

const MPL_CAPTURE = `
import io as _io, base64 as _b64
import matplotlib.pyplot as _plt
_buf = _io.BytesIO()
_fig_mpl = _plt.gcf()
if _fig_mpl.get_axes():
    _fig_mpl.savefig(_buf, format='png', bbox_inches='tight', dpi=150, facecolor='white')
    _buf.seek(0)
    _result = 'data:image/png;base64,' + _b64.b64encode(_buf.read()).decode()
else:
    _result = 'ERROR:No matplotlib figure found'
_plt.close('all')
_result
`;

// ── Detection helpers ───────────────────────────────────────────────────

const PLOTLY_RE =
  /import\s+plotly|from\s+plotly|plotly\.express|plotly\.graph_objects|plotly\.figure_factory|go\.Figure|\bpx\./;
const MPL_RE = /import\s+matplotlib|from\s+matplotlib|\bplt\./;
const SNS_RE = /import\s+seaborn|from\s+seaborn|\bsns\./;

export type VizKind = 'plotly' | 'matplotlib' | null;

export function detectVizKind(code: string): VizKind {
  if (PLOTLY_RE.test(code)) return 'plotly';
  if (MPL_RE.test(code) || SNS_RE.test(code)) return 'matplotlib';
  return null;
}

/**
 * Packages that ship pre-built in the Pyodide distribution.
 * Loaded via loadPackage() — no PyPI round-trip.
 * Key: Python import name, Value: Pyodide package name.
 */
const PYODIDE_BUNDLED: Record<string, string> = {
  numpy: 'numpy',
  pandas: 'pandas',
  scipy: 'scipy',
  sklearn: 'scikit-learn',
  matplotlib: 'matplotlib',
  PIL: 'Pillow',
  cv2: 'opencv-python',
  statsmodels: 'statsmodels',
  sympy: 'sympy',
  networkx: 'networkx',
  lxml: 'lxml',
  html5lib: 'html5lib',
  sqlalchemy: 'SQLAlchemy',
  cryptography: 'cryptography',
};

/**
 * Packages not pre-built in Pyodide — installed via micropip from PyPI.
 * Key: Python import name, Value: PyPI package name.
 */
const MICROPIP_PACKAGES: Record<string, string> = {
  plotly: 'plotly',
  seaborn: 'seaborn',
  kaleido: 'kaleido',
};

/**
 * Scan `import X` / `from X import ...` statements in code and return
 * the two package lists needed by ensurePackages().
 */
function detectImportedPackages(code: string): { bundled: string[]; micropip: string[] } {
  const seen = new Set<string>();
  const importRe = /^\s*(?:import|from)\s+([\w.]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    seen.add(m[1].split('.')[0]);
  }

  const bundled: string[] = [];
  const micropip: string[] = [];
  for (const mod of seen) {
    if (PYODIDE_BUNDLED[mod]) bundled.push(PYODIDE_BUNDLED[mod]);
    else if (MICROPIP_PACKAGES[mod]) micropip.push(MICROPIP_PACKAGES[mod]);
  }
  return { bundled, micropip };
}

// ── df preamble builder ─────────────────────────────────────────────────

const DF_PLACEHOLDER_RE = /^[ \t]*#[ \t]*df[ \t]*=.*$/m;

/**
 * Build a Python preamble that defines `df` as a pandas DataFrame
 * populated from the given rows. pandas is added to the bundled package
 * list automatically when a preamble is injected.
 */
function buildDfPreamble(rows: Record<string, unknown>[]): string {
  const json = JSON.stringify(rows);
  return `import pandas as _pd\n_nexora_rows = ${json}\ndf = _pd.DataFrame(_nexora_rows)\n`;
}

// ── Unified runner ──────────────────────────────────────────────────────

export async function runVisualization(
  code: string,
  tableData?: Record<string, unknown>[],
): Promise<VizResult> {
  await initPyodide();

  const kind = detectVizKind(code);
  const py = pyodide as PyodideInstance;

  // If we have table data, inject a df preamble and strip the placeholder comment.
  let effectiveCode = code;
  if (tableData && tableData.length > 0) {
    const stripped = code.replace(DF_PLACEHOLDER_RE, '');
    effectiveCode = buildDfPreamble(tableData) + stripped;
  }

  const { bundled, micropip } = detectImportedPackages(effectiveCode);

  // Ensure pandas is installed when we injected the preamble
  if (tableData && tableData.length > 0 && !bundled.includes('pandas')) {
    bundled.push('pandas');
  }

  if (kind === 'plotly') {
    // Always ensure plotly itself is installed even if the regex matched a non-import pattern
    if (!micropip.includes('plotly')) micropip.push('plotly');
    await ensurePackages(bundled, micropip);
    const wrapped = `${effectiveCode}\n${PLOTLY_CAPTURE}`;
    const resultJson = await py.runPythonAsync(wrapped);
    const parsed = JSON.parse(resultJson as string);
    if (parsed.error) throw new Error(parsed.error);
    return { type: 'plotly', figure: parsed as PlotlyFigure };
  }

  // matplotlib / seaborn path
  if (!bundled.includes('matplotlib')) bundled.push('matplotlib');
  if (SNS_RE.test(effectiveCode) && !micropip.includes('seaborn')) micropip.push('seaborn');
  await ensurePackages(bundled, micropip);

  await py.runPythonAsync("import matplotlib.pyplot as _plt; _plt.close('all')");
  const wrapped = `${effectiveCode}\n${MPL_CAPTURE}`;
  const result = await py.runPythonAsync(wrapped);
  const dataUrl = result as string;
  if (dataUrl.startsWith('ERROR:')) throw new Error(dataUrl.slice(6));
  return { type: 'image', dataUrl };
}
