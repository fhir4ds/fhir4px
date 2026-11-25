/**
 * Where the browser-side fhir4ds runtime comes from. Shared by the main-window
 * translator (viewdef.ts) and the background worker (fhir4ds.worker.ts), so
 * both always load the same Pyodide version, the same binary packages and the
 * same wheel file.
 */

export const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

export const FHIR4DS_WHEEL_FILE = "fhir4ds_v2-0.0.26-py3-none-any.whl";

/** Binary Pyodide packages the wheel's import chain reaches at module load. */
export const FHIR4DS_PYODIDE_PACKAGES: readonly string[] = ["micropip", "duckdb", "orjson", "pyarrow"];

export function fhir4dsWheelUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  // The module's own address is an http(s) URL in the page and in a worker
  // alike; `location` is not (a worker has none on the main thread's terms).
  const origin = new URL(import.meta.url).origin;
  return `${origin}${base.replace(/\/?$/, "/")}vendor/fhir4ds/${FHIR4DS_WHEEL_FILE}`;
}

/**
 * Installs the wheel into a Pyodide instance whose globals already hold
 * `__wheel_url__`. Must be run with runPythonAsync (micropip is async).
 */
export const FHIR4DS_INSTALL_PY = `
import micropip
await micropip.install([
    "antlr4-python3-runtime>=4.10",
    "python-dateutil>=2.8",
])
await micropip.install(__wheel_url__, deps=False)
`;
