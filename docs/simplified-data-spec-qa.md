# Response to medterm4ds Questions on Simplified Data Spec

**From:** fhir4px app team
**Date:** 2026-06-21 (revised)

---

## 1. Condition associations: ICD-10 only

**ICD-10 canonical keys only.** The associations are between canonical (ICD-10) condition codes and downstream codes (LOINC, RxNorm). No SNOMED keys needed.

The SNOMED → ICD-10 canonicalization happens at the **naming** level, not the association level. The condition BM25 index carries the ICD-10 canonical code for every entry — including SNOMED entries (build-time crosswalk via UMLS CUIs).

**BM25 condition index entry (example):**
```jsonc
{
  "code": "44054006",              // SNOMED code (from FHIR resource)
  "system": "snomed",
  "canonical_code": "E11",         // ICD-10 equivalent (for downstream lookups)
  "canonical_system": "icd10",
  "rid_to_friendly_name": "Diabetes Type 2",
  "search_texts": ["Type 2 diabetes mellitus", "44054006", ...]
}
```

The resolver returns `canonical_code` for associations, GBD weights, and priority scoring. The original `code`/`system` are preserved for reference.

**Associations file:** ~28K ICD-10 keys (not 106K). Smaller and simpler.

---

## 2. Synthea condition-lab data crosswalk

**We'll provide the crosswalk directly.** The Synthea data is name-keyed; we'll produce a code-keyed version and hand it to you as input.

| Synthea name | ICD-10 |
|---|---|
| Diabetes Type 2 | E11 |
| High Blood Pressure | I10 |
| Asthma | J45 |
| Acute Myocardial Infarction | I21 |
| Heart Failure | I50 |
| Kidney Disease | N18 |
| COPD | J44 |
| Breast Cancer | C50 |
| Colon Cancer | C18 |
| Lung Cancer | C34 |
| Prostate Cancer | C61 |
| Anemia | D50 |
| Metabolic Syndrome | E88.81 |
| Thyroid Disease | E03 |
| ... (full list to follow) | |

We'll provide a `synthea_condition_lab_codes.json` file with the lab side crosswalked to LOINC codes too. Use this as-is for the `labs` arrays in `condition_associations.json`.

---

## 3. match_depth → strength (no hard cap)

**Include depths 0–4, exclude depth 5.** Instead of a binary cap, tag each association with a strength derived from match_depth.

**`match_depth` explanation:** This is the number of levels the build script walked UP the condition hierarchy (SNOMED CT or ICD-10 taxonomy) to find a `may_treat` edge. It is NOT RxNorm depth. Depth 0 = the condition itself has a direct `may_treat` edge. Depth 3 = walked up 3 ancestors to find one. Deeper depths inherit from increasingly broad ancestor conditions ("Disorder of endocrine pancreas" at depth 3 vs "Disease" at depth 5).

**Depth → strength mapping:**

| match_depth | Strength | Rationale |
|---|---|---|
| 0–1 | **strong** | Direct or parent — clinically definitive |
| 2 | **moderate** | Grandparent — reasonable, less specific |
| 3–4 | **weak** | Distant ancestor — possible but noisy |
| 5 | **exclude** | "Disease" level — matches everything, pure noise |

**Associations file format with strength:**

```json
{
  "icd10:E11": {
    "labs": [
      {"code": "4548-4", "strength": "strong"},
      {"code": "2339-0", "strength": "strong"},
      {"code": "3094-0", "strength": "weak"}
    ],
    "medications": [
      {"code": "6809", "strength": "strong"},
      {"code": "860975", "strength": "strong"},
      {"code": "161", "strength": "strong"},
      {"code": "1191", "strength": "moderate"},
      {"code": "865098", "strength": "weak"}
    ]
  }
}
```

**How the app uses strength:**

| Use case | Strong | Moderate | Weak |
|---|---|---|---|
| Condition card — show meds/labs | Always show | Show | Behind "show more" |
| Lab dedup — claim lab from standalone | Always claim | Claim if no strong exists | Don't claim |
| Priority scoring booster | Full weight | Half weight | No boost |

**For condition-lab (Synthea-curated):** all strong by default (manually verified clinical relationships). If the model team adds UMLS monitoring relationships with depth, same mapping applies.

---

## 4. Medication associations: pre-expand to product level

**Pre-expand ingredient-level associations to all relevant RxNorm product codes at build time.** This eliminates the need for runtime ingredient decomposition.

Instead of:
```json
"medications": ["6809"]    // ingredient only — runtime must decompose product → ingredient
```

Do:
```json
"medications": [
  {"code": "6809", "strength": "strong"},      // IN metformin
  {"code": "860975", "strength": "strong"},     // SCD metformin 500 MG Oral Tablet
  {"code": "860976", "strength": "strong"},     // SCD metformin 1000 MG Oral Tablet
  {"code": "860977", "strength": "strong"},     // SCD metformin 850 MG Oral Tablet
  {"code": "866138", "strength": "strong"},     // SBD Glucophage 500 MG Oral Tablet
  {"code": "866139", "strength": "strong"},     // SBD Glucophage 1000 MG Oral Tablet
  {"code": "860972", "strength": "strong"}      // SCDG metformin Oral Product
]
```

**RxNorm TTYs to include in pre-expansion:**

| TTY | Include? | Why |
|---|---|---|
| IN (ingredient) | Yes | MedicationStatement sometimes carries ingredient codes |
| SCD (semantic clinical drug) | Yes | Most common on MedicationRequest |
| SBD (semantic branded drug) | Yes | Common when EHR knows the brand |
| SCDG (dose form group) | Yes | Our patient-friendly names use this level |

Skip: BN, SBDC, SCDC, SBDG, MIN, PIN, DF, DFG — rarely appear on FHIR MedicationRequest.

**Build step:** For each ingredient-level may_treat association, look up all SCD/SBD/SCDG codes containing that ingredient (via existing `rxnorm_ingredient_decomposition.csv`), union into the medications array, and apply the ingredient's strength to all expanded codes.

**What this eliminates:**
- `rid_to_ingredient_codes` in the BM25 medication index (not needed — the code is directly in the associations array)
- `rxnorm_ingredient_decomposition.csv` as a runtime file (applied at build time only)
- Runtime ingredient decomposition entirely

---

## 5. friendly_name for SCD concepts in BM25

**Your recommendation (b) is correct.** Use technical names for BM25 matching, carry the friendly name separately for display.

BM25 index stores both:

```jsonc
{
  "names": ["metformin 500 MG Oral Tablet", "metformin 1000 MG Oral Tablet", "metformin", ...],
  //      ↑ technical names — what BM25 matches against (per-code, specific)

  "rid_to_friendly_name": ["Metformin Oral Product", "Metformin Oral Product", "Metformin", ...],
  //                      ↑ patient-friendly names — what the app displays (consistent across dose forms)

  "rid_to_code": ["860975", "860976", "6809", ...],
  "rid_to_system": ["rxnorm", "rxnorm", "rxnorm", ...],
  "rid_to_canonical_code": ["860975", "860976", "6809", ...],      // for conditions: ICD-10 equivalent
  "rid_to_canonical_system": ["rxnorm", "rxnorm", "rxnorm", ...]     // for conditions: "icd10"
}
```

Note: `rid_to_ingredient_codes` is no longer needed (see resolution #4 — medications are pre-expanded in the associations file). For conditions, `rid_to_canonical_code` carries the ICD-10 equivalent (see resolution #1).

When BM25 matches, the resolver returns:

```json
{
  "patient_friendly_name": "Metformin Oral Product",   // from rid_to_friendly_name
  "code": "860975",                                      // from rid_to_code
  "system": "rxnorm",                                    // from rid_to_system
  "canonical_code": "860975",                            // from rid_to_canonical_code (same for meds; ICD-10 for conditions)
  "canonical_system": "rxnorm",                          // from rid_to_canonical_system
  "score": 15.2
}
```

The `names` array is for matching (technical, per-code, distinguishable). The `rid_to_friendly_name` is for display (patient-friendly, consistent across dose forms). Different concerns, different data.

---

## 6. Embedding centroids

**Intentionally dropped from this spec.** BM25 is the Tier 2 naming mechanism. Embeddings are still used for classification tasks (observation category, allergy type, encounter class, encounter type) but NOT for naming.

Pre-computed centroids for classification prototypes are a separate optimization. The runtime centroid computation (~200ms one-time per task) is acceptable for now.

---

## Summary of resolutions

| # | Question | Resolution |
|---|---|---|
| 1 | ICD-10 or SNOMED keys? | ICD-10 only. Condition BM25 index carries ICD-10 canonical code per entry. |
| 2 | Synthea crosswalk | App team provides code-keyed crosswalk for 34 conditions + labs. |
| 3 | match_depth cap | No hard cap. Depths 0–4 included with strength tags (strong/moderate/weak). Depth 5 excluded. |
| 4 | Medication pre-expansion | Pre-expand ingredient associations to IN + SCD + SBD + SCDG at build time. Eliminates runtime decomposition. |
| 5 | SCD friendly_name | Technical names in `names` array (matching). Friendly names in `rid_to_friendly_name` (display). `rid_to_canonical_code` for downstream lookups. |
| 6 | Embedding centroids | Dropped. BM25 is the naming tier. Classification uses runtime centroids. |
