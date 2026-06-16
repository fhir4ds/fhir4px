#!/usr/bin/env python3
"""Generate condition_medication_relationships.json from medterm4ds reports.

Output: public/terminology/condition_medication_relationships.json
Shape mirrors condition_lab_relationships.json so the runtime lookup module
can be parallel to condition-lab-lookup.ts.

Source CSV (2.98M rows) has columns:
  condition_source, condition_code, condition_name, match_depth,
  medication_rxnorm_code, medication_name, relationship_type

We keep may_treat only, match_depth <= 2, and pivot to:
  { version, total_conditions, total_pairs,
    relationships: { conditionName: [medIngredientName, ...] } }
"""
import csv
import json
import os
from collections import defaultdict

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB_JSON = os.path.join(REPO_ROOT, "public", "terminology", "condition_lab_relationships.json")
OUT_JSON = os.path.join(REPO_ROOT, "public", "terminology", "condition_medication_relationships.json")
SOURCE_CSV = "/mnt/d/medterm4ds/reports/fhir4px/condition_medication_ingredient.csv"

# Curated SNOMED/ICD10 codes for conditions whose CSV `condition_name` doesn't
# match the patient-friendly label we use elsewhere. Verified via SNOMED CT.
CODE_ALIASES = {
    # patient-friendly name -> [(source, code-prefix)]
    "Acute Myocardial Infarction":          [("SNOMEDCT_US", "84114007"), ("ICD10CM", "I21"), ("ICD10CM", "I22")],
    "Breast Cancer":                        [("SNOMEDCT_US", "254837009"), ("ICD10CM", "C50")],
    "COPD":                                 [("SNOMEDCT_US", "13645005"), ("ICD10CM", "J44")],
    "Chronic Back Pain":                    [("SNOMEDCT_US", "279039007"), ("ICD10CM", "M54.5")],
    "Chronic Hepatitis B":                  [("SNOMEDCT_US", "419343005"), ("ICD10CM", "B18.1")],
    "Colon Cancer":                         [("SNOMEDCT_US", "363406005"), ("ICD10CM", "C18")],
    "Colon Polyps":                         [("SNOMEDCT_US", "68496003"), ("ICD10CM", "K63.5")],
    "Diabetes Type 2":                      [("SNOMEDCT_US", "44054006"), ("ICD10CM", "E11")],
    "Diabetic Kidney Disease":              [("SNOMEDCT_US", "127013003"), ("ICD10CM", "E11.2"), ("ICD10CM", "E13.2")],
    "Lung Cancer":                          [("SNOMEDCT_US", "363358000"), ("ICD10CM", "C34")],
    "Metabolic Syndrome":                   [("SNOMEDCT_US", "237602007"), ("ICD10CM", "E88.81")],
    "Prostate Cancer":                      [("SNOMEDCT_US", "399068003"), ("ICD10CM", "C61")],
    "Strep Throat":                         [("SNOMEDCT_US", "186351002"), ("ICD10CM", "J02.0")],
    "Thyroid Disease":                      [("SNOMEDCT_US", "40930008"), ("ICD10CM", "E03"), ("ICD10CM", "E05")],
    "Vitamin D Deficiency":                 [("SNOMEDCT_US", "429280009"), ("ICD10CM", "E55.9")],
}

# Conditions we intentionally skip (no useful med mapping in source data).
SKIP_CONDITIONS = {"Cancer", "Fractures", "Long-term Anticoagulant Therapy",
                   "Clavicle Fracture", "Mandibular Fracture", "Pregnancy"}

def title_case_med(name: str) -> str:
    """Normalize ingredient name to title case for display matching.

    RxNorm uses lowercase ('metformin'); patient-friendly names use title case
    ('Metformin'). We match on a title-cased key for both single-ingredient
    meds and split-on-slash multi-ingredient combos.
    """
    # Preserve slash separators for multi-ingredient names
    parts = name.split("/")
    titled = " / ".join(p.strip().title() for p in parts)
    return titled


def main() -> None:
    with open(LAB_JSON) as f:
        lab_data = json.load(f)
    target_conditions = list(lab_data["relationships"].keys())
    print(f"Target conditions: {len(target_conditions)}")

    # Build matchers per condition
    # Each matcher: list of (source, code_prefix_or_exact, condition_name_lower)
    exact_names = {c.lower() for c in target_conditions if c not in SKIP_CONDITIONS}
    code_matchers = []  # (targetCondition, source, codePrefix)
    for cond, aliases in CODE_ALIASES.items():
        for src, prefix in aliases:
            code_matchers.append((cond, src, prefix))

    # name -> set of med ingredient names (title-cased)
    condition_meds: dict[str, set[str]] = defaultdict(set)

    with open(SOURCE_CSV, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["relationship_type"] != "may_treat":
                continue
            try:
                depth = int(row["match_depth"])
            except ValueError:
                continue
            if depth > 2:
                continue

            med = title_case_med(row["medication_name"])
            src = row["condition_source"]
            code = row["condition_code"]
            cname = row["condition_name"].lower()

            # Match by exact condition name
            if cname in exact_names:
                # Find original case key
                for orig in target_conditions:
                    if orig.lower() == cname and orig not in SKIP_CONDITIONS:
                        condition_meds[orig].add(med)
                        break
                continue

            # Match by SNOMED/ICD10 code prefix
            for target_cond, m_src, m_prefix in code_matchers:
                if src != m_src:
                    continue
                if code == m_prefix or code.startswith(m_prefix + ".") or code.startswith(m_prefix):
                    condition_meds[target_cond].add(med)
                    break

    # Build the JSON output, preserving order from target_conditions
    relationships = {}
    for cond in target_conditions:
        if cond in SKIP_CONDITIONS:
            continue
        meds = sorted(condition_meds.get(cond, set()))
        if meds:
            relationships[cond] = meds

    total_pairs = sum(len(v) for v in relationships.values())
    output = {
        "version": "1.0.0",
        "generated_at": "2026-06-15T00:00:00Z",
        "source": "medterm4ds condition_medication_ingredient.csv (RxNorm may_treat) + curated SNOMED/ICD10 aliases",
        "total_conditions": len(relationships),
        "total_pairs": total_pairs,
        "relationships": relationships,
    }

    with open(OUT_JSON, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {OUT_JSON}")
    print(f"  conditions: {len(relationships)}/34 (skipped {len(SKIP_CONDITIONS)}: {sorted(SKIP_CONDITIONS)})")
    print(f"  total pairs: {total_pairs}")
    print(f"\nPer-condition med counts:")
    for cond in target_conditions:
        if cond in relationships:
            print(f"  {cond}: {len(relationships[cond])}")
        elif cond not in SKIP_CONDITIONS:
            print(f"  {cond}: 0 (no matches in source)")


if __name__ == "__main__":
    main()
