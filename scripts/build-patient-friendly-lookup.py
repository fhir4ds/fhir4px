#!/usr/bin/env python3
"""Build sharded browser lookup files from patient-friendly terminology CSV."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = PROJECT_ROOT / "data" / "patient_friendly_2026-06-08.csv"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "public" / "terminology" / "patient-friendly"

SYSTEM_MAP = {
    "LNC": "loinc",
    "RXNORM": "rxnorm",
    "ICD10CM": "icd10cm",
    "SNOMEDCT_US": "snomed",
    "CVX": "cvx",
    "CPT": "cpt",
    "HCPCS": "hcpcs",
}

FRIENDLY_SOURCE_SCORE = {
    "MEDLINEPLUS": 100,
    "CHV": 95,
    "RXNORM": 85,
    "CVX": 85,
    "LNC": 70,
    "SNOMEDCT_US": 70,
    "ICD10CM": 70,
    "CPT": 65,
    "HCPCS": 65,
}

MATCH_TYPE_SCORE = {
    "exact": 100,
    "same_cui": 95,
    "ingredient": 92,
    "group": 88,
    "first_axis": 84,
    "broader_ingredient": 82,
    "broader_group": 78,
    "broader": 72,
    "snomed_to_target_native_hierarchy": 68,
    "snomed_to_target_snomed_fallback": 64,
    "snomed_fallback": 60,
}

DEFAULT_FRIENDLY_SOURCES: set[str] = set()


def normalized(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def score_row(row: dict[str, str]) -> tuple[int, int, int, str]:
    friendly_score = FRIENDLY_SOURCE_SCORE.get(row.get("friendly_source", ""), 0)
    match_score = MATCH_TYPE_SCORE.get(row.get("match_type", ""), 20)
    try:
        depth_score = -int(row.get("match_depth") or 0)
    except ValueError:
        depth_score = 0
    name = row.get("name", "")
    return friendly_score, match_score, depth_score, name


def compact_entry(row: dict[str, str]) -> list[str]:
    return [
        row["name"].strip(),
        row.get("friendly_source", "").strip(),
        row.get("match_type", "").strip(),
    ]


def build_lookup(input_path: Path, output_dir: Path, friendly_sources: set[str]) -> dict[str, Any]:
    by_system: dict[str, dict[str, tuple[tuple[int, int, int, str], list[str]]]] = defaultdict(dict)
    source_rows = 0
    kept_rows = 0
    skipped_source = 0
    skipped_unchanged = 0

    with input_path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            source_rows += 1
            system = SYSTEM_MAP.get(row.get("source", ""))
            if not system:
                skipped_source += 1
                continue
            if friendly_sources and row.get("friendly_source") not in friendly_sources:
                skipped_source += 1
                continue

            code = (row.get("code") or "").strip()
            name = (row.get("name") or "").strip()
            if not code or not name:
                skipped_source += 1
                continue
            if normalized(name) == normalized(row.get("technical_name")):
                skipped_unchanged += 1
                continue

            candidate_score = score_row(row)
            existing = by_system[system].get(code)
            if not existing or candidate_score > existing[0]:
                by_system[system][code] = (candidate_score, compact_entry(row))
                kept_rows += 1

    output_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    manifest = {
        "version": 1,
        "generatedAt": generated_at,
        "sourceCsv": str(input_path.relative_to(PROJECT_ROOT)),
        "selection": {
            "excludedMatchType": "original",
            "friendlySources": sorted(friendly_sources),
            "unchangedTechnicalNamesExcluded": True,
        },
        "systems": {},
        "sourceRows": source_rows,
        "skippedSourceRows": skipped_source,
        "skippedUnchangedRows": skipped_unchanged,
    }

    for system, rows in sorted(by_system.items()):
        entries = {code: entry for code, (_score, entry) in sorted(rows.items())}
        payload = {
            "version": 1,
            "generatedAt": generated_at,
            "system": system,
            "entryShape": ["name", "friendlySource", "matchType"],
            "entries": entries,
        }
        path = output_dir / f"{system}.json"
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        manifest["systems"][system] = {
            "path": f"{system}.json",
            "entries": len(entries),
            "bytes": path.stat().st_size,
        }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(DEFAULT_INPUT))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--friendly-source",
        action="append",
        dest="friendly_sources",
        help="Friendly source to include. Can be passed more than once.",
    )
    args = parser.parse_args()

    friendly_sources = set(args.friendly_sources or DEFAULT_FRIENDLY_SOURCES)
    manifest = build_lookup(Path(args.input), Path(args.output_dir), friendly_sources)
    print(
        "Generated patient-friendly lookup: "
        + ", ".join(f"{system}={meta['entries']:,}" for system, meta in manifest["systems"].items())
    )


if __name__ == "__main__":
    main()
