#!/usr/bin/env python3
"""Prebuild SQL at BUILD time with the fhir4ds wheel (the "prebuilt" mode).

The app has two ways to obtain SQL, and fhir4ds produces it in both:

  live      the browser runs the fhir4ds wheel in Pyodide and translates on
            demand (the default build);
  prebuilt  this script runs the same translator, over the same inputs, once
            at build time and writes the SQL under public/fhir4ds/prebuilt/.

Each function below mirrors a Python snippet embedded in
src/lib/engine/viewdef.ts, call for call. tests/e2e/prebuilt-sql.spec.ts
proves in the real engine that the two outputs are identical.

The wheel is read from the file the app ships (public/vendor/fhir4ds/), never
from an installed fhir4ds, so the SQL always comes from the fhir4ds version
the browser would run.

The one input that varies per patient is the measurement year. The translator
writes the Measurement Period dates into the SQL, so each measure is
translated once with a marker year and that year is turned into a
placeholder; the app fills the patient's year in when it loads the SQL. The
script checks, for other years, that the filled text equals a direct
translation, and fails the build if it does not.

Needs Python 3 and the `duckdb` package (column names for the OMOP
composition). Run through `npm run prebuild:sql`.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import platform
import re
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path

GENERATOR = "fhir4px-prebuild-sql"
MANIFEST_VERSION = 1
YEAR_PLACEHOLDER = "{{YEAR}}"
# Any year works as the marker: the script checks that the translator treats
# the Measurement Period dates as plain text.
MARKER_YEAR = 2000
# A leap year and the current year, to compare the filled text against.
LEAP_CHECK_YEAR = 2024

MEASURE_OUTPUT_COLUMNS = {
    "Initial Population": "Initial Population",
    "Denominator": "Denominator",
    "Denominator Exclusions": "Denominator Exclusions",
    "Numerator": "Numerator",
}

# Local aliases the eCQM libraries use in include statements — the same map
# as loadEcqmInputs() in src/lib/fhir/measures.ts.
INCLUDE_ALIASES = {
    "SDE": "SupplementalDataElements.cql",
    "AHA": "AdvancedIllnessandFrailty.cql",
    "AIFrailLTCF": "AdvancedIllnessandFrailty.cql",
}

# The translator writes the Measurement Period as its two dates — as full
# timestamps and, in places, date-only. The year is therefore replaced only
# where it begins one of those two dates: a bare digit swap would also hit
# codes that happen to contain the marker year (SNOMED 225752000 does).
PERIOD_YEAR = re.compile(rf"(?<!\d){MARKER_YEAR}(?=-01-01|-12-31)")
STANDALONE_YEAR = re.compile(rf"(?<!\d){MARKER_YEAR}(?!\d)")


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def measurement_period(year: int) -> tuple[str, str]:
    """The same bounds the app binds for a measurement year."""
    return (f"{year}-01-01T00:00:00.000Z", f"{year}-12-31T23:59:59.999Z")


class CqlTranslator:
    """The two CQL translation snippets from viewdef.ts, sharing one cache of
    parsed dependency libraries the way the browser's Pyodide globals do."""

    def __init__(self) -> None:
        self._library_texts: dict[str, str] = {}
        self._parsed: dict[str, object] = {}

    def _loader(self, alias: str):
        if alias in self._parsed:
            return self._parsed[alias]
        from fhir4ds.cql.parser import parse_cql

        text = self._library_texts.get(alias)
        if text is None:
            return None
        library = parse_cql(text)
        self._parsed[alias] = library
        return library

    def measure(self, cql_text: str, library_texts: dict[str, str], period: tuple[str, str]) -> str:
        from fhir4ds.cql.parser import parse_cql
        from fhir4ds.cql.translator import CQLToSQLTranslator

        self._library_texts = library_texts
        library = parse_cql(cql_text)
        translator = CQLToSQLTranslator(library_loader=self._loader)
        translator.translate_library(library)
        return translator.translate_library_to_population_sql(
            library=library,
            output_columns=dict(MEASURE_OUTPUT_COLUMNS),
            parameters={"Measurement Period": period},
        )

    def library(self, cql_text: str) -> str:
        """A parameter-free library (the authored cohorts)."""
        from fhir4ds.cql import CQLToSQLTranslator
        from fhir4ds.cql.parser import parse_cql

        library = parse_cql(cql_text)
        translator = CQLToSQLTranslator()
        translator.translate_library(library)
        return translator.translate_library_to_population_sql(library)


def view_sql(view_definition: dict) -> dict:
    """generateViewSql(): flatten_view capability."""
    import json

    from fhir4ds.viewdef.parser import parse_view_definition
    from fhir4ds.viewdef.generator import SQLGenerator

    try:
        vd = parse_view_definition(view_definition)
        gen = SQLGenerator(source_table="__vd_src")
        sql = gen.generate(vd)
        view_targets = sorted({j.view for j in vd.joins if j.view})
        if not view_targets:
            return {"ok": True, "sql": sql, "setup_sql": []}

        from pathlib import Path

        import fhir4ds.viewdef as vd_package

        omop_dir = Path(vd_package.__file__).parent / "resources" / "omop"
        schema = gen.view_schema or "omop"
        setup_sql = ['CREATE SCHEMA IF NOT EXISTS "' + schema + '"']
        for target in view_targets:
            stem = next(
                (
                    name
                    for name in json.load(open(omop_dir / "manifest.json"))["views"]
                    if name.replace("-view", "").replace("-", "_") == target
                    or name == target
                    or name.replace(".json", "") == target
                ),
                None,
            )
            if stem is None:
                for candidate_file in omop_dir.glob("*-view.json"):
                    candidate = json.load(open(candidate_file))
                    if candidate.get("name") == target:
                        stem = candidate_file.name.replace(".json", "")
                        break
            if stem is not None:
                target_vd = parse_view_definition(json.load(open(omop_dir / (stem + ".json"))))
                target_gen = SQLGenerator(source_table="__vd_src")
                target_gen.view_schema = schema
                setup_sql.append('CREATE OR REPLACE VIEW "' + schema + '"."' + target + '" AS\n' + target_gen.generate(target_vd))
        return {"ok": True, "sql": sql, "setup_sql": setup_sql}
    except Exception as exc:  # the app reports failures as diagnostics too
        from fhir4ds.operations.errors import diagnostic_from_exception

        return {"ok": False, "diagnostics": [diagnostic_from_exception(exc, context="flatten_view").to_dict()]}


def library_sql(library: dict) -> dict:
    """generateLibrarySql(): SQLQuery Library capability."""
    try:
        from fhir4ds.sqlquery.parser import parse_library

        parsed = parse_library(library)
        contents = [c for c in parsed.content if c.content_type.startswith("application/sql")]
        if not contents:
            raise ValueError("Library carries no application/sql content")
        return {"ok": True, "sql": contents[0].data}
    except Exception as exc:
        from fhir4ds.operations.errors import diagnostic_from_exception

        return {"ok": False, "diagnostics": [diagnostic_from_exception(exc, context="sqlquery_library").to_dict()]}


def composition_ddl() -> list[str]:
    """deriveCompositionDdl(): every statement the live engine runs to set up
    the OMOP views, in order.

    The live function runs the schema and the base views through its callback
    as it goes and returns only the final composition statements. The engine
    runs the whole sequence before an OMOP query, so the generated file has to
    hold all of it, not just the returned part.

    Only the column NAMES of each view come from the database, and they do not
    depend on the data, so the statements are the same for every patient."""
    from pathlib import Path

    import duckdb

    import fhir4ds.viewdef as vd_package
    from fhir4ds.cql import register_udfs
    from fhir4ds.viewdef.runner import build_composition_plan, render_composition_ddl, render_view_sqls

    manifest = str(Path(vd_package.__file__).parent / "resources" / "omop" / "manifest.json")
    plan = build_composition_plan(manifest)
    views = render_view_sqls(plan, Path(manifest).parent, "__vd_src")

    connection = duckdb.connect()
    # The views call fhir4ds's FHIRPath functions; register them so the views
    # bind here exactly as they do on the engine.
    register_udfs(connection, use_cpp_extensions=False)
    connection.execute("CREATE OR REPLACE TEMP TABLE __vd_src (resource JSON)")
    connection.execute("INSERT INTO __vd_src SELECT NULL WHERE false")

    statements: list[str] = [f'CREATE SCHEMA IF NOT EXISTS "{plan["schema"]}"']
    columns: dict[str, list[str]] = {}
    sqls: dict[str, str] = {}
    for statement in statements:
        connection.execute(statement)
    for view in views:
        statements.append(f"CREATE OR REPLACE VIEW {view['table_sql']} AS\n{view['sql']}")
        connection.execute(statements[-1])
        probe = connection.execute(f"SELECT * FROM {view['table_sql']} LIMIT 0")
        columns[view["name"]] = [description[0] for description in probe.description]
        sqls[view["name"]] = view["sql"]
    statements.extend(render_composition_ddl(plan, columns, sql_by_view=sqls))
    return statements


def load_wheel(root: Path) -> tuple[Path, Path]:
    """Extract the one wheel the app ships and put it first on sys.path."""
    wheel_dir = root / "public" / "vendor" / "fhir4ds"
    wheels = sorted(wheel_dir.glob("fhir4ds_v2-*.whl"))
    if len(wheels) != 1:
        raise SystemExit(f"Expected exactly one fhir4ds_v2-*.whl in {wheel_dir}, found {len(wheels)}")
    wheel = wheels[0]
    extracted = Path(tempfile.mkdtemp(prefix="fhir4px-prebuild-wheel-"))
    with zipfile.ZipFile(wheel) as archive:
        archive.extractall(extracted)
    sys.path.insert(0, str(extracted))
    return wheel, extracted


def measure_inputs(measures_dir: Path) -> tuple[dict, dict[str, str], dict[str, str], list[Path]]:
    """Measures in manifest order, their CQL, and the dependency library
    texts keyed by file stem and include alias (as loadEcqmInputs does)."""
    manifest = json.loads((measures_dir / "manifest.json").read_text())
    cql_manifest = json.loads((measures_dir / "cql-manifest.json").read_text())

    library_files = list(cql_manifest.get("libraries") or [])
    for filename in INCLUDE_ALIASES.values():
        if filename not in library_files:
            library_files.append(filename)
    library_texts: dict[str, str] = {}
    for filename in library_files:
        text = (measures_dir / "cql" / filename).read_text()
        library_texts[filename[: -len(".cql")]] = text
        for alias, target in INCLUDE_ALIASES.items():
            if target == filename:
                library_texts[alias] = text

    measure_cql: dict[str, str] = {}
    for measure_id in manifest["measures"]:
        measure_cql[measure_id] = (measures_dir / "cql" / cql_manifest[measure_id]["file"]).read_text()

    inputs = [measures_dir / "manifest.json", measures_dir / "cql-manifest.json"]
    inputs += [measures_dir / "cql" / name for name in library_files]
    inputs += [measures_dir / "cql" / cql_manifest[measure_id]["file"] for measure_id in manifest["measures"]]
    return manifest, measure_cql, library_texts, inputs


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def write_json(path: Path, value: object) -> None:
    write(path, json.dumps(value, indent=1))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", required=True, type=Path, help="repository root")
    parser.add_argument("--cohorts", required=True, type=Path, help="JSON [{id, cql}] dumped from src/lib/fhir/cohorts.ts")
    args = parser.parse_args()
    root: Path = args.root.resolve()
    started = time.time()

    wheel, extracted = load_wheel(root)
    try:
        import duckdb  # noqa: F401 — composition needs it
        import fhir4ds

        if not Path(fhir4ds.__file__).resolve().is_relative_to(extracted.resolve()):
            raise SystemExit(f"Another fhir4ds is importable and shadows the shipped wheel: {fhir4ds.__file__}")

        out = root / "public" / "fhir4ds" / "prebuilt"
        if out.exists():
            shutil.rmtree(out)
        inputs: list[Path] = [wheel]
        manifest: dict = {
            "generator": GENERATOR,
            "version": MANIFEST_VERSION,
            "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "wheel": {"file": wheel.name, "sha256": sha256_of(wheel)},
            "yearPlaceholder": YEAR_PLACEHOLDER,
            "measures": {},
            "cohorts": {},
            "views": {},
            "omopLibraries": {},
        }
        translator = CqlTranslator()

        # Quality measures: one template per measure, checked against direct
        # translations for other years.
        measures_dir = root / "public" / "fhir4ds" / "measures"
        _, measure_cql, library_texts, measure_inputs_paths = measure_inputs(measures_dir)
        inputs += measure_inputs_paths
        this_year = datetime.date.today().year
        check_years = sorted({this_year, LEAP_CHECK_YEAR if this_year != LEAP_CHECK_YEAR else LEAP_CHECK_YEAR - 1})
        for measure_id, cql_text in measure_cql.items():
            template = translator.measure(cql_text, library_texts, measurement_period(MARKER_YEAR))
            text, replaced = PERIOD_YEAR.subn(YEAR_PLACEHOLDER, template)
            if replaced == 0:
                raise SystemExit(f"{measure_id}: the Measurement Period does not appear in the translated SQL")
            leftover = STANDALONE_YEAR.search(text)
            if leftover:
                raise SystemExit(
                    f"{measure_id}: the Measurement Period appears in a form other than its two dates, e.g. "
                    f"{text[max(0, leftover.start() - 40):leftover.end() + 40]!r}"
                )
            for year in check_years:
                direct = translator.measure(cql_text, library_texts, measurement_period(year))
                filled = text.replace(YEAR_PLACEHOLDER, str(year))
                if filled != direct:
                    raise SystemExit(
                        f"{measure_id}: filling the year {year} into the template does not reproduce a direct "
                        f"translation ({len(filled)} vs {len(direct)} characters); the translator folds the "
                        "Measurement Period into more than its dates, and the prebuilt SQL cannot follow it"
                    )
            write(out / "measures" / f"{measure_id}.sql", text)
            manifest["measures"][measure_id] = {"file": f"measures/{measure_id}.sql"}

        # Cohorts: parameter-free CQL libraries. Staleness is tracked on the
        # TypeScript file the CQL is authored in, not on the temporary dump.
        cohorts_path = args.cohorts.resolve()
        inputs.append(root / "src" / "lib" / "fhir" / "cohorts.ts")
        for cohort in json.loads(cohorts_path.read_text()):
            write(out / "cohorts" / f"{cohort['id']}.sql", translator.library(cohort["cql"]))
            manifest["cohorts"][cohort["id"]] = {"file": f"cohorts/{cohort['id']}.sql"}

        # US Core data presence views.
        views_dir = root / "public" / "fhir4ds" / "uscore-views"
        for view_file in sorted(views_dir.glob("*.json")):
            if view_file.name == "manifest.json":
                continue
            generated = view_sql(json.loads(view_file.read_text()))
            if not generated["ok"]:
                raise SystemExit(f"view {view_file.stem}: {json.dumps(generated['diagnostics'])[:300]}")
            write_json(out / "views" / f"{view_file.stem}.json", generated)
            inputs.append(view_file)
            manifest["views"][view_file.stem] = {"file": f"views/{view_file.stem}.json"}

        # OMOP export: the table queries and the composition they join to.
        libraries_dir = root / "public" / "fhir4ds" / "omop-libraries"
        for library_file in sorted(libraries_dir.glob("*.json")):
            generated = library_sql(json.loads(library_file.read_text()))
            if not generated["ok"]:
                raise SystemExit(f"library {library_file.stem}: {json.dumps(generated['diagnostics'])[:300]}")
            write_json(out / "omop" / "libraries" / f"{library_file.stem}.json", generated)
            inputs.append(library_file)
            manifest["omopLibraries"][library_file.stem] = {"file": f"omop/libraries/{library_file.stem}.json"}
        write_json(out / "omop" / "composition.json", composition_ddl())
        manifest["omopComposition"] = {"file": "omop/composition.json"}

        manifest["inputs"] = [
            {"path": str(path.relative_to(root)), "sha256": sha256_of(path)}
            for path in inputs
        ]
        manifest["builtWith"] = {"python": platform.python_version(), "duckdb": duckdb.__version__, "fhir4ds": fhir4ds.__file__}
        write_json(out / "manifest.json", manifest)

        total_bytes = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
        print(
            f"Prebuilt SQL with {wheel.name}: {len(manifest['measures'])} measures (year checked for "
            f"{', '.join(map(str, check_years))}), {len(manifest['cohorts'])} cohorts, "
            f"{len(manifest['views'])} views, {len(manifest['omopLibraries'])} OMOP libraries + composition — "
            f"{total_bytes / 1e6:.2f} MB in {time.time() - started:.0f} s"
        )
        return 0
    finally:
        shutil.rmtree(extracted, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
