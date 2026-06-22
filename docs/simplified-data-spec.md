# fhir4px Data Pipeline — Simplified Specification

**Version:** 1.0
**Date:** 2026-06-21
**Audience:** medterm4ds data team
**Replaces:** unified-concept-index-spec.md (v2.0-draft) — that spec was over-engineered. This is the pragmatic version.

---

## Goal

Make the naming resolver return the **code** alongside the patient-friendly name, so downstream lookups (associations, reference ranges, GBD weights) are direct code-keyed lookups instead of fragile name→code reverse resolution.

This is a small set of changes to existing data assets — not a full pipeline redesign.

---

## What changes

### 1. BM25 indexes: return the code

**Today:** BM25 resolver returns `{ name, score }` — just the patient-friendly name.

**After:** BM25 resolver returns `{ name, code, system, score }` — the patient-friendly name AND the code it matched.

The BM25 index files (`medication_bm25.json`, `lab_bm25.json`, etc.) already store a `code` per entry (it's in the record that maps `rid → name`). We just need to also store `system` and return both on match.

**Index entry change (additive):**

Current BM25 JSON structure stores:
```json
{
  "names": ["Hemoglobin A1c", "Glucose", ...],
  "rid_to_name": [0, 1, ...],
  "rid_to_code": ["4548-4", "2339-0", ...],   // ← already exists in some indexes
  "postings": { ... },
  "idf": { ... }
}
```

We need two new mappings per index:
```json
{
  "rid_to_code": ["4548-4", "2339-0", ...],       // code for each record
  "rid_to_system": ["loinc", "loinc", ...]          // system for each record
}
```

For medications, also include ingredient codes so we can look up condition associations without a separate decomposition step:
```json
{
  "rid_to_code": ["860975", "860976", "6809", ...],
  "rid_to_system": ["rxnorm", "rxnorm", "rxnorm", ...],
  "rid_to_ingredient_codes": [["6809"], ["6809"], [], ...]   // empty for ingredient entries themselves
}
```

### 2. Medication index: absorb RxNorm ingredient decomposition

**Today:** The app loads a separate `rxnorm_ingredient_decomposition.csv` at runtime to decompose product codes (860975) into ingredient codes (6809) before looking up condition associations.

**After:** Each product-level entry in `medication_bm25.json` carries its ingredient codes directly. The BM25 resolver returns them alongside the product code. No separate decomposition file needed.

**Source:** The existing `rxnorm_ingredient_decomposition.csv` maps product → ingredients. At BM25 index build time, look up each product entry's ingredient codes and store them in `rid_to_ingredient_codes`.

**For combination products** (e.g., Janumet = sitagliptin + metformin), `rid_to_ingredient_codes` contains multiple entries: `["36457", "6809"]`.

### 3. Associations: switch to code-keyed format

**Today:** Two files, both name-keyed, different structures:
- `condition_lab_relationships.json` — condition friendly name → lab friendly names (34 conditions, Synthea-curated)
- `condition_medication_relationships.json` — condition friendly name → med ingredient names (26 conditions, filtered subset of UMLS may_treat)

**After:** One file, code-keyed:

**File:** `condition_associations.json`

```json
{
  "E11": {
    "labs": ["4548-4", "2339-0", "38483-4", "3094-0", "17861-6"],
    "medications": ["6809", "161", "253182", "1191", "865098"]
  },
  "I10": {
    "labs": [],
    "medications": ["197366", "19053302", "8661"]
  },
  "J45": {
    "labs": [],
    "medications": ["1799011", "357"]
  }
}
```

**Key:** ICD-10 condition code
**labs:** array of LOINC codes
**medications:** array of RxNorm **ingredient** codes (not product codes)

**Data sources:**
- **Condition → lab**: the app team's Synthea-curated data (34 conditions). The model team should extend coverage using UMLS monitoring relationships or other clinical sources.
- **Condition → medication**: the FULL UMLS `may_treat` data from `condition_medication_ingredient.csv` (2.98M rows). Include ALL conditions, ALL match_depth levels. Do NOT filter to a subset.

**Build:** The model team produces this file. The app team provides the Synthea condition-lab data as a baseline input.

### 4. Friendly name picking rule

When multiple codes map to the same BM25 index entry (or the same concept has multiple friendly names in `patient_friendly_names.csv`), pick the friendly name using this priority:

1. **MEDLINEPLUS source** — if any code resolved via MEDLINEPLUS, use that name (explicitly patient-friendly)
2. **Shortest name** — fall back to the shortest patient-friendly name across all codes
3. **All others** — keep as aliases in the BM25 index entry's search texts

---

## What stays the same

| Data asset | Status | Why |
|---|---|---|
| `patient_friendly_names.csv` / per-system JSON | **Keep as-is** | Tier 1 deterministic lookup (code → name). Fastest, most reliable path. |
| `embedding_index_*.jsonl` | **Keep as-is** | Source for BM25 indexes. Already has code + system per entry. |
| Reference ranges (`reference_ranges.json`) | **Keep as-is** | Keyed by LOINC code, works once the code is on the group. |
| GBD weights (`gbd_disability_weights.json`) | **Keep as-is** | Keyed by ICD-10 code, works once the code is on the group. |

---

## What gets removed

| Data asset | Why it's no longer needed |
|---|---|
| `canonical_codes.csv` (3 files, 11MB) | BM25 returns the code directly — no reverse name→code lookup needed |
| `rxnorm_ingredient_decomposition.csv` | Absorbed into medication BM25 index as `rid_to_ingredient_codes` |
| `condition_lab_relationships.json` (name-keyed) | Replaced by code-keyed `condition_associations.json` |
| `condition_medication_relationships.json` (name-keyed, 26 conditions) | Replaced by code-keyed `condition_associations.json` (full UMLS) |

---

## Runtime resolution flow (after changes)

```
FHIR record with code (e.g., rxnorm:860975)
  │
  ├─ Tier 1: patient_friendly_names lookup by (rxnorm, 860975)
  │   → { friendlyName: "Metformin 500 MG Oral Tablet", code: "860975", system: "rxnorm" }
  │   → Code already known from the FHIR resource — no extra lookup
  │
  └─ No code or code not in lookup:
      │
      ├─ Tier 2: BM25 search against medication_bm25.json
      │   → { name: "Metformin 500 MG Oral Tablet", code: "860975", system: "rxnorm",
      │        ingredient_codes: ["6809"], score: 15.2 }
      │   → Code + ingredient codes returned directly
      │
      └─ No BM25 match → source label (no code, no associations)

Downstream (works the same for both tiers):
  code "860975" on the group
  → ingredient_codes ["6809"]
  → condition_associations reversed: which conditions list "6809" in their medications?
  → found: E11 (Diabetes Type 2) → association established
```

---

## Deliverables from the model team

| # | Deliverable | Source data | Format |
|---|---|---|---|
| 1 | Updated BM25 index files (5 categories) | Existing `embedding_index_*.jsonl` | JSON with `rid_to_code`, `rid_to_system` added |
| 2 | Updated medication BM25 index | Existing index + `rxnorm_ingredient_decomposition.csv` | Add `rid_to_ingredient_codes` array |
| 3 | `condition_associations.json` | UMLS `may_treat` (2.98M rows) + Synthea condition-lab (34 conditions) | JSON keyed by ICD-10 code |

## Deliverables from the app team

| # | Deliverable | Status |
|---|---|---|
| 1 | `gbd_disability_weights.json` (5,111 ICD-10 codes) | Ready (`public/terminology/`) |
| 2 | `reference_ranges.json` (35 labs) | Ready (`public/terminology/`) |
| 3 | `condition_lab_relationships.json` (34 conditions, Synthea-curated) | Ready (`public/terminology/`) — provide as input for #3 above |

---

## File format details

### Updated BM25 index JSON

```jsonc
{
  "num_records": 42000,
  "avg_doc_length": 8.5,
  "idf": { "metformin": 2.1, "glucophag": 5.8, ... },
  "doc_lengths": [6, 8, 5, ...],
  "postings": {
    "metformin": [[0, 3], [1, 2], [2, 1], ...],
    "glucophag": [[0, 1], ...]
  },
  "names": ["Metformin 500 MG Oral Tablet", "Metformin 1000 MG Oral Tablet", "Metformin", ...],
  "rid_to_code": ["860975", "860976", "6809", ...],           // NEW
  "rid_to_system": ["rxnorm", "rxnorm", "rxnorm", ...],         // NEW
  "rid_to_ingredient_codes": [["6809"], ["6809"], [], ...]      // NEW (medications only)
}
```

### condition_associations.json

```json
{
  "_meta": {
    "version": "1.0",
    "generated_at": "2026-06-21T00:00:00Z",
    "sources": {
      "labs": "Synthea modules (34 conditions) + UMLS monitoring (expanded)",
      "medications": "UMLS may_treat (condition_medication_ingredient.csv, 2.98M rows, all match_depth)"
    }
  },
  "E11": {
    "labs": ["4548-4", "2339-0", "38483-4", "3094-0", "17861-6"],
    "medications": ["6809", "161", "253182", "1191", "865098"]
  },
  "I10": {
    "labs": [],
    "medications": ["197366", "19053302", "8661"]
  }
}
```

---

## Timeline

This is additive — existing data assets continue working until the new deliverables are integrated:

1. Model team delivers updated BM25 indexes + condition_associations.json
2. App team updates BM25 resolver to return codes
3. App team updates association lookups to use code-keyed format
4. App team removes canonical_codes, old association files, rxnorm_decomposition
5. Validate with test patients (Sam Codes-Only, Robin No-Codes, Jordan Linked)
