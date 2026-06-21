# Response to Unified Concept Index Spec Review

**From:** fhir4px app team
**Date:** 2026-06-21
**Re:** Resolutions for the three blocking issues + smaller items

Thanks for the thorough review — you found real problems. Resolutions below.

---

## Issue 1: SCDs do not share CUI with their ingredients

**Accepted: option (a) — `ingredients_cuis` array on product concept entries.**

You're right that UMLS assigns separate CUIs to products vs ingredients. The `may_treat` associations live on ingredient CUIs. We need the bridge.

**Schema change:** Add `ingredients_cuis` field to medication concept entries:

```jsonc
{
  "concept_id": "C0978484",
  "cui": "C0978484",
  "friendly_name": "Metformin 500 MG Oral Tablet",
  "category": "medication",
  "ingredients_cuis": ["C0025598"],   // ← ingredient CUIs for association lookup
  "drug_class": "Biguanide",
  // No associated_conditions here — those live on the ingredient CUI
}
```

**Runtime flow for medications:**
```
code 860975 → concept C0978484 → ingredients_cuis: ["C0025598"]
  → concept C0025598 → associated_conditions, monitoring_labs
```

One extra Map lookup. Clean, DRY, correct.

**For single-ingredient products** (the vast majority), `ingredients_cuis` has one entry. **For combination products** (e.g., Janumet = sitagliptin + metformin), it has multiple — the app unions the associations from all ingredients.

The ingredient concept entry itself does NOT carry `ingredients_cuis` (it IS the ingredient). Ingredient concepts carry `associated_conditions` and `monitoring_labs` directly.

---

## Issue 2: Disambiguation rule conflicts with CUI-keying

**Accepted: option (a) — composite concept_id for labs that need specimen disambiguation.**

CUI alone is too coarse for labs where specimen/system changes clinical meaning (creatinine serum vs urine, calcium total vs ionized, glucose blood vs urine). But we don't want to break the simple "code → concept_id → metadata" chain.

**Solution:** concept_id is the CUI for most categories. For labs requiring disambiguation, concept_id is a composite `"{cui}:{specimen}"`. The code entries carry this composite concept_id. No runtime ambiguity.

```jsonl
// Code entries — each code carries the composite concept_id
{"code":"38483-4","system":"loinc","concept_id":"C0026175:ser","search_texts":["Creatinine:MCnc:Pt:Ser","Creatinine in Serum"]}
{"code":"2160-0","system":"loinc","concept_id":"C0026175:ur","search_texts":["Creatinine:MCnc:Pt:Urine","Creatinine in Urine"]}

// Concept entries — composite key, CUI preserved
{"concept_id":"C0026175:ser","cui":"C0026175","friendly_name":"Creatinine, Serum","reference_ranges":{"default":{"low":0.6,"high":1.3,"unit":"mg/dL"}},...}
{"concept_id":"C0026175:ur","cui":"C0026175","friendly_name":"Creatinine, Urine","reference_ranges":{"default":{"low":20,"high":320,"unit":"mg/dL"}},...}
```

**Rules for when to split:**
- Split a CUI into multiple concept entries when codes under that CUI have **different reference ranges** or **different clinical meanings** for the patient
- Use the LOINC 6-axis system component (the second part of the LOINC name, e.g., "Ser", "Bld", "Urine") as the disambiguator suffix
- For CUIs that DON'T need splitting (most conditions, most meds, most non-specimen-sensitive labs), concept_id stays as the bare CUI

**Association impact:** `associated_labs` on conditions should reference the composite concept_id (e.g., `"C0026175:ser"`) when the condition cares about the specific specimen. If the condition just cares about "creatinine monitoring" generically, reference the bare CUI and let the app resolve to whichever specimen the patient has.

Simpler approach for v1: **always reference the composite concept_id** in associations. This is more specific and avoids ambiguity.

---

## Issue 3: Multiple friendly names per CUI

**Accepted: your recommendation (c + d) — MEDLINEPLUS-preferred, fall back to shortest, keep rest as aliases.**

Your reasoning is sound. MEDLINEPLUS names are explicitly curated for patient comprehension. Implement as:

1. If any code on the CUI resolved via MEDLINEPLUS source → use that friendly_name as primary
2. Else → use the shortest patient-friendly name across all codes on the CUI
3. All other distinct names go into `aliases`

We already track provenance (source system) in `patient_friendly_names.csv`, so this is deterministic at build time.

---

## Smaller items

### Code count alignment

Our estimates were rough. Let's align on actuals:

| Category | Use your counts | Notes |
|---|---|---|
| Conditions | ~340K | ICD-10 + SNOMED (TUI-filtered) |
| Labs | ~116K | LOINC TTY=LN + SNOMED lab. Skip LPN parts and LA answers — they add noise. Where did our 500K estimate come from? Probably including all LOINC TTYs. Let's use 116K. |
| Medications | ~83K | RxNorm product + ingredient + brand |
| Procedures | ~249K | CPT + ICD-10-PCS + SNOMED |
| Vaccines | ~300 | CVX + SNOMED |
| Encounter types | ~230 | CPT + SNOMED |

### GBD coverage

Agreed — document that `gbd_dw` will be `0` for ~95% of conditions. Consumers should treat `0` as "no data available", not "zero disability". Update field description to:

> `gbd_dw`: GBD 2023 disability weight (max across sequelae). `0` or absent means no GBD data for this condition (~95% of conditions). Do not interpret as "no disability".

### Build cadence

Agreed with your suggestion:
- **Code layer**: full rebuild per UMLS release (heavy)
- **Concept layer metadata**: incremental updates for curated additions (reference ranges, associations)
- Add `schema_version: "2.0"` as first line of each file
- Add `build_timestamp` field to file header

### Molecular weight

Out of scope for v1. Our UCUM library handles same-dimension conversions. Cross-dimension (mg/dL ↔ mmol/L) is rare in US EHR data. We can add PubChem MW lookup later if needed.

### Monitoring labs

If UMLS has monitoring relationships, include them. If not, skip for v1 — the condition→lab associations (from Synthea + any UMLS data available) cover the critical cases.

### Pre-compute embedding centroids

**Strong yes.** Pre-compute at build time. Store as `centroid: [0.123, -0.456, ...]` on each concept entry. Saves ~200ms × N at runtime.

---

## Updated concept entry schema (incorporating all resolutions)

### Medication concept (with ingredients_cuis)
```jsonc
{
  "concept_id": "C0978484",
  "cui": "C0978484",
  "friendly_name": "Metformin 500 MG Oral Tablet",  // via MEDLINEPLUS or shortest rule
  "aliases": ["Glucophage 500 MG"],
  "category": "medication",
  "ingredients_cuis": ["C0025598"],  // → look up associated_conditions on ingredient CUI
  "drug_class": "Biguanide"
}
```

### Medication ingredient concept (carries associations)
```jsonc
{
  "concept_id": "C0025598",
  "cui": "C0025598",
  "friendly_name": "Metformin",
  "aliases": ["Glucophage"],
  "category": "medication",
  "associated_conditions": ["C0011847"],  // Diabetes Type 2
  "monitoring_labs": ["C0700323:ser"],    // Creatinine, Serum
  "drug_class": "Biguanide"
}
```

### Lab concept (with specimen disambiguation)
```jsonc
{
  "concept_id": "C0026175:ser",
  "cui": "C0026175",
  "friendly_name": "Creatinine, Serum",
  "aliases": ["Creatinine"],
  "category": "lab",
  "observation_category": "lab",
  "reference_ranges": {
    "default": { "low": 0.6, "high": 1.3, "unit": "mg/dL" },
    "male": { "low": 0.7, "high": 1.3, "unit": "mg/dL" },
    "female": { "low": 0.6, "high": 1.1, "unit": "mg/dL" }
  },
  "associated_conditions": ["C0011847", "C0011849"]
}
```

### Condition concept (with CUI-keyed associations)
```jsonc
{
  "concept_id": "C0011847",
  "cui": "C0011847",
  "friendly_name": "Diabetes Type 2",
  "aliases": ["Type 2 Diabetes", "T2DM"],
  "category": "condition",
  "gbd_dw": 0.63,
  "associated_labs": ["C0487664", "C0026175:ser", "C0017745"],
  "associated_meds": ["C0025598"]
}
```

---

## Files we'll provide to the model team

| File | Content |
|---|---|
| `public/terminology/gbd_disability_weights.json` | 5,111 ICD-10 → DW (max across sequelae) |
| `public/terminology/reference_ranges.json` | 35 labs with sex-specific ranges, UCUM units |
| `public/terminology/condition_lab_relationships.json` | 34 conditions → labs (Synthea curated, name-keyed — needs conversion to CUI) |

These are ready to share now. The condition-lab file uses patient-friendly names (not codes) — the model team will need to crosswalk to CUIs during the concept-layer build.

---

## Next steps

1. Model team: implement the build pipeline per this resolved spec
2. App team: once unified JSONL files are delivered, build the app-side loaders (BM25 + CUI lookup + concept registry) and migrate from the current data assets
3. Both: validate end-to-end with the test patients (Sam Codes-Only, Robin No-Codes, Jordan Linked)

Ready to scope the build whenever you are.
