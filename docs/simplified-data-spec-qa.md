# Response to medterm4ds Questions on Simplified Data Spec

**From:** fhir4px app team
**Date:** 2026-06-21

---

## 1. Condition associations: ICD-10 only, or ICD-10 + SNOMED?

**Both. Include SNOMED keys.**

FHIR Condition resources are commonly SNOMED-coded. Our test patient Jordan Linked has `snomed:44054006` for Type 2 diabetes. Epic sends SNOMED frequently. If we only key by ICD-10, SNOMED-coded conditions get no associations.

The `condition_medication_ingredient.csv` already has both sources. Include all of them.

**Format:** prefix keys with the system so there's no ambiguity:

```json
{
  "icd10:E11": { "labs": ["4548-4", "2339-0"], "medications": ["6809", "161"] },
  "snomed:44054006": { "labs": ["4548-4", "2339-0"], "medications": ["6809", "161"] },
  "icd10:I10": { "labs": [], "medications": ["197366", "8661"] }
}
```

~106K keys (28K ICD-10 + 78K SNOMED) at ~200 bytes each = ~20MB. Fine.

---

## 2. Synthea condition-lab data crosswalk

**We'll provide the crosswalk directly.** You're right — the Synthea data is name-keyed and needs manual mapping. Since it's only 34 conditions × ~8 labs each, we'll produce a code-keyed version and hand it to you as input.

Here's the mapping for the conditions:

| Synthea name | ICD-10 | SNOMED |
|---|---|---|
| Diabetes Type 2 | E11 | 44054006 |
| High Blood Pressure | I10 | 59621000 |
| Asthma | J45 | 195967001 |
| Acute Myocardial Infarction | I21 | 84114007 |
| Heart Failure | I50 | 88805009 |
| Kidney Disease | N18 | 709044004 |
| COPD | J44 | 13645005 |
| Breast Cancer | C50 | 254837009 |
| Colon Cancer | C18 | 363406005 |
| Lung Cancer | C34 | 363358000 |
| Prostate Cancer | C61 | 399068003 |
| Anemia | D50 | 271737000 |
| Metabolic Syndrome | E88.81 | 237602007 |
| Thyroid Disease | E03 | 40930008 |
| ... (full list to follow) | | |

We'll provide a `synthea_condition_lab_codes.json` file with the lab side crosswalked to LOINC codes too. You can use this as-is for the `labs` arrays in `condition_associations.json`.

---

## 3. match_depth cap

**Cap at depth ≤ 2.**

| Depth | ICD-10 rows | SNOMED rows | Assessment |
|---|---|---|---|
| 0 | 9,213 | 38,246 | Direct — keep |
| 1 | 12,778 | 229,821 | Close ancestor — keep |
| 2 | 22,771 | 657,250 | Moderate — keep |
| 3 | 20,277 | 651,100 | Noisy — **skip** |
| 4 | 7,114 | 363,443 | Very noisy — **skip** |
| 5 | 551 | 163,927 | Almost random — **skip** |

For a patient-facing app, false positives (wrong association) are worse than false negatives (missing association). A patient seeing "Cough Medicine → Diabetes" because of a depth-4 ancestor match is confusing and erodes trust.

Depth ≤ 2 gives ~44K ICD-10 rows + ~925K SNOMED rows — comprehensive without being noisy.

---

## 4. friendly_name for SCD concepts in BM25

**Your recommendation (b) is correct.** Use technical names for BM25 matching, carry the friendly name separately for display.

The BM25 index should store both:

```jsonc
{
  "names": ["metformin 500 MG Oral Tablet", "metformin 1000 MG Oral Tablet", "metformin", ...],
  //      ↑ technical names — what BM25 matches against (per-code, specific)

  "rid_to_friendly_name": ["Metformin Oral Product", "Metformin Oral Product", "Metformin", ...],
  //                      ↑ patient-friendly names — what the app displays (ingredient-level, consistent)

  "rid_to_code": ["860975", "860976", "6809", ...],
  "rid_to_system": ["rxnorm", "rxnorm", "rxnorm", ...],
  "rid_to_ingredient_codes": [["6809"], ["6809"], [], ...]
}
```

When BM25 matches "metformin 500 MG" to rid 0, the resolver returns:

```json
{
  "patient_friendly_name": "Metformin Oral Product",
  "code": "860975",
  "system": "rxnorm",
  "ingredient_codes": ["6809"],
  "score": 15.2
}
```

The `names` array is for matching (technical, per-code, distinguishable). The `rid_to_friendly_name` is for display (patient-friendly, consistent across dose forms). Different concerns, different data.

**The `rid_to_friendly_name` values come from your existing `patient_friendly_names.csv` resolver** — same values it produces today, just stored in the index rather than resolved at runtime.

---

## 5. Embedding centroids

**Intentionally dropped from this spec.** BM25 is the Tier 2 naming mechanism. Embeddings are still used for classification tasks (observation category, allergy type, encounter class, encounter type) but NOT for naming.

Pre-computed centroids for classification prototypes are a separate optimization. The runtime centroid computation (~200ms one-time per task) is acceptable for now. We can add pre-computed centroids later if needed.

---

## Summary of resolutions

| Question | Resolution |
|---|---|
| 1. ICD-10 or SNOMED? | Both. Prefixed keys: `icd10:E11`, `snomed:44054006` |
| 2. Synthea crosswalk | App team provides code-keyed crosswalk for 34 conditions + labs |
| 3. match_depth cap | ≤ 2 (depths 3-5 are too noisy) |
| 4. SCD friendly_name | Technical names in `names` array (matching), friendly names in `rid_to_friendly_name` (display) |
| 5. Embedding centroids | Dropped from this spec. Not needed for naming. Classification uses runtime centroids. |
