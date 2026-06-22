# fhir4px Data Delivery Specification

**Version:** 3.0 (final)
**Date:** 2026-06-21
**Audience:** medterm4ds data team

---

## Principle

The model team provides source data assets. The app team builds runtime indexes (BM25, lookup tables) from those assets. All source data ships from one place on a schedule.

---

## Direct answers to your open questions

**"Pre-expand vs ingredient-only for the SNOMED portion?"**

**Ingredient-only. Do not pre-expand.** The numbers are clear — 712MB is infeasible. Runtime ingredient decomposition is a single Map lookup, negligible cost. Keep all associations at ingredient level (RxNorm TTY=IN).

**"Should we add icd10_code to embedding_index_condition.jsonl?"**

**Yes.** Add it. You have the CUI data and the shortest-code picking rule. We don't want to reimplement that logic. For each condition entry:
- If the entry is ICD-10: `icd10_code` = own code
- If the entry is SNOMED with an ICD-10 equivalent (shares a CUI): `icd10_code` = shortest ICD-10 code sharing that CUI
- If the entry is SNOMED without an ICD-10 equivalent: `icd10_code` = null

This is a ~10-line addition to `build_embedding_index_full.py`.

---

## What the model team provides

### 1. embedding_index_*.jsonl (source data, 5 categories)

Already produced. Two additions needed:

**Add to `embedding_index_condition.jsonl` entries:**
```jsonc
{
  "code": { "source": "SNOMEDCT_US", "code": "44054006", ... },
  "friendly_name": "Diabetes Type 2",
  "icd10_code": "E11",          // NEW — ICD-10 equivalent via CUI crosswalk. null if none.
  "vectors": { ... }
}
```

**Already present in `embedding_index_medication.jsonl` entries (confirm):**
```jsonc
{
  "code": { "source": "RXNORM", "code": "860975", ... },
  "friendly_name": "Metformin Oral Product",
  "atc": { "level1": "A", ... },
  "ingredient_codes": ["6809"],          // NEW — RxNorm ingredient codes per entry
                                         // IN entries: [self]
                                         // SCD/SBD/SCDG: ingredient codes via JOIN with rxnorm_ingredient_decomposition.csv
                                         // BN/PIN without ingredients: []
  "vectors": { ... }
}
```

### 2. condition_associations.json

Condition → lab + medication associations at ingredient level.

**Key:** bare condition code. ICD-10 codes (`E11`) and SNOMED codes (`44054006`) coexist — no prefix needed (ICD-10 starts with letter, SNOMED is pure numeric, cannot collide).

**Sources:**
- Medications: full UMLS `may_treat` + `may_prevent` from `condition_medication_ingredient.csv`, depths 0–4 (exclude depth 5), both ICD-10 and SNOMED condition codes
- Labs: app team's Synthea-curated baseline (34 conditions, we provide code-keyed), extended with UMLS monitoring where available

**Medication codes:** RxNorm ingredient codes only (TTY=IN). NOT pre-expanded to product level.

**Structure:**
```json
{
  "_meta": {
    "schema_version": "1.0",
    "generated_at": "2026-06-21T00:00:00:00Z"
  },
  "E11": {
    "labs": [
      {"code": "4548-4", "strength": "strong"},
      {"code": "2339-0", "strength": "strong"},
      {"code": "3094-0", "strength": "weak"}
    ],
    "medications": [
      {"code": "6809", "strength": "strong", "relationship": "treats"},
      {"code": "161", "strength": "strong", "relationship": "treats"},
      {"code": "1191", "strength": "moderate", "relationship": "treats"},
      {"code": "854899", "strength": "weak", "relationship": "prevents"}
    ]
  },
  "44054006": {
    "labs": [
      {"code": "4548-4", "strength": "strong"}
    ],
    "medications": [
      {"code": "6809", "strength": "strong", "relationship": "treats"}
    ]
  }
}
```

**Field rules:**

| Field | Labs | Medications |
|---|---|---|
| `code` | Bare LOINC code | Bare RxNorm ingredient code (TTY=IN) |
| `strength` | `"strong"` / `"moderate"` / `"weak"` | Same |
| `relationship` | Not needed (implicit: monitors) | `"treats"` or `"prevents"` |

**Strength from match_depth:**

| match_depth | Strength |
|---|---|
| 0–1 | strong |
| 2 | moderate |
| 3–4 | weak |
| 5 | excluded |

**Size:** ~50MB raw / ~8MB gzipped.

### 3. rxnorm-ingredients.json

Product code → ingredient codes. Already exists in this format.

```json
{
  "860975": [{"c": "6809", "n": "metformin"}],
  "1000000": [{"c": "17767", "n": "amlodipine"}, {"c": "321064", "n": "olmesartan"}, {"c": "5487", "n": "hydrochlorothiazide"}]
}
```

Source: `rxnorm_ingredient_decomposition.csv` → JSON. Size: ~5.4MB.

### 4. patient_friendly_names (per-system JSON files)

Already produced. No changes needed. The app loads these for Tier 1 deterministic lookup (code → friendly name).

---

## What the app team builds from model team data

### BM25 indexes (5 categories)

The app team builds BM25 inverted indexes from `embedding_index_*.jsonl`. Each index adds:

```jsonc
{
  // Standard BM25 fields (built from JSONL search texts)
  "names": [...],                    // technical names per record
  "postings": { ... },
  "idf": { ... },
  "doc_lengths": [...],
  "avg_doc_length": 8.5,

  // Per-record metadata (extracted from JSONL at build time)
  "rid_to_code": [...],              // code per record
  "rid_to_system": [...],            // system per record
  "rid_to_friendly_name": [...],     // patient-friendly name per record
  "rid_to_canonical_code": [...],    // for conditions: icd10_code (or SNOMED fallback). For other categories: same as code.
  "rid_to_canonical_system": [...],  // "icd10" | "snomed" | "rxnorm" | "loinc" | ...

  // Medication only
  "rid_to_ingredient_codes": [...]   // copied from embedding_index_medication.jsonl ingredient_codes field
}
```

### Canonical code computation (conditions only)

At BM25 build time, for each condition entry:
1. If `icd10_code` is present → `canonical_code = icd10_code`, `canonical_system = "icd10"`
2. If `icd10_code` is null but the entry has associations data → `canonical_code = own SNOMED code`, `canonical_system = "snomed"`
3. No associations data → `canonical_code = null`

### Runtime flow

```
FHIR Condition (code: snomed:44054006)
  │
  ├─ Tier 1: patient_friendly_names lookup
  │   → friendly name + code + system
  │   → canonical_code from BM25 index: "E11" (from icd10_code field)
  │
  └─ Tier 2: BM25 search
      → { friendly_name, code, system, canonical_code, canonical_system, score }

FHIR MedicationRequest (code: rxnorm:860975)
  │
  ├─ Tier 1: patient_friendly_names lookup
  │   → friendly name + code + system
  │   → ingredient_codes from BM25 index: ["6809"] (from rid_to_ingredient_codes)
  │
  └─ Tier 2: BM25 search
      → { friendly_name, code, system, ingredient_codes, score }

Downstream:
  condition_associations["E11"] → labs + medications
  ingredient "6809" → scan associations → conditions that treat with it → E11
  gbd_weights["E11"] → 0.63 (ICD-10 canonical only)
  reference_ranges[loinc_code] → { low, high, unit }
```

---

## App team provides as inputs

| File | Content | Status |
|---|---|---|
| `gbd_disability_weights.json` | 5,111 ICD-10 codes → DW | Ready |
| `reference_ranges.json` | 35 ACP labs with ranges | Ready |
| `synthea_condition_lab_codes.json` | 34 conditions → LOINC codes (crosswalk) | Will provide |

---

## What gets removed after migration

| Asset | Why |
|---|---|
| `canonical-codes/` (3 files, 11MB) | BM25 index carries canonical_code directly |
| `condition_lab_relationships.json` | Replaced by condition_associations.json |
| `condition_medication_relationships.json` | Replaced by condition_associations.json |
| `rxnorm_ingredient_decomposition.csv` (raw source) | Replaced by rxnorm-ingredients.json |

---

## Naming rules

**Disambiguation:** If two lab concepts share the same friendly_name but have different reference ranges, separate entries with disambiguated names ("Creatinine, Serum" vs "Creatinine, Urine").

**Short name:** friendly_name = shortest patient-comprehensible form. No technical qualifiers.

**Picking rule (per concept):** MEDLINEPLUS source preferred → fall back to shortest → keep others as aliases/search texts.

---

## Build cadence

| Source data | Update frequency |
|---|---|
| `embedding_index_*.jsonl` | Per UMLS release (~2× yearly) |
| `condition_associations.json` | UMLS release + curated updates |
| `rxnorm-ingredients.json` | Per UMLS release |
| `reference_ranges.json` | Ad-hoc (curated) |
| `gbd_disability_weights.json` | Annual (IHME) |

Each file carries `schema_version` and `generated_at`.
