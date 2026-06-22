# Response to medterm4ds Remaining Questions

**From:** fhir4px app team
**Date:** 2026-06-21

---

## Q1: Key format — bare code or system-prefixed?

**Bare code.** Keys in `condition_associations.json` are bare ICD-10 codes (`"E11"`, not `"icd10:E11"`). The system is implicit — this file is ICD-10 keyed only. Same for the values: lab codes are bare LOINC (`"4548-4"`), medication codes are bare RxNorm (`"860975"`).

```json
{
  "E11": {
    "labs": [
      {"code": "4548-4", "strength": "strong"}
    ],
    "medications": [
      {"code": "860975", "strength": "strong", "relationship": "treats"}
    ]
  }
}
```

---

## Q2: SNOMED conditions without ICD-10 equivalent

**Option (b) — include with `canonical_code: null`.**

These conditions should still be BM25-searchable (patients see them, they need names). They just won't have associations or GBD weights. The app handles `canonical_code: null` gracefully — same path as records that fall through to source labels.

```jsonc
// BM25 condition index entry for a SNOMED-only condition
{
  "code": "123456789",
  "system": "snomed",
  "canonical_code": null,         // no ICD-10 equivalent
  "canonical_system": null,
  "rid_to_friendly_name": "Some Rare Condition",
  "search_texts": ["Some rare condition", "123456789", ...]
}
```

The resolver returns `canonical_code: null` → app knows no associations available → name displays fine, no condition card meds/labs, no GDW weight, score from boosters only.

---

## Q3: Include may_prevent alongside may_treat?

**Yes, include both. Add a `relationship` field.**

`may_prevent` covers clinically meaningful relationships the app should surface — vaccines preventing diseases, prophylactic medications, etc. These are different from treatments but equally relevant for the patient.

**Schema:**

```json
{
  "E11": {
    "labs": [
      {"code": "4548-4", "strength": "strong"}
    ],
    "medications": [
      {"code": "860975", "strength": "strong", "relationship": "treats"},
      {"code": "860976", "strength": "strong", "relationship": "treats"},
      {"code": "197366", "strength": "moderate", "relationship": "treats"},
      {"code": "854899", "strength": "weak", "relationship": "prevents"}
    ]
  }
}
```

**Lab entries don't need a `relationship` field** — they're always "monitors" (the lab monitors/diagnoses the condition). Implicit.

**Medication entries carry `relationship`:** `"treats"` or `"prevents"`. The app uses this for:
- UI label: "Treats: Metformin" vs "Prevents: Aspirin"
- Priority scoring: `treats` gets full booster weight; `prevents` gets reduced weight (prophylactic, not active treatment)
- Dedup: both `treats` and `prevents` can claim a medication from the standalone list

---

## Q4: Confirm pre-expansion source — yes, confirmed

Your build plan is correct:

**Inputs:**
- `condition_medication_ingredient.csv` (may_treat + may_prevent, depths 0–4, grouped by ICD-10)
- `synthea_condition_lab_codes.json` (app team provides, 34 conditions, all strength: "strong")
- `rxnorm_ingredient_decomposition.csv` (for pre-expanding ingredient → IN + SCD + SBD + SCDG)

**Output:**
- `condition_associations.json` — keyed by bare ICD-10 code, with `labs` and `medications` arrays, each entry tagged with `strength` (and `relationship` for medications)

**One correction on BM25 index changes:** the BM25 indexes are built by the **app team** from your `embedding_index_*.jsonl` files. Your JSONL files already carry the code, system, CUI, and friendly name per entry. We add `rid_to_code`, `rid_to_system`, `rid_to_friendly_name`, and `rid_to_canonical_code` at our BM25 build time.

**What we need from you for the canonical_code crosswalk:** the `embedding_index_condition.jsonl` entries should carry an `icd10_code` field (or equivalent) where available. This is the SNOMED/ICD-9 → ICD-10 mapping. If the entry is already ICD-10, `icd10_code` = the entry's own code. If SNOMED without an ICD-10 equivalent, `icd10_code` = null.

If your JSONL already has the CUI, we can do the CUI → ICD-10 crosswalk on our side at BM25 build time. Either way works — just let us know which fields are available.

---

## Summary

| Question | Resolution |
|---|---|
| Q1: Key format | Bare code (`"E11"`), no system prefix |
| Q2: SNOMED without ICD-10 | Include in BM25 index with `canonical_code: null`. Name displays, no associations. |
| Q3: may_prevent | Include alongside may_treat. Add `relationship: "treats"` or `"prevents"` per medication entry. |
| Q4: Build plan | Confirmed. Model team builds `condition_associations.json`. App team builds BM25 indexes from `embedding_index_*.jsonl`. |
