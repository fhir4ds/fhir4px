# fhir4px Unified Concept Index — Data Specification

**Version:** 2.0-draft
**Date:** 2026-06-21
**Audience:** medterm4ds data team

---

## Overview

This spec defines a **two-layer** JSONL format for concept indexes. The two layers separate concerns that have different requirements:

- **Code layer** — one entry per code (LOINC, ICD-10, RxNorm, SNOMED, CPT, CVX). Carries identity and search texts. This is what BM25 searches against and what Tier 1 lookups match.
- **Concept layer** — one entry per concept (UMLS CUI). Carries metadata (friendly name, reference ranges, GBD weights, associations). This is the single source of truth for everything downstream.

The layers are linked by **UMLS CUI** — every code entry carries a `cui` field pointing to its concept. Two O(1) Map lookups at runtime: code → CUI → metadata. No decomposition, no canonicalization, no name matching.

---

## Why this format

**Current problems:**

| Problem | Example |
|---|---|
| Naming returns a name, not a code | BM25 resolves "Type 2 diabetes mellitus" → "Diabetes Type 2", but the app needs the ICD-10 code E11 downstream |
| Reverse name→code lookup is fragile | "Type 2 Diabetes" vs "Diabetes Type 2" — canonical-codes table has to match exactly |
| BM25 on canonical codes misses | BM25 searched only against canonical concept names. When tested against all individual codes (including brand names, product names, synonyms), accuracy improved significantly |
| Medication decomposition fails | MedicationRequest carries product code 860975, but associations are keyed by ingredient code — requires runtime decomposition that's unreliable |
| Data is scattered across 8+ files | GBD weights, reference ranges, condition-lab associations, condition-med associations, canonical codes are all separate |

**This format solves all of these:**

- Every code that can appear on a FHIR resource gets its own entry with search texts — BM25 matches against all of them
- The code → CUI mapping is explicit in the data (not computed at runtime)
- Metadata lives once per concept (DRY), keyed by CUI
- Associations reference CUIs (stable across terminology updates)

---

## File deliverables

Two files per category — a code file and a concept file:

| Code files (one entry per code) | Concept files (one entry per CUI) |
|---|---|
| `condition_codes.jsonl` | `condition_concepts.jsonl` |
| `lab_codes.jsonl` | `lab_concepts.jsonl` |
| `medication_codes.jsonl` | `medication_concepts.jsonl` |
| `procedure_codes.jsonl` | `procedure_concepts.jsonl` |
| `vaccine_codes.jsonl` | `vaccine_concepts.jsonl` |
| `encounter_type_codes.jsonl` | `encounter_type_concepts.jsonl` |

Estimated sizes:

| Category | Code entries | Concept entries |
|---|---|---|
| Conditions | ~280K (ICD-10 + SNOMED) | ~100K |
| Labs | ~500K (LOINC + SNOMED) | ~165K |
| Medications | ~42K (RxNorm product + ingredient) | ~10K |
| Procedures | ~300K (CPT + ICD-10-PCS + SNOMED) | ~150K |
| Vaccines | ~300 (CVX + SNOMED) | ~100 |
| Encounter types | ~230 (CPT + SNOMED) | ~60 |

Total compressed: ~30–40MB gzipped (code files are the bulk; concept files are small).

---

## Layer 1: Code entries

One line per code. This is what BM25 searches against and what Tier 1 lookups match.

```jsonc
{
  "code": "E11.9",                    // The actual code string
  "system": "icd10",                  // "icd10" | "loinc" | "rxnorm" | "snomed" | "cpt" | "cvx" | "icd10pcs"
  "cui": "C0011847",                  // UMLS Concept Unique Identifier — links to the concept layer

  // Search texts (feeds BM25 inverted index + embedding prototypes)
  "search_texts": [                   // All text variants for this specific code
    "Type 2 diabetes mellitus, without complications",
    "Type II diabetes mellitus without complication",
    "E11.9"
  ]
}
```

### Code entry rules

- **Every code** that can appear on a FHIR resource gets an entry — including product-level RxNorm codes (860975 for metformin 500MG Oral Tablet), subcategory ICD-10 codes (E11.9, E11.65), and SNOMED equivalents
- **Multiple codes map to the same CUI** — E11, E11.9, E11.65, SNOMED 44054006 all carry `cui: "C0011847"`
- **Search texts are per-code** — each code has its own technical name, brand name, and synonyms. This is what makes BM25 work at the individual code level
- Include the code string itself in `search_texts` for exact-code matching

### Example: medication codes

```jsonl
{"code":"860975","system":"rxnorm","cui":"C0025598","search_texts":["metformin 500 MG Oral Tablet","Glucophage 500 MG","metformin 500MG"]}
{"code":"860976","system":"rxnorm","cui":"C0025598","search_texts":["metformin 1000 MG Oral Tablet","Glumetza 1000 MG","metformin 1000MG"]}
{"code":"860977","system":"rxnorm","cui":"C0025598","search_texts":["metformin 850 MG Oral Tablet","Glucophage 850 MG"]}
{"code":"6809","system":"rxnorm","cui":"C0025598","search_texts":["metformin","metformin ingredient"]}
```

All four RxNorm codes (three products + one ingredient) map to CUI C0025598 (metformin). BM25 searches against all four — so "Glucophage 500 MG" matches code 860975, not just the ingredient entry.

---

## Layer 2: Concept entries

One line per concept (CUI). Carries all metadata. This is the single source of truth.

### Common fields (all categories)

```jsonc
{
  "cui": "C0011847",                  // UMLS CUI — the primary key
  "friendly_name": "Diabetes Type 2", // Patient-friendly display name (Title Case)
  "category": "condition",            // "condition" | "lab" | "medication" | "procedure" | "vaccine" | "encounter_type"
  "aliases": [                        // Alternative patient-facing names
    "Type 2 Diabetes",
    "T2DM"
  ]
}
```

### Condition-specific fields

```jsonc
{
  "cui": "C0011847",
  "friendly_name": "Diabetes Type 2",
  "category": "condition",
  "aliases": ["Type 2 Diabetes", "T2DM"],

  "gbd_dw": 0.63,                     // GBD 2023 disability weight (max across sequelae). 0 if not available.

  "associated_labs": [                // CUIs of lab concepts that monitor/diagnose this condition
    "C0487664",                       // Hemoglobin A1c
    "C0017745"                        // Glucose measurement
  ],
  "associated_meds": [                // CUIs of medication concepts that treat this condition
    "C0025598",                       // Metformin
    "C0398983"                        // Insulin Lispro
  ]
}
```

### Lab-specific fields

```jsonc
{
  "cui": "C0487664",
  "friendly_name": "Hemoglobin A1c",
  "category": "lab",
  "aliases": ["HbA1c", "A1C", "Glycated Hemoglobin"],

  "observation_category": "lab",      // "lab" | "vital" | "other"

  "reference_ranges": {
    "default": { "low": 4.0, "high": 5.6, "unit": "%", "note": "5.7-6.4 prediabetes" },
    "male": { "low": 13.5, "high": 17.5, "unit": "g/dL" },     // Only when sex-specific
    "female": { "low": 12.0, "high": 15.5, "unit": "g/dL" }
  },

  "associated_conditions": [           // CUIs of condition concepts this lab monitors
    "C0011847",                        // Diabetes Type 2
    "C0011849"                         // Diabetes Type 1
  ],
  "molecular_weight": null             // For unit conversion (mg/dL ↔ mmol/L). Null if not needed.
}
```

### Medication-specific fields

```jsonc
{
  "cui": "C0025598",
  "friendly_name": "Metformin",
  "category": "medication",
  "aliases": ["Glucophage"],

  "drug_class": "Biguanide",
  "ingredients": ["metformin"],        // Active ingredient names (lowercase)

  "associated_conditions": [           // CUIs of condition concepts this medication treats
    "C0011847"
  ],
  "monitoring_labs": [                 // CUIs of lab concepts that monitor this medication
    "C0700323"                         // Creatinine measurement
  ]
}
```

### Procedure-specific fields

```jsonc
{
  "cui": "...",
  "friendly_name": "Colonoscopy",
  "category": "procedure"
}
```

### Vaccine-specific fields

```jsonc
{
  "cui": "...",
  "friendly_name": "COVID-19 Vaccine",
  "category": "vaccine",
  "vaccine_type": "COVID-19",
  "trade_names": ["Spikevax", "Comirnaty"]
}
```

### Encounter type-specific fields

```jsonc
{
  "cui": "...",
  "friendly_name": "Evaluation and Management",
  "category": "encounter_type",
  "encounter_class": "outpatient"      // "outpatient" | "emergency" | "inpatient" | "telehealth" | "procedure"
}
```

---

## Field requirements

### Code entries

| Field | Required? | Notes |
|---|---|---|
| `code` | **Required** | The code string |
| `system` | **Required** | Lowercase code system identifier |
| `cui` | **Required** | UMLS CUI linking to the concept layer |
| `search_texts` | **Required** | Minimum: the code's UMLS preferred term + the code string itself |

### Concept entries

| Field | Required? | Notes |
|---|---|---|
| `cui` | **Required** | UMLS CUI — the primary key |
| `friendly_name` | **Required** | Title Case, patient-friendly |
| `category` | **Required** | One of the 6 categories |
| `aliases` | Recommended | Improves match rate and grouping |
| `gbd_dw` | Conditions only | 0 if not in GBD |
| `reference_ranges` | Labs only | Skip if no standard range exists |
| `observation_category` | Labs | "lab", "vital", or "other" |
| `associated_labs` | Conditions | CUIs; empty array if none |
| `associated_meds` | Conditions | CUIs; empty array if none |
| `associated_conditions` | Labs, Meds | CUIs; empty array if none |
| `monitoring_labs` | Meds | CUIs; empty array if none |
| `molecular_weight` | Labs | For unit conversion; null if not needed |
| `encounter_class` | Encounter types | Suggested class mapping |

---

## Why CUI as the concept key

UMLS CUIs (Concept Unique Identifiers) are the right choice for the concept layer:

| Property | CUI | Canonical code |
|---|---|---|
| Terminology-agnostic | ✓ (works across ICD-10, SNOMED, LOINC, RxNorm) | ✗ (must pick one system) |
| Stable across releases | ✓ (CUIs persist across UMLS versions) | ~ (codes can be retired/reorganized) |
| Already in source data | ✓ (every UMLS row has a CUI) | ✗ (must designate a primary code) |
| Associations reference concepts | ✓ (diabetes CUI → HbA1c CUI) | ~ (must resolve code→code across systems) |
| New code added for existing concept | ✓ (just add code entry with same CUI) | ✗ (must update crosswalk on canonical entry) |

**Example:** When a new LOINC code (99999-9) is added for Hemoglobin A1c, the model team adds one code entry:
```jsonl
{"code":"99999-9","system":"loinc","cui":"C0487664","search_texts":["Hemoglobin A1c new method","99999-9"]}
```
No concept entry changes needed. No association updates needed. The new code automatically inherits all metadata and associations through the CUI link.

---

## Naming and grouping rules

### Disambiguation rule (critical)

If two concepts share the same `friendly_name` but have **different clinical meanings or reference ranges**, they MUST be separate concept entries (different CUIs) with disambiguated names.

| Problem case | Wrong | Right |
|---|---|---|
| Serum vs urine creatinine | "Creatinine" (same CUI) | Two CUIs: "Creatinine, Serum" + "Creatinine, Urine" |
| Total vs ionized calcium | "Calcium" (same CUI) | Two CUIs: "Calcium, Total" + "Calcium, Ionized" |
| Blood vs urine glucose | "Glucose" (same CUI) | Two CUIs: "Glucose, Blood" + "Glucose, Urine" |

**Rule of thumb**: if a patient would be confused seeing two different values under the same name, or if the reference ranges differ, they are different concepts.

### Short-name rule

`friendly_name` should be the **shortest patient-comprehensible form**:

| Code | Technical name | Good friendly_name | Bad friendly_name |
|---|---|---|---|
| LOINC 2339-0 | "Glucose [Mass/volume] in Blood" | "Glucose" | "Glucose [Mass/volume] in Blood" |
| LOINC 4548-4 | "Hemoglobin A1c/Hemoglobin.total in Blood" | "Hemoglobin A1c" | "Hemoglobin A1c/Hemoglobin.total in Blood" |
| LOINC 787-2 | "Erythrocyte mean corpuscular volume" | "MCV" | "Erythrocyte Mean Corpuscular Volume" |
| SNOMED 44054006 | "Type 2 diabetes mellitus" | "Diabetes Type 2" | "Type 2 Diabetes Mellitus (disorder)" |

---

## Runtime resolution flow

```
FHIR resource with code (e.g., rxnorm:860975)
  │
  ├─ Tier 1: Direct lookup in medication_codes by (rxnorm, 860975)
  │   → { cui: "C0025598", search_texts: [...] }
  │   → Lookup medication_concepts["C0025598"]
  │   → { friendly_name: "Metformin", associated_conditions: [...], monitoring_labs: [...] }
  │   → Done.
  │
  └─ No code or code not in index:
      │
      ├─ Tier 2: BM25 search against ALL medication_codes search_texts
      │   → Matches code entry (e.g., "Glucophage 500 MG" → code 860975)
      │   → Returns cui: "C0025598"
      │   → Lookup medication_concepts["C0025598"] → full metadata
      │
      └─ No confident BM25 match:
          │
          ├─ Tier 3: LLM fallback (optional)
          │
          └─ Source label (no concept, no associations)
```

**Key differences from today:**
- Resolution returns a **CUI** at every tier (not just a name)
- Downstream lookups (GBD weight, reference ranges, associations) are **CUI-keyed** — no name→code reverse resolution
- BM25 searches against **all codes** (products, brands, synonyms) — not just canonical concept names
- Medication→condition matching is **direct** (no ingredient decomposition at runtime)

---

## Existing curated data to incorporate

### Condition → Lab associations

**Source:** `public/terminology/condition_lab_relationships.json` (app-team curated from Synthea modules)
**Content:** 34 conditions → labs, keyed by patient-friendly name
**NOTE:** This is a limited curated set (~280 pairs). The model team should expand coverage using UMLS monitoring relationships or other clinical sources. The Synthea data serves as a validation baseline.

These become `associated_labs` arrays (CUIs) on condition concept entries.

### Condition → Medication associations

**Source:** `medterm4ds/reports/fhir4px/condition_medication_ingredient.csv`
**Content:** 2,984,438 rows — UMLS `may_treat` for ALL ICD-10 conditions × RxNorm ingredients
**Columns:** `condition_source, condition_code, condition_name, match_depth, medication_rxnorm_code, medication_name, relationship_type`

**IMPORTANT:** Include ALL conditions and ALL may_treat relationships. Do NOT filter to a subset.

These become `associated_meds` arrays (CUIs) on condition concept entries.

### Reference ranges

**Source:** `public/terminology/reference_ranges.json`
**Content:** 35 common adult labs with ACP-style ranges, sex-specific where needed

These become `reference_ranges` objects on lab concept entries.

### GBD disability weights

**Source:** `public/terminology/gbd_disability_weights.json`
**Content:** 5,111 ICD-10 codes → disability weight (max across sequelae)

These become `gbd_dw` values on condition concept entries.

---

## What the app builds from this data

Build-time scripts transform the JSONL files into:

1. **BM25 inverted index** — built from ALL code entries' `search_texts` per category. Every code, every brand name, every synonym is searchable.
2. **Code → CUI lookup table** — `Map<(system, code), cui>` for Tier 1 direct lookup. O(1).
3. **CUI → concept lookup table** — `Map<cui, ConceptRecord>` for metadata retrieval. O(1).
4. **Association adjacency lists** — flattened from `associated_labs`, `associated_meds`, etc. on concept entries.
5. **Embedding prototype centroids** — pre-computed from code entries' `search_texts` grouped by CUI at build time.

All generated at build time, served as static JSON assets.

---

## Data sources

The model team can build the unified index from data they already produce:

| Field | Source |
|---|---|
| Code entries (code, system, search_texts) | UMLS MRCONSO (all atoms per CUI, filtered by source vocabulary) |
| CUI linking | UMLS MRCONSO (every row has a CUI) |
| `friendly_name`, `aliases` | `patient_friendly_names.csv` (1.1M rows) |
| `gbd_dw` | IHME GBD 2023 DIRF Appendix 1 (S9 + S13 join) |
| `associated_labs` | Synthea curated (34 conditions) + UMLS monitoring relationships |
| `associated_meds` | `condition_medication_ingredient.csv` (2.98M rows, UMLS `may_treat`) |
| `reference_ranges` | ACP reference ranges (35 labs, app-team curated) |
| `molecular_weight` | UMLS or PubChem |
| `monitoring_labs` | UMLS monitoring relationships |
| `observation_category` | LOINC classification (CLASS field) |
| `encounter_class` | SNOMED/CPT hierarchy mapping |

---

## Migration path

Additive — existing data assets continue to work alongside the unified index:

1. **Phase 1**: Model team delivers code + concept JSONL files
2. **Phase 2**: App build scripts generate BM25 indexes + CUI lookup tables from unified files
3. **Phase 3**: App resolver updated to return CUIs (not just names) at every tier
4. **Phase 4**: Remove canonical-codes tables, GBD weights file, reference-ranges file, association files (now in concept entries)
5. **Phase 5**: Remove patient-friendly lookup tables (replaced by code → CUI → concept lookup)

---

## Open questions

1. **CUI coverage**: UMLS assigns CUIs to ~4.5M concepts. How many of the ~500K LOINC codes have CUIs? Codes without CUIs need a fallback (generate a synthetic concept_id, or skip).

2. **Association completeness**: Current condition_lab_relationships.json covers 34 conditions. UMLS monitoring relationships may cover more. Should we use UMLS exclusively, or merge with the Synthea baseline?

3. **Build cadence**: UMLS updates twice yearly (AA releases). How often should the unified indexes be rebuilt? (Suggestion: per UMLS release + ad-hoc for curated additions.)

4. **Concept merging**: Some UMLS CUIs are overly granular (e.g., separate CUIs for "Diabetes mellitus type 2" and "Type 2 diabetes"). Should we merge these at build time?

5. **Embedding prototype pre-computation**: Pre-compute centroids at build time from search_texts and embed them in the concept file as a `centroid` field. Eliminates ~200ms runtime centroid computation. Should we do this?
