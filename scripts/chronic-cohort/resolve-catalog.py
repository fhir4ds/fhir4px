#!/usr/bin/env python3
"""Resolve the chronic-cohort catalog against UMLS via medterm4ds.

For each entry in catalog-source.py:
  1. ICD-10 entries: exact lookup by code.
  2. Everything else: hybrid BM25+SapBERT search restricted to the entry's
     source vocabulary; prefer the author's `expect` code when it appears in
     results, else take the top-scored hit.
  3. Re-verify the winner with exact lookup (active_only) and capture the
     official UMLS preferred name.

Outputs:
  catalog.resolved.json  - machine-readable catalog for the fixture generator
  catalog.review.txt     - human-readable report; rows needing attention

Run: python3 scripts/chronic-cohort/resolve-catalog.py
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from catalog_source import CATALOG  # noqa: E402  (file is catalog-source.py)

DB = str(Path.home() / ".medterm4ds/cache/lookup-2026AA.duckdb")

CATEGORY_BY_KIND = {
    "condition": "condition",
    "condition_icd10": "condition",
    "medication": "medication",
    "lab": "lab",
    "vital": "lab",
    "social": "lab",
    "procedure": "procedure",
    "vaccine": "vaccine",
    "allergy": "condition",
}

FHIR_SYSTEM = {
    "SNOMEDCT_US": "http://snomed.info/sct",
    "RXNORM": "http://www.nlm.nih.gov/research/umls/rxnorm",
    "LNC": "http://loinc.org",
    "CVX": "http://hl7.org/fhir/sid/cvx",
    "ICD10CM": "http://hl7.org/fhir/sid/icd-10-cm",
}


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower())


def tokens(s):
    return set(norm(s).split()) - {
        "in", "of", "the", "and", "by", "or", "to", "mg", "mcg", "ml",
        "oral", "tablet", "unt", "for", "with", "a",
    }


def similarity(a, b):
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


DOSE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(mg|mcg|ml|unt|%)", re.I)


def dose_pairs(s):
    """Number-unit strength pairs, with MG<->MCG cross-forms included."""
    pairs = set()
    for value, unit in DOSE_RE.findall(s or ""):
        v = float(value)
        u = unit.lower()
        pairs.add((round(v, 4), u))
        if u == "mg" and v < 10:
            pairs.add((round(v * 1000, 4), "mcg"))
        if u == "mcg":
            pairs.add((round(v / 1000, 6), "mg"))
    return pairs


def dose_match(search, candidate):
    """True when every strength pair in the search term exists in the candidate."""
    required = dose_pairs(search)
    if not required:
        return True
    return dose_pairs(candidate).issuperset(required)



# Codes/displays the HL7 US Core validator flagged: LOINC short displays and
# canonical vital codes (UMLS long-name atoms drift otherwise).
OVERRIDES = {
    "vital.sbp": ("8480-6", "Systolic blood pressure"),
    "vital.dbp": ("8462-4", "Diastolic blood pressure"),
    "vital.hr": ("8867-4", "Heart rate"),
    "vital.rr": ("9279-1", "Respiratory rate"),
    "vital.temp": ("8310-5", "Body temperature"),
    "vital.spo2": ("2708-6", "Oxygen saturation in Arterial blood"),
    "vital.weight": ("29463-7", "Body weight"),
    "vital.height": ("8302-2", "Body height"),
    "vital.bmi": ("39156-5", "Body mass index"),
    "vital.peak_flow": ("33452-4", "Peak expiratory flow (PEF)"),
    "vital.bp_panel": ("85354-9", "Blood pressure panel with all children optional"),
    "lab.a1c": ("4548-4", "Hemoglobin A1c/Hemoglobin.total in Blood"),
    "lab.glucose": ("2339-0", "Glucose [Mass/volume] in Blood"),
    "lab.creatinine": ("2160-0", "Creatinine [Mass/volume] in Serum or Plasma"),
    "lab.egfr": ("33914-3", "Glomerular filtration rate/1.73 sq M.predicted"),
    "lab.potassium": ("2823-3", "Potassium [Moles/volume] in Serum or Plasma"),
    "lab.sodium": ("2951-2", "Sodium [Moles/volume] in Serum or Plasma"),
    "lab.ldl": ("18262-6", "Cholesterol in LDL [Mass/volume] in Serum or Plasma by Direct assay"),
    "lab.hdl": ("2085-9", "Cholesterol in HDL [Mass/volume] in Serum or Plasma"),
    "lab.trig": ("2571-8", "Triglyceride [Mass/volume] in Serum or Plasma"),
    "lab.total_chol": ("2093-3", "Cholesterol [Mass/volume] in Serum or Plasma"),
    "lab.alt": ("1742-6", "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma"),
    "lab.ast": ("1920-8", "Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma"),
    "lab.tsh": ("3016-3", "Thyrotropin [Units/volume] in Serum or Plasma"),
    "lab.free_t4": ("3024-7", "Thyroxine (T4) free [Mass/volume] in Serum or Plasma"),
    "lab.ferritin": ("2276-4", "Ferritin [Mass/volume] in Serum or Plasma"),
    "lab.esr": ("4537-7", "Erythrocyte sedimentation rate Westergren"),
    "lab.uacr": ("9318-7", "Albumin/Creatinine [Mass Ratio] in Urine"),
    "lab.inr": ("6301-6", "INR in Platelet poor plasma by Coagulation assay"),
    "lab.phq9": ("44249-1", "PHQ-9 total score"),
    "lab.gad7": ("70274-6", "GAD7 total score"),
    "lab.lithium_level": ("14334-7", "Lithium [Moles/volume] in Serum or Plasma"),
    "lab.calprotectin": ("82874-9", "Calprotectin [Mass/volume] in Stool"),
    "lab.feno": ("96269-6", "Nitric oxide [Volume fraction] in Exhaled gas"),
    "lab.troponin_i": ("10839-9", "Troponin I [Mass/volume] in Serum or Plasma"),
    "lab.ntprobnp": ("30934-4", "Natriuretic peptide B [Mass/volume] in Serum or Plasma"),
    "lab.ef_echo": ("10230-1", "Ejection fraction"),
    "lab.anti_ccp": ("32218-0", "Cyclic citrullinated peptide antibody"),
    "lab.dsdna": ("5130-0", "Double stranded DNA antibody"),
    "lab.tacrolimus_level": ("11253-2", "Tacrolimus [Mass/volume] in Blood"),
    "lab.afp": ("19176-7", "Alpha-1-Fetoprotein [Mass/volume] in Serum or Plasma"),
    "lab.hcv_rna": ("104714-1", "Hepatitis C virus RNA [#/volume] in Serum or Plasma by NAA with probe detection"),
    "lab.bilirubin_total": ("1975-2", "Bilirubin.total [Mass/volume] in Serum or Plasma"),
    "lab.albumin": ("1751-7", "Albumin [Mass/volume] in Serum or Plasma"),
    "lab.alk_phos": ("6768-6", "Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma"),
    "lab.phosphorus": ("2777-1", "Phosphate [Mass/volume] in Serum or Plasma"),
    "lab.calcium": ("17861-6", "Calcium [Moles/volume] in Serum or Plasma"),
    "lab.psa": ("2857-1", "Prostate specific Ag [Mass/volume] in Serum or Plasma"),
    "lab.bicarbonate": ("1963-8", "Bicarbonate [Moles/volume] in Serum or Plasma"),
    "lab.paco2": ("2019-8", "Carbon dioxide [Partial pressure] in arterial blood"),
    "lab.pao2": ("2703-7", "Oxygen [Partial pressure] in arterial blood"),
    "lab.blood_culture": ("600-7", "Microorganism identified in Blood by Culture"),
    "lab.reticulocytes": ("4679-7", "Reticulocytes/Erythrocytes [Fraction] in Blood"),
    "lab.hbf": ("32682-7", "Hemoglobin F/Hemoglobin.total in Blood by Electrophoresis"),
    "lab.hbelectro": ("94538-6", "Hemoglobin HPLC and electrophoresis panel in Blood"),
    "lab.ketones": ("53061-8", "Ketones [Moles/volume] in Blood"),
    "lab.anion_gap": ("33037-3", "Anion gap in Serum or Plasma"),
    "lab.nat_k": ("70182-1", "NIH stroke scale"),
    "lab.urine_protein": ("27298-9", "Protein [Mass/volume] in Urine"),
    "proc.cpap": ("47545007", "Continuous positive airway pressure ventilation treatment"),
    "lab.ttg_iga": ("31017-7", "Tissue transglutaminase IgA [Units/volume] in Serum"),
    "lab.eosinophils": ("713-8", "Eosinophils/100 leukocytes in Blood by Automated count"),
    "lab.fev1": ("20150-9", "FEV1"),
    "lab.fev1_fvc": ("19926-5", "FEV1/FVC"),
    "lab.vitamin_d": ("62292-8", "25-hydroxyvitamin D [Mass/volume] in Serum or Plasma"),
    "lab.cd4": ("24467-3", "CD3+CD4+ (T4 helper) cells [#/volume] in Blood"),
    "lab.hgb": ("718-7", "Hemoglobin [Mass/volume] in Blood"),
    "lab.wbc": ("6690-2", "Leukocytes [#/volume] in Blood by Automated count"),
    "lab.platelets": ("777-3", "Platelets [#/volume] in Blood by Automated count"),
    "lab.hct": ("4544-3", "Hematocrit [Volume Fraction] of Blood by Automated count"),
}

TERM = None


def apply_overrides(resolved):
    for row in resolved:
        ov = OVERRIDES.get(row["id"])
        if not ov:
            continue
        code, display = ov
        infos = TERM.lookup([(row["system"], code)])
        info = infos[0] if infos else None
        d = info.to_dict() if info else {}
        if not d.get("code"):
            raise SystemExit(f"override code invalid: {row['id']} {code}")
        row.update(code=code, display=display, method="override", cui=d.get("cui"), tty=d.get("tty"), suppress=d.get("suppress"))
    return resolved


def main():
    from medterm4ds.client import Terminology, open_duckdb_engine

    con, engine = open_duckdb_engine(DB)
    term = Terminology(engine, connection=con)
    global TERM
    TERM = term

    resolved = []
    review = []

    for entry in CATALOG:
        entry_id, kind, system, search = entry[0], entry[1], entry[2], entry[3]
        expect = entry[4] if len(entry) > 4 else None
        force = entry[5] if len(entry) > 5 else None
        row = {
            "id": entry_id,
            "kind": kind,
            "system": system,
            "search": search,
            "expect": expect,
        }

        if force:
            infos = term.lookup([(system, force)])
            info = infos[0] if infos else None
            d = info.to_dict() if info else {}
            if not d.get("code") or d.get("suppress") not in (None, "N", ""):
                review.append(f"FORCE-FAIL {entry_id}: {force} missing/suppressed")
                row.update(code=None, display=None, method="force-miss")
            else:
                row.update(
                    code=d["code"],
                    display=d["name"],
                    cui=d.get("cui"),
                    tty=d.get("tty"),
                    suppress=d.get("suppress"),
                    method="forced",
                    similarity=round(similarity(search, d["name"]), 2),
                )
            resolved.append(row)
            continue
        picks = []

        if system == "ICD10CM":
            infos = term.lookup([(system, search)])
            info = infos[0] if infos else None
            if info:
                d = info.to_dict()
            else:
                d = {}
            if d.get("code"):
                row.update(
                    code=d["code"],
                    display=d["name"],
                    cui=d.get("cui"),
                    tty=d.get("tty"),
                    suppress=d.get("suppress"),
                    method="lookup",
                )
            else:
                row.update(code=None, display=None, method="lookup-miss")
                review.append(f"MISS  {entry_id}: ICD-10 {search} not found")
            resolved.append(row)
            continue

        try:
            results = term.search(search, sources=system, mode="hybrid", limit=12)
        except Exception as exc:  # search backend hiccup
            results = []
            review.append(f"ERROR {entry_id}: search failed: {exc}")

        for r in results:
            if r.source != system:
                continue
            picks.append((r.code, r.display, r.score))

        if not picks:
            row.update(code=None, display=None, method="search-miss")
            review.append(f"MISS  {entry_id}: no {system} hits for {search!r}")
            resolved.append(row)
            continue

        ranked = []
        for i, (code, display, score) in enumerate(picks):
            dm = dose_match(search, display)
            sim = similarity(search, display)
            ranked.append((dm, sim, -i, code, display, score))
        ranked.sort(reverse=True)
        _, _, _, code, display, score = ranked[0]
        method = "rerank"

        infos = term.lookup([(system, code)])
        info = infos[0] if infos else None
        d = info.to_dict() if info else {}
        if not d.get("code"):
            row.update(code=None, display=None, method="verify-miss")
            review.append(f"MISS  {entry_id}: {system} {code} failed verification lookup")
            resolved.append(row)
            continue

        row.update(
            code=d["code"],
            display=d["name"],
            cui=d.get("cui"),
            tty=d.get("tty"),
            suppress=d.get("suppress"),
            search_score=round(float(score), 3),
            method=method,
        )

        sim = similarity(search, d["name"])
        row["similarity"] = round(sim, 2)
        if d.get("suppress") not in (None, "N", ""):
            review.append(f"SUPP  {entry_id}: {code} '{d['name']}' suppress={d['suppress']}")
        if sim < 0.35:
            review.append(
                f"LOWSIM {entry_id}: search={search!r} -> {code} '{d['name']}' sim={sim:.2f} "
                f"[{' | '.join(f'{c} {n}' for c, n, _ in picks[:3])}]"
            )
        if expect and expect != code:
            review.append(
                f"EXPECT {entry_id}: expected {expect}, picked {code} '{d['name']}'"
            )
        resolved.append(row)

    resolved = apply_overrides(resolved)

    con.close()
    out = HERE / "catalog.resolved.json"
    for row in resolved:
        row["fhirSystem"] = FHIR_SYSTEM.get(row["system"], row["system"])
    out.write_text(json.dumps({"db": DB, "entries": resolved}, indent=1) + "\n")

    lines = [
        f"{'OK' if not review else 'NEEDS REVIEW'}: {len(resolved)} entries, {len(review)} flags",
        "=" * 70,
    ]
    lines.extend(review)
    for row in resolved:
        lines.append(
            f"{row['id']:<42} {row['system']:<10} {str(row.get('code')):<20} {row.get('display')}"
        )
    (HERE / "catalog.review.txt").write_text("\n".join(lines) + "\n")

    print(f"{len(resolved)} entries resolved -> {out.name}")
    print(f"{len(review)} flags -> catalog.review.txt")


if __name__ == "__main__":
    main()
