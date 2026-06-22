# Response to medterm4ds Remaining Questions

**From:** fhir4px app team
**Date:** 2026-06-21 (revised)

---

## Q1: Key format — bare code or system-prefixed?

**Bare code.** Keys in `condition_associations.json` are bare codes (`"E11"`, not `"icd10:E11"`). The file now includes both ICD-10 and SNOMED keys — they're distinguishable by format (ICD-10 starts with a letter, SNOMED is pure numeric), so no prefix is needed.

Same for the values: lab codes are bare LOINC (`"4548-4"`), medication codes are bare RxNorm (`"860975"`).

```json
{
  "E11": {
    "labs": [
      {"code": "4548-4", "strength": "strong"}
    ],
    "medications": [
      {"code": "860975", "strength": "strong", "relationship": "treats"}
    ]
  },
  "44054006": {
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

**Use SNOMED code as canonical.** Conditions without an ICD-10 equivalent use their SNOMED code as the canonical code. This preserves associations coverage — ~50K SNOMED-only conditions that have UMLS `may_treat` data can still participate.

**BM25 condition index canonical_code priority:**
1. ICD-10 equivalent available → `canonical_code: "E11"`, `canonical_system: "icd10"`
2. No ICD-10, but has associations data → `canonical_code: "233833007"`, `canonical_system: "snomed"` (self-canonical)
3. No associations data at all → `canonical_code: null`, `canonical_system: null`

```jsonc
// SNOMED condition WITH ICD-10 equivalent
{
  "code": "44054006", "system": "snomed",
  "canonical_code": "E11", "canonical_system": "icd10"
}

// SNOMED condition WITHOUT ICD-10 (self-canonical)
{
  "code": "233833007", "system": "snomed",
  "canonical_code": "233833007", "canonical_system": "snomed"
}

// Condition with no association data at all
{
  "code": "999999999", "system": "snomed",
  "canonical_code": null, "canonical_system": null
}
```

**Downstream impact:**

| Consumer | ICD-10 canonical | SNOMED canonical | null canonical |
|---|---|---|---|
| Associations | ✓ (ICD-10 key lookup) | ✓ (SNOMED key lookup) | ✗ |
| GBD weights | ✓ (ICD-10 keyed) | ✗ (returns 0) | ✗ |
| Priority scoring | Full (DW + boosters) | Boosters only | Boosters only |
| Patient-friendly name | ✓ | ✓ | ✓ |

This replaces the earlier answer of `canonical_code: null` for SNOMED-only conditions. SNOMED conditions now participate in associations.

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
- `condition_medication_ingredient.csv` (may_treat + may_prevent, depths 0–4, grouped by ICD-10 AND SNOMED condition codes)
- `synthea_condition_lab_codes.json` (app team provides, 34 conditions, all strength: "strong")
- `rxnorm_ingredient_decomposition.csv` (for pre-expanding ingredient → IN + SCD + SBD + SCDG)

**Output:**
- `condition_associations.json` — keyed by bare condition codes (both ICD-10 and SNOMED), with `labs` and `medications` arrays, each entry tagged with `strength` (and `relationship` for medications)

**One correction on BM25 index changes:** the BM25 indexes are built by the **app team** from your `embedding_index_*.jsonl` files. Your JSONL files already carry the code, system, CUI, and friendly name per entry. We add `rid_to_code`, `rid_to_system`, `rid_to_friendly_name`, and `rid_to_canonical_code` at our BM25 build time.

**What we need from you for the canonical_code crosswalk:** the `embedding_index_condition.jsonl` entries should carry an `icd10_code` field (or equivalent) where available. This is the SNOMED/ICD-9 → ICD-10 mapping. If the entry is already ICD-10, `icd10_code` = the entry's own code. If SNOMED without an ICD-10 equivalent, `icd10_code` = null (and the SNOMED code becomes the canonical code).

If your JSONL already has the CUI, we can do the CUI → ICD-10 crosswalk on our side at BM25 build time. Either way works — just let us know which fields are available.

---

## Summary

| Question | Resolution |
|---|---|
| Q1: Key format | Bare code (`"E11"`, `"44054006"`), no system prefix. ICD-10 and SNOMED coexist — distinguishable by format. |
| Q2: SNOMED without ICD-10 | Use SNOMED code as canonical (`canonical_code: "233833007"`, `canonical_system: "snomed"`). Preserves association coverage for ~50K SNOMED-only conditions. `null` only when no association data exists at all. |
| Q3: may_prevent | Include alongside may_treat. Add `relationship: "treats"` or `"prevents"` per medication entry. |
| Q4: Build plan | Confirmed. Model team builds `condition_associations.json` with both ICD-10 and SNOMED keys. App team builds BM25 indexes from `embedding_index_*.jsonl`. |
