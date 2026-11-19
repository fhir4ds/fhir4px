/**
 * Pyodide-hosted fhir4ds viewdef engine — ported from
 * fhir4ds/web/viewing-room (src/workers/viewing-room.worker.ts), adapted
 * to run inside the engine frame: Pyodide generates SQL (text only), the
 * frame's DuckDB-WASM connection executes it VERBATIM (exact-SQL
 * doctrine — no rewriting anywhere).
 *
 * Boots lazily on the first viewdef request (~15s cold; the 28MB wheel +
 * Pyodide runtime load once per session). Capabilities mirror the
 * viewing-room worker: flatten_view (ViewDefinition -> SQL) and the
 * SQLQuery Library path with LIVE composition (OMOP view family derived
 * from the wheel's library on every run).
 */

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodide: any = null;
let bootPromise: Promise<void> | null = null;

function wheelUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(`${base.replace(/\/?$/, "/")}vendor/fhir4ds/fhir4ds_v2-0.0.25-py3-none-any.whl`, globalThis.location.href).href;
}

async function bootPyodide(): Promise<void> {
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`);
  pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });
  // Binary packages the wheel's import chain reaches at module load.
  await pyodide.loadPackage(["micropip", "duckdb", "orjson", "pyarrow"]);
  pyodide.globals.set("__wheel_url__", wheelUrl());
  await pyodide.runPythonAsync(`
import micropip
await micropip.install([
    "antlr4-python3-runtime>=4.10",
    "python-dateutil>=2.8",
])
await micropip.install(__wheel_url__, deps=False)
  `);
  pyodide.runPython(`
from fhir4ds.viewdef.parser import parse_view_definition
from fhir4ds.viewdef.generator import SQLGenerator
_vd = parse_view_definition({"resource": "Patient", "select": [{"column": [{"name": "id", "path": "id"}]}]})
_sql = SQLGenerator(source_table="__vd_src").generate(_vd)
assert "id" in _sql, "viewdef boot smoke failed"
  `);
}

export function ensurePyodide(): Promise<void> {
  if (!bootPromise) {
    bootPromise = bootPyodide().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

/**
 * CQL → SQL translation via the wheel's translator (their exact pipeline:
 * parse_cql → CQLToSQLTranslator → population SQL), executed verbatim on
 * the engine's DuckDB over the `resources` table.
 */
export async function translateCqlToSql(cqlText: string): Promise<string> {
  await ensurePyodide();
  pyodide.globals.set("_cql_input", cqlText);
  const pyResult = pyodide.runPython(`
import traceback
from fhir4ds.cql.parser import parse_cql
from fhir4ds.cql import CQLToSQLTranslator

_error = None
_sql = None
try:
    _library = parse_cql(_cql_input)
    _translator = CQLToSQLTranslator()
    _sql = _translator.translate_library_to_population_sql(_library)
except Exception as e:
    lines = traceback.format_exc().strip().splitlines()
    last = next((l.strip() for l in reversed(lines) if l.strip() and not l.startswith("During")), str(e))
    _error = f"{type(e).__name__}: {last.split(': ', 1)[-1]}"

[_sql, _error]
`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sql, err] = pyResult.toJs ? pyResult.toJs() : Array.from(pyResult as any);
  if (err) throw new Error(String(err));
  return typeof sql === "string" ? sql : String(sql);
}

export interface ViewSqlResult {
  ok: boolean;
  sql: string | null;
  setup_sql?: string[];
  diagnostics: Array<Record<string, unknown>> | null;
}

// Translation cache: the generated SQL depends only on the CQL inputs and
// the Measurement Period — never on patient data. Translations are reused
// across patients/dataset switches; re-translation happens only when the
// measurement year changes (or the CQL inputs are re-vendored).
const measureSqlCache = new Map<string, string>();

/**
 * Live eCQM translation: multi-library CQL → population SQL with the
 * Measurement Period bound as a translation parameter. Value sets resolve
 * at execution time through the engine's native in_valueset UDF reading the
 * C++ g_valueset_cache (seeded via valueset-bridge.ts — the same surface the
 * CQL cleanroom uses). Parsed dependency libraries persist across calls in
 * Pyodide, and translated SQL is cached per (CQL, period).
 */
export async function translateMeasureSql(
  measureCql: string,
  libraryTexts: Record<string, string>,
  measurementPeriod: { start: string; end: string }
): Promise<string> {
  const cacheKey = `${measurementPeriod.start}..${measurementPeriod.end}\n${measureCql}\n${JSON.stringify(libraryTexts)}`;
  const cached = measureSqlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  await ensurePyodide();
  pyodide.globals.set("_measure_cql", measureCql);
  pyodide.globals.set("_lib_texts", JSON.stringify(libraryTexts));
  pyodide.globals.set("_mp_start", measurementPeriod.start);
  pyodide.globals.set("_mp_end", measurementPeriod.end);
  const pyResult = pyodide.runPython(`
import traceback
_error = None
_sql = None
try:
    import json as _json
    from fhir4ds.cql.parser import parse_cql
    from fhir4ds.cql.translator import CQLToSQLTranslator

    # Persistent dep-library cache across calls (FHIRHelpers and friends are
    # expensive to parse and shared by every measure).
    try:
        _lib_cache
    except NameError:
        _lib_cache = {}

    def _loader(alias):
        if alias in _lib_cache:
            return _lib_cache[alias]
        text = _json.loads(_lib_texts).get(alias)
        if text is None:
            return None
        lib = parse_cql(text)
        _lib_cache[alias] = lib
        return lib

    _library = parse_cql(_measure_cql)
    _translator = CQLToSQLTranslator(library_loader=_loader)
    _sql = _translator.translate_library_to_population_sql(
        library=_library,
        output_columns={
            "Initial Population": "Initial Population",
            "Denominator": "Denominator",
            "Denominator Exclusions": "Denominator Exclusions",
            "Numerator": "Numerator",
        },
        parameters={"Measurement Period": (_mp_start, _mp_end)},
    )
except Exception as e:
    lines = traceback.format_exc().strip().splitlines()
    last = next((l.strip() for l in reversed(lines) if l.strip() and not l.startswith("During")), str(e))
    _error = f"{type(e).__name__}: {last.split(': ', 1)[-1]}"

[_sql, _error]
`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sql, err] = pyResult.toJs ? pyResult.toJs() : Array.from(pyResult as any);
  if (err) throw new Error(String(err));
  const result = typeof sql === "string" ? sql : String(sql);
  measureSqlCache.set(cacheKey, result);
  return result;
}
export async function generateViewSql(viewDefinition: Record<string, unknown>): Promise<ViewSqlResult> {
  await ensurePyodide();
  pyodide.globals.set("__vd_json", JSON.stringify(viewDefinition));
  const out: string = pyodide.runPython(`
import json
from fhir4ds.viewdef.parser import parse_view_definition
from fhir4ds.viewdef.generator import SQLGenerator

try:
    vd = parse_view_definition(json.loads(__vd_json))
    gen = SQLGenerator(source_table="__vd_src")
    sql = gen.generate(vd)
    setup_sql = []
    view_targets = sorted({j.view for j in vd.joins if j.view})
    if view_targets:
        from pathlib import Path
        import fhir4ds.viewdef as _v
        omop_dir = Path(_v.__file__).parent / "resources" / "omop"
        schema = gen.view_schema or "omop"
        ctes = ['CREATE SCHEMA IF NOT EXISTS "' + schema + '"']
        for vt in view_targets:
            stem = next((s for s in json.load(open(omop_dir / "manifest.json"))["views"]
                         if s.replace("-view", "").replace("-", "_") == vt
                         or s == vt or s.replace(".json", "") == vt), None)
            if stem is None:
                for f in omop_dir.glob("*-view.json"):
                    cand = json.load(open(f))
                    if cand.get("name") == vt:
                        stem = f.name.replace(".json", "")
                        break
            if stem is not None:
                tvd = parse_view_definition(json.load(open(omop_dir / (stem + ".json"))))
                tgen = SQLGenerator(source_table="__vd_src")
                tgen.view_schema = schema
                tsql = tgen.generate(tvd)
                ctes.append('CREATE OR REPLACE VIEW "' + schema + '"."' + vt + '" AS\\n' + tsql)
    result = {"ok": True, "sql": sql, "setup_sql": ctes if view_targets else []}
except Exception as exc:
    from fhir4ds.operations.errors import diagnostic_from_exception
    diag = diagnostic_from_exception(exc, context="flatten_view")
    result = {"ok": False, "diagnostics": [diag.to_dict()]}
json.dumps(result)
`);
  return JSON.parse(out) as ViewSqlResult;
}

/** SQLQuery Library capability: extract the Library's application/sql content. */
export async function generateLibrarySql(library: Record<string, unknown>): Promise<ViewSqlResult> {
  await ensurePyodide();
  pyodide.globals.set("__lib_json", JSON.stringify(library));
  const out: string = pyodide.runPython(`
import json
try:
    from fhir4ds.sqlquery.parser import parse_library
    lib = parse_library(json.loads(__lib_json))
    contents = [c for c in lib.content if c.content_type.startswith("application/sql")]
    if not contents:
        raise ValueError("Library carries no application/sql content")
    sql = contents[0].data
    result = {"ok": True, "sql": sql}
except Exception as exc:
    from fhir4ds.operations.errors import diagnostic_from_exception
    diag = diagnostic_from_exception(exc, context="sqlquery_library")
    result = {"ok": False, "diagnostics": [diag.to_dict()]}
json.dumps(result)
`);
  return JSON.parse(out) as ViewSqlResult;
}

/**
 * LIVE composition DDL (their exact three-phase port): derive the OMOP
 * view family from the wheel's library. Phase 1 (Pyodide, text): plan +
 * generate every view's SQL. Phase 2 (DuckDB): create views, introspect
 * columns. Phase 3 (Pyodide, text): render the remaining DDL. Pyodide
 * never executes SQL.
 */
export async function deriveCompositionDdl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runRaw: (sql: string) => Promise<any>
): Promise<string[]> {
  await ensurePyodide();
  const phase1: string = pyodide.runPython(`
import json
from pathlib import Path
import fhir4ds.viewdef as _vd_pkg
from fhir4ds.viewdef.runner import build_composition_plan, render_view_sqls

_manifest = str(Path(_vd_pkg.__file__).parent / "resources" / "omop" / "manifest.json")
_plan = build_composition_plan(_manifest)
_views = render_view_sqls(_plan, Path(_manifest).parent, "__vd_src")
json.dumps({"plan": _plan, "views": _views})
`);
  const { plan, views } = JSON.parse(phase1) as {
    plan: { schema: string; steps: unknown[] };
    views: Array<{ name: string; table_sql: string; sql: string }>;
  };

  await runRaw(`CREATE SCHEMA IF NOT EXISTS "${plan.schema}"`);
  const columns: Record<string, string[]> = {};
  const sqls: Record<string, string> = {};
  for (const view of views) {
    await runRaw(`CREATE OR REPLACE VIEW ${view.table_sql} AS\n${view.sql}`);
    const probe = (await runRaw(`SELECT * FROM ${view.table_sql} LIMIT 0`)) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schema: { fields: Array<{ name: string }> | any[] };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columns[view.name] = (probe.schema.fields as any[]).map((field) => field.name);
    sqls[view.name] = view.sql;
  }

  pyodide.globals.set("__plan_json", JSON.stringify(plan));
  pyodide.globals.set("__columns_json", JSON.stringify(columns));
  pyodide.globals.set("__sqls_json", JSON.stringify(sqls));
  const phase3: string = pyodide.runPython(`
import json
from fhir4ds.viewdef.runner import render_composition_ddl
json.dumps(render_composition_ddl(
    json.loads(__plan_json),
    json.loads(__columns_json),
    sql_by_view=json.loads(__sqls_json),
))
`);
  return JSON.parse(phase3) as string[];
}
