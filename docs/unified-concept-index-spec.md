# fhir4px Unified Concept Index — Data Specification

**Version:** 1.0-draft
**Date:** 2026-06-21
**Audience:** medterm4ds data team

---

## Overview

This spec defines a unified JSONL format for concept indexes that replaces the current patchwork of CSVs, JSONL files, and separately-built JSON assets. Each category (conditions, labs, medications, procedures, vaccines, encounter types) ships as one JSONL file where every line is a **concept record** carrying everything the app needs: code, patient-friendly name, search texts for BM25 and embeddings, and all downstream metadata (reference ranges, associations, disability weights, etc.).

The app consumes these files directly — one loader per category, no intermediate conversion scripts. BM25 inverted indexes and embedding prototype centroids are built at app build time from the `search_texts` field.

---

## Why this format

**Current problems:**

| Problem | Example |
|---|---|
| Naming returns a name, not a code | BM25 resolves "Type 2 diabetes mellitus" → "Diabetes Type 2", but the app needs the ICD-10 code E11 downstream |
| Reverse name→code lookup is fragile | "Type 2 Diabetes" vs "Diabetes Type 2" — canonical-codes table has to match exactly |
| Data is scattered across 6+ files | GBD weights, reference ranges, condition-lab associations, condition-med associations are all separate |
| Multiple data formats | CSVs (patient-friendly names), JSONL (embedding indexes), JSON (built assets) |
| Build pipeline is complex | 5+ scripts convert raw data into app-ready formats |

**This format solves all of these:** naming returns the code directly, downstream lookups are code-keyed O(1), and one file per category carries everything.

---

## File deliverables

One JSONL file per category:

| File | Required codes | ~Entries |
|---|---|---|
| `condition_index.jsonl` | ICD-10-CM + SNOMED CT | ~100K |
| `lab_index.jsonl` | LOINC | ~115K |
| `medication_index.jsonl` | RxNorm (ingredient + product level) | ~42K |
| `procedure_index.jsonl` | CPT + ICD-10-PCS + SNOMED CT | ~150K |
| `vaccine_index.jsonl` | CVX | ~300 |
| `encounter_type_index.jsonl` | CPT + SNOMED CT | ~230 |

Each file is newline-delimited JSON (JSONL). One concept per line. Files are gzipped for transport (~22MB total compressed based on current data volumes).

---

## Concept record schema

### Common fields (all categories)

```jsonc
{
  // ── Identity ──────────────────────────────────────────────
  "code": "E11",                    // The canonical code (string)
  "system": "icd10",                // Code system: "icd10" | "loinc" | "rxnorm" | "snomed" | "cpt" | "cvx" | "icd10pcs"
  "friendly_name": "Diabetes Type 2", // Patient-friendly display name (Title Case)

  // ── Search texts (feeds BM25 + embedding centroids) ──────
  "aliases": [                       // Alternative names patients might see
    "Type 2 Diabetes",
    "T2DM",
    "Diabetes Mellitus Type 2"
  ],
  "search_texts": [                  // All text variants for matching (technical names, brand names, synonyms, hierarchy terms)
    "Type 2 diabetes mellitus",      // The UMLS preferred term
    "Type II diabetes mellitus",     // Synonym
    "Non-insulin-dependent diabetes", // Abbreviation/alternate
    "E11"                            // Include the code itself for exact-code search
  ],

  // ── Classification (category-specific, see below) ────────
  "category": "condition"            // Top-level bucket: "condition" | "lab" | "medication" | "procedure" | "vaccine" | "encounter_type"
}
```

### Condition-specific fields

```jsonc
{
  // ... common fields ...

  // Priority scoring
  "gbd_dw": 0.63,                   // WHO/IHME GBD 2023 disability weight (max across sequelae). 0 if not available.

  // Associations (code-keyed, cross-references to other index entries)
  "associated_labs": [               // LOINC codes for labs that monitor/diagnose this condition
    "4548-4",                        // HbA1c
    "2339-0"                         // Glucose
  ],
  "associated_meds": [               // RxNorm codes for medications that treat this condition (ingredient-level preferred)
    "860975",                        // Metformin
    "197366"                         // Lisinopril
  ]
}
```

### Lab-specific fields

```jsonc
{
  // ... common fields ...

  // Sub-classification (for embedding prototype if needed)
  "observation_category": "lab",     // "lab" | "vital" | "other" — used for grouping

  // Reference ranges
  "reference_ranges": {              // ACP or standard reference ranges
    "default": {                     // Sex-agnostic range
      "low": 4.0,
      "high": 5.6,
      "unit": "%",                   // UCUM unit code
      "note": "5.7-6.4 prediabetes; >=6.5 diabetes"
    },
    "male": { "low": 13.5, "high": 17.5, "unit": "g/dL" },   // Optional: sex-specific
    "female": { "low": 12.0, "high": 15.5, "unit": "g/dL" }  // Optional: sex-specific
  },

  // Cross-references
  "associated_conditions": [          // ICD-10 codes for conditions this lab monitors
    "E11",                            // Diabetes Type 2
    "E10"                             // Diabetes Type 1
  ],
  "molecular_weight": 180.16,        // For unit conversion (mg/dL ↔ mmol/L). Null if not needed.

  // Alternate LOINC codes that map to this same concept
  "alternate_codes": ["41995-2"]      // LOINC codes that resolve to the same friendly name + range
}
```

### Medication-specific fields

```jsonc
{
  // ... common fields ...

  // Drug classification
  "drug_class": "Biguanide",          // Therapeutic class (ATC Level 3 or similar)
  "ingredients": ["metformin"],       // Active ingredients (lowercase)

  // Cross-references
  "associated_conditions": [           // ICD-10 codes for conditions this medication treats
    "E11"
  ],
  "monitoring_labs": [                // LOINC codes for labs that monitor this medication
    "38483-4"                         // Creatinine
  ],

  // RxNorm decomposition (for brand→generic matching)
  "rxnorm_ingredients": ["860975"],   // RxNorm ingredient CUIs
  "dose_form": "Oral Tablet"          // Dosage form if known
}
```

### Procedure-specific fields

```jsonc
{
  // ... common fields ...
  // No additional required fields beyond common.
  // Optional: "body_site", "specialty" if available
}
```

### Vaccine-specific fields

```jsonc
{
  // ... common fields ...
  "vaccine_type": "COVID-19",         // Vaccine family for grouping
  "trade_names": ["Spikevax", "Moderna"] // Brand names
}
```

### Encounter type-specific fields

```jsonc
{
  // ... common fields ...
  "encounter_class": "outpatient"     // Suggested default class: "outpatient" | "emergency" | "inpatient" | "telehealth" | "procedure"
}
```

---

## Field requirements

| Field | Required? | Notes |
|---|---|---|
| `code` | **Required** | Must be unique within (system, code) |
| `system` | **Required** | Lowercase code system name |
| `friendly_name` | **Required** | Title Case, patient-friendly |
| `aliases` | Recommended | Improves BM25/embedding match rate |
| `search_texts` | **Required** | Minimum: the UMLS preferred term + code. More entries = better matching |
| `category` | **Required** | One of the 6 categories |
| `gbd_dw` | Conditions only | 0 if not in GBD |
| `reference_ranges` | Labs only | Skip if no standard range exists |
| `associated_labs` | Conditions | LOINC codes; empty array if none |
| `associated_meds` | Conditions | RxNorm ingredient codes; empty array if none |
| `associated_conditions` | Labs, Meds | ICD-10 codes; empty array if none |
| `monitoring_labs` | Meds | LOINC codes; empty array if none |
| `molecular_weight` | Labs | For unit conversion; null if not needed |
| `alternate_codes` | Labs | LOINC codes that map to same concept |
| `encounter_class` | Encounter types | Suggested class mapping |
| `crosswalk` | All categories | Maps codes from other terminologies (see below) |

---

## Crosswalk field (multi-code-system support)

Real-world FHIR data uses multiple code systems per resource type. A single concept may appear as LOINC, SNOMED CT, and CPT in different EHR exports. The `crosswalk` field maps alternate codes without duplicating the concept entry.

```jsonc
{
  "code": "4548-4",
  "system": "loinc",
  "friendly_name": "Hemoglobin A1c",
  "crosswalk": {
    "snomed": ["43396004"],
    "cpt": ["83036"]
  },
  // ... rest of fields
}
```

At build time, a reverse index is generated from all crosswalk entries so that Tier 1 lookup by ANY code system is O(1).

### Crosswalk sources

UMLS CUIs already link concepts across terminologies. The model team should include crosswalks from:

| Category | Primary system | Crosswalk to |
|---|---|---|
| Conditions | ICD-10-CM | SNOMED CT, ICD-9-CM (legacy) |
| Labs | LOINC | SNOMED CT |
| Medications | RxNorm | SNOMED CT, NDC |
| Procedures | CPT | SNOMED CT, ICD-10-PCS |
| Vaccines | CVX | SNOMED CT |

---

## Naming and grouping rules

### Disambiguation rule (critical)

If two codes share the same patient-friendly name but have **different clinical meanings or reference ranges**, they MUST be separate entries with disambiguated names.

| Problem case | Wrong | Right |
|---|---|---|
| Serum vs urine creatinine | "Creatinine" (both) | "Creatinine, Serum" + "Creatinine, Urine" |
| Total vs ionized calcium | "Calcium" (both) | "Calcium, Total" + "Calcium, Ionized" |
| Blood vs urine glucose | "Glucose" (both) | "Glucose, Blood" + "Glucose, Urine" |
| Serum vs urine protein | "Protein" (both) | "Protein, Serum" + "Protein, Urine" |

**Rule of thumb**: if a patient would be confused seeing two different values under the same name, or if the reference ranges differ, disambiguate the name.

### Short-name rule

`friendly_name` should be the **shortest patient-comprehensible form**:

| Code | Technical name | Good friendly_name | Bad friendly_name |
|---|---|---|---|
| LOINC 2339-0 | "Glucose [Mass/volume] in Blood" | "Glucose" | "Glucose [Mass/volume] in Blood" |
| LOINC 4548-4 | "Hemoglobin A1c/Hemoglobin.total in Blood" | "Hemoglobin A1c" | "Hemoglobin A1c/Hemoglobin.total in Blood" |
| LOINC 787-2 | "Erythrocyte mean corpuscular volume" | "MCV" | "Erythrocyte Mean Corpuscular Volume" |
| SNOMED 44054006 | "Type 2 diabetes mellitus" | "Diabetes Type 2" | "Type 2 Diabetes Mellitus (disorder)" |

### Same-name-as-code-description

Many concepts already have patient-friendly official names (e.g., "Sodium", "Cholesterol", "ALT"). This is expected — the friendly_name and the code description can be the same. The friendly_name should NOT include the code system, specimen type, method, or other technical qualifiers (those go in `search_texts`).

### Alternate codes (labs)

Labs frequently have equivalent LOINC codes for the same concept (e.g., 4548-4 and 41995-2 for HbA1c). Use `alternate_codes` for LOINC codes that resolve to the same friendly name AND same reference range. If the ranges differ, they must be separate entries (see disambiguation rule above).

---

## Existing curated data to incorporate

The following files were built or curated by the app team and should be incorporated into the unified index by the model team:

### Condition → Lab associations

**Source:** `public/terminology/condition_lab_relationships.json` (app-team curated from Synthea modules)
**Content:** 34 conditions → labs, keyed by patient-friendly name
**NOTE:** This is a limited curated set (~280 pairs). The model team should expand coverage using UMLS monitoring relationships or other clinical sources to cover all conditions in `condition_index.jsonl`. The Synthea data serves as a validation baseline — associations it contains are clinically trusted.

**Example:** `"Diabetes Type 2": ["Blood glucose lab", "CBC Panel", "Hemoglobin A1c", ...]`

These should become `associated_labs` arrays (converted from patient-friendly names to LOINC codes) on condition entries in `condition_index.jsonl`.

### Condition → Medication associations

**Source:** `medterm4ds/reports/fhir4px/condition_medication_ingredient.csv`
**Content:** 2,984,438 rows — UMLS `may_treat` relationships for ALL ICD-10 conditions × RxNorm ingredients
**Columns:** `condition_source, condition_code, condition_name, match_depth, medication_rxnorm_code, medication_name, relationship_type`

**IMPORTANT:** Include ALL conditions and ALL may_treat relationships in the unified index. Do NOT filter to a subset. Every ICD-10 condition that has may_treat data should carry its full `associated_meds` array in `condition_index.jsonl`.

**Filtering guidance:**
- Include `relationship_type = "may_treat"` only (skip other UMLS relationship types)
- Include all `match_depth` levels (0, 1, 2) — deeper matches are still clinically valid
- Map `medication_rxnorm_code` directly to RxNorm ingredient codes in `associated_meds`
- Map `condition_code` (ICD-10) to the condition entry's primary code

**Example entry in condition_index.jsonl:**
```json
{
  "code": "E11",
  "system": "icd10",
  "friendly_name": "Diabetes Type 2",
  "associated_meds": ["860975", "253182", "161", "1191", "865098", ...],
  ...
}
```

The app team's previously built `condition_medication_relationships.json` (26 conditions, 706 pairs) was a **filtered subset** of this data and is now deprecated. The full UMLS data is the source of truth.

### Reference ranges

**File:** `public/terminology/reference_ranges.json`
**Source:** ACP educational reference ranges (annualmeeting.acponline.org)
**Content:** 35 common adult labs with ranges, sex-specific where needed, alternate LOINC codes, UCUM units
**Example:**
```json
"718-7": {
  "name": "Hemoglobin",
  "aliases": ["Hgb", "Hb"],
  "canonicalUnit": "g/dL",
  "ranges": {
    "male": { "low": 13.5, "high": 17.5 },
    "female": { "low": 12.0, "high": 15.5 }
  }
}
```

These should become `reference_ranges` objects on lab entries in `lab_index.jsonl`. The model team can extend coverage beyond these 35 entries using LOINC reference range data or other curated sources.

### GBD disability weights

**File:** `public/terminology/gbd_disability_weights.json`
**Source:** IHME GBD 2023 DIRF Appendix 1 (Tables S9 + S13)
**Content:** 5,111 ICD-10 codes → disability weight (max across sequelae per cause)
**Build script:** `scripts/build-gbd-weights.mjs`

These should become `gbd_dw` values on condition entries in `condition_index.jsonl`.

## What we build from this data

The app's build pipeline (Node scripts) transforms each JSONL into:

1. **BM25 inverted index** — tokenized `search_texts` → inverted index with IDF scores per category
2. **Direct lookup table** — `(system, code)` → full concept record (for Tier 1 deterministic lookup)
3. **Embedding prototype centroids** — pre-computed from `search_texts` at build time (no runtime embedding cost for prototypes)
4. **Association adjacency list** — flattened from `associated_labs`, `associated_meds`, etc.
5. **Reference range table** — keyed by LOINC code (with `alternate_codes`)

All generated at build time, served as static JSON assets. No runtime computation beyond the actual classification/inference.

---

## Data sources

The unified index can be built from data the medterm4ds team already produces:

| Field | Source |
|---|---|
| `code`, `system`, `friendly_name` | `patient_friendly_names.csv` (1.1M rows) |
| `aliases`, `search_texts` | UMLS MRCONSO (synonyms, hierarchy) |
| `gbd_dw` | IHME GBD 2023 DIRF Appendix 1 (S9 + S13 join) |
| `associated_labs` | `condition_lab_relationships.csv` or UMLS `may_treat` + monitoring |
| `associated_meds` | `condition_medication_ingredient.csv` (UMLS `may_treat`) |
| `reference_ranges` | ACP reference ranges (curated) |
| `molecular_weight` | UMLS or PubChem |
| `monitoring_labs` | UMLS `may_treat` reverse or curated |
| `observation_category` | LOINC classification (CLASS field) |
| `encounter_class` | SNOMED/CPT hierarchy mapping |

---

## Resolution flow (what the app does at runtime)

```
FHIR record with code (e.g., loinc:4548-4)
  │
  ├─ Tier 1: Direct lookup in lab_index by (loinc, 4548-4)
  │   → { code, friendly_name, reference_ranges, associated_conditions, ... }
  │   → Done. Everything downstream uses the code.
  │
  └─ No code or code not in index:
      │
      ├─ Tier 2: BM25 search against lab_index search_texts
      │   → Returns full concept record (including code)
      │   → Code flows to associations, ranges, etc.
      │
      └─ No confident BM25 match:
          │
          ├─ Tier 3: LLM fallback (optional)
          │
          └─ Source label (no code, no associations)
```

**Key difference from today:** the resolver returns the **full concept record** (including code) at every tier. Downstream lookups (GBD weight, reference ranges, associations) are direct code-keyed lookups — no name→code reverse resolution needed.

---

## Migration path

This is additive — existing data assets continue to work alongside the unified index until migration is complete:

1. **Phase 1**: Model team delivers unified JSONL files
2. **Phase 2**: App build scripts generate BM25 indexes + lookup tables + embedding prototypes from unified files
3. **Phase 3**: App resolver updated to return concept records (with codes) instead of just names
4. **Phase 4**: Remove canonical-codes tables, GBD weights file, reference-ranges file, association files (now embedded in concept records)
5. **Phase 5**: Remove patient-friendly lookup tables (replaced by direct code lookup in unified index)

No user-facing changes during migration — the pipeline produces the same patient-friendly names, just via a more reliable code-keyed chain.

---

## Open questions

1. **LOINC coverage**: The current patient-friendly names table has ~166K LOINC entries. The unified lab_index should cover at least the same set. How many of those have reference ranges? (Current ACP table covers ~35.)

2. **Association completeness**: Current condition_lab_relationships.json is built from Synthea modules (~34 conditions × ~8 labs each). UMLS `may_treat` is broader. Should we use UMLS exclusively, or merge both?

3. **Alternate codes**: Many LOINC codes are equivalent (e.g., 4548-4 and 41995-2 for HbA1c). The `alternate_codes` field lets us group them. How many equivalencies exist in the current data?

4. **Build cadence**: UMLS updates twice yearly (AA releases). How often should the unified indexes be rebuilt? (Suggestion: per UMLS release + ad-hoc for curated additions like reference ranges.)

5. **Embedding prototype pre-computation**: We can pre-compute centroids at build time from `search_texts` and embed them in the index file as a `centroid` field. This eliminates the ~200ms runtime centroid computation on first classification. Should we do this?
