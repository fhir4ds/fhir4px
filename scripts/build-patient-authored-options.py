#!/usr/bin/env python3
import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "patient_friendly_2026-06-08.csv"
OUT_DIR = ROOT / "public" / "terminology" / "patient-authored"

SYSTEMS = {
    "RXNORM": "rxnorm",
    "CVX": "cvx",
}


def compact(value: str | None) -> str:
    return " ".join((value or "").split())


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries: dict[str, dict[str, dict[str, str]]] = {system: {} for system in SYSTEMS.values()}

    with SOURCE.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            system = SYSTEMS.get(row.get("source", ""))
            if not system:
                continue
            code = compact(row.get("code"))
            name = compact(row.get("name"))
            technical_name = compact(row.get("technical_name"))
            if not code or not name or not technical_name:
                continue
            current = entries[system].get(code)
            candidate = {
                "code": code,
                "name": name,
                "technicalName": technical_name,
            }
            if current is None or len(candidate["technicalName"]) < len(current["technicalName"]):
                entries[system][code] = candidate

    manifest = {"version": 1, "systems": {}}
    for system, by_code in entries.items():
        payload = {
            "version": 1,
            "system": system,
            "entries": sorted(by_code.values(), key=lambda entry: (entry["name"].lower(), entry["technicalName"].lower(), entry["code"])),
        }
        target = OUT_DIR / f"{system}.json"
        target.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        manifest["systems"][system] = {"path": f"{system}.json", "count": len(payload["entries"])}

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
