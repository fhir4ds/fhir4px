#!/usr/bin/env python3
"""Vendor eCQM CQL sources and expanded ValueSets into the app's public dir.

The app translates these CQL libraries to SQL LIVE at runtime via the
fhir4ds wheel (Pyodide) — these are inputs only (CQL text + machine-expanded
ValueSets from the ecqm-content-qicore-2025 submodule). No SQL is vendored.

Re-run after bumping the fhir4ds checkout / eCQM content:

    python3 scripts/vendor-ecqm-artifacts.py [fhir4ds-repo-root]
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FHIR4DS = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT.parent / "fhir4ds"
ECQM_DIR = FHIR4DS / "tests" / "data" / "ecqm-content-qicore-2025" / "input"
CQL_DIR = ECQM_DIR / "cql"
VALUESET_DIR = ECQM_DIR / "vocabulary" / "valueset" / "external"

OUT = REPO_ROOT / "public" / "fhir4ds" / "measures"
OUT_CQL = OUT / "cql"
OUT_VALUESETS = OUT / "valuesets"

MEASURES = {
    "CMS122": "CMS122FHIRDiabetesAssessGreaterThan9Percent.cql",
    "CMS124": "CMS124FHIRCervicalCancerScreening.cql",
    "CMS125": "CMS125FHIRBreastCancerScreening.cql",
    "CMS130": "CMS130FHIRColorectalCancerScreening.cql",
    "CMS159": "CMS159FHIRDepressionRemissionatTwelveMonths.cql",
    "CMS349": "CMS349FHIRHIVScreening.cql",
    "CMS74": "CMS74FHIRPrimaryCariesPreventionasOfferedbyDentists.cql",
    "CMS75": "CMS75FHIRChildrenWhoHaveDentalDecayOrCavities.cql",
}

INCLUDE_RE = re.compile(r"include\s+([A-Za-z0-9_]+)\s+version", re.IGNORECASE)
VALUESET_RE = re.compile(r"'(http://cts\.nlm\.nih\.gov/fhir/ValueSet/[0-9.]+)'")

# Alias → filename overrides where the CQL filename differs from the alias
# (e.g. SupplementalDataElements is included as SDE but parses from its full name).
ALIAS_FILENAMES: dict[str, str] = {}


def cql_text(filename: str) -> str:
    return (CQL_DIR / filename).read_text()


def main() -> None:
    if not CQL_DIR.is_dir():
        raise SystemExit(f"eCQM CQL dir not found: {CQL_DIR}")
    if OUT_CQL.exists():
        shutil.rmtree(OUT_CQL)
    if OUT_VALUESETS.exists():
        shutil.rmtree(OUT_VALUESETS)
    OUT_CQL.mkdir(parents=True)
    OUT_VALUESETS.mkdir(parents=True)

    # Include closure (BFS from the measure libraries)
    to_copy: dict[str, str] = {}  # filename -> alias used by loader
    valueset_urls: set[str] = set()

    def visit(filename: str, alias: str) -> None:
        if filename in to_copy:
            return
        text = cql_text(filename)
        to_copy[filename] = alias
        for include_alias in INCLUDE_RE.findall(text):
            dep_file = ALIAS_FILENAMES.get(include_alias, f"{include_alias}.cql")
            if (CQL_DIR / dep_file).exists():
                visit(dep_file, include_alias)
        valueset_urls.update(VALUESET_RE.findall(text))

    for measure_id, filename in MEASURES.items():
        visit(filename, measure_id)
        (OUT_CQL / f"{measure_id}.cql").write_text(cql_text(filename))

    for filename, alias in sorted(to_copy.items()):
        shutil.copy(CQL_DIR / filename, OUT_CQL / filename)

    # ValueSets: map canonical URL → vendored file (fall back to the
    # canonical-URL-named copies under tests/data/valuesets/)
    manifest: dict[str, list[str]] = {"valuesets": []}
    copied = 0
    fallback_dir = FHIR4DS / "tests" / "data" / "valuesets"
    for url in sorted(valueset_urls):
        oid = url.rsplit("/", 1)[-1]
        source = VALUESET_DIR / f"valueset-{oid}.json"
        if not source.exists():
            fallback = fallback_dir / f"cts.nlm.nih.gov_fhir_ValueSet_{oid}.json"
            if fallback.exists():
                source = fallback
        if not source.exists():
            print(f"  !! missing valueset file for {oid}")
            continue
        shutil.copy(source, OUT_VALUESETS / f"valueset-{oid}.json")
        manifest["valuesets"].append(url)
        copied += 1

    (OUT / "cql-manifest.json").write_text(json.dumps({
        **{k: {"file": f"{k}.cql"} for k in MEASURES},
        "libraries": sorted(f for f in to_copy if not f.startswith("CMS")),
        "valuesets": manifest["valuesets"]
    }, indent=1))

    total_kb = sum(p.stat().st_size for p in OUT_CQL.iterdir()) // 1024
    vs_kb = sum(p.stat().st_size for p in OUT_VALUESETS.iterdir()) // 1024
    print(f"CQL files: {len(list(OUT_CQL.glob('*.cql')))} ({total_kb} KB)  valuesets: {copied}/{len(valueset_urls)} ({vs_kb} KB)")


if __name__ == "__main__":
    main()
