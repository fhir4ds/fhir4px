# Review of Unified Concept Index Spec (v2.0-draft)

**From:** medterm4ds data team
**Date:** 2026-06-21
**Re:** Feedback on `unified-concept-index-spec.md` — two issues to resolve before implementation, plus disambiguation work to scope

Thanks for the spec — the two-layer design (code layer for BM25, concept layer for metadata, linked by CUI) is the right call. It cleanly solves the "name vs code" impedance mismatch we've been fighting with the canonical-codes table, and the Tier 1/2/3 flow returning a CUI at every tier is a real improvement.

We've reviewed it end-to-end against our UMLS data. **Two issues need resolution before we can implement**, because each affects the data shape. Plus a related disambiguation-garbling problem we need to scope, and a handful of smaller items.

---

## Issue 1: SCDs do not share CUI with their ingredients

The spec claims (lines 99–104):

> All four RxNorm codes (three products + one ingredient) map to CUI C0025598 (metformin). BM25 searches against all four — so "Glucophage 500 MG" matches code 860975, not just the ingredient entry.

**This is incorrect per UMLS semantics.** Verified in our 2026AA build:

| RxNorm code | TTY | CUI | STR |
|---|---|---|---|
| `6809` | IN (ingredient) | **C0025598** | metformin |
| `860975` | SCD (specific product) | **C0978484** | 24 HR metformin hydrochloride 500 MG Extended Release Oral Tablet |

IN and SCD have **different CUIs**. Same is true for SBD, MIN, and SCDG — UMLS assigns each product/formulation its own CUI.

### Why this matters for the spec

- A `MedicationRequest` with code `860975` will resolve to `cui: "C0978484"` at Tier 1
- The `may_treat` associations in our `condition_medication_ingredient.csv` are keyed by **ingredient code** (`6809`), so they live on the ingredient CUI (`C0025598`), not the SCD CUI (`C0978484`)
- At runtime, the app still needs to walk `SCD CUI → ingredient CUI → associations` — which reintroduces the decomposition problem the spec is trying to eliminate

### Options to resolve

| Option | How | Pros | Cons |
|---|---|---|---|
| **(a) `ingredients_cuis` array on each SCD/SBD concept entry** | Pre-compute ingredient CUIs at build time via the existing RxNorm decomposition (we already produce this in `rxnorm_ingredient_decomposition.csv`) | Concept layer stays DRY; O(1) code→CUI lookup; one extra hop at runtime is cheap | App needs to know to walk ingredients for medication associations |
| **(b) Association inheritance** | At build time, copy `associated_conditions` from each ingredient CUI to all SCD/SBD product CUIs that contain it | True O(1) at runtime | SCD concept entries bloat with redundant associations; harder to keep consistent across UMLS releases |
| **(c) Synthetic "rolled-up CUI"** | For products with exactly one ingredient, assign the ingredient's CUI to the product | Cleanest runtime story | Loses info for combination products; the "CUI" no longer matches UMLS, which breaks downstream CUI-keyed data (e.g., GBD weight if any) |

**Our recommendation: (a)** — preserves correctness, keeps the concept layer DRY, and the extra hop is a single Map lookup.

### Question for the team

Which option works for the app's runtime model? If (a), the concept-entry schema needs an `ingredients_cuis: [...]` field on medication concepts.

---

## Disambiguation rule (correct, but needs build-time work)

The spec requires (lines 286–292):

> If two concepts share the same `friendly_name` but have different clinical meanings or reference ranges, they MUST be separate concept entries (different CUIs) with disambiguated names.
>
> | Serum vs urine creatinine | "Creatinine" (same CUI) | Two CUIs: "Creatinine, Serum" + "Creatinine, Urine" |

**UMLS already provides the CUI-level disambiguation.** Verified:

| LOINC code | Test | CUI |
|---|---|---|
| `2160-0` | Creatinine, serum/plasma | **C0364294** |
| `38483-4` | Creatinine, whole blood | **C1526484** |
| `12190-5` | Creatinine, micro blood | **C0550281** |

Calcium is similar — total vs ionized, blood vs serum all get distinct CUIs. So the spec's disambiguation rule **works as written** at the CUI layer.

### But: today's `friendly_name` collapses them

Our resolver produces `friendly_name="Creatinine"` for all three of those codes because they share the LOINC component. So the concept layer would correctly have three distinct CUI entries, but all three would carry `friendly_name="Creatinine"` — defeating the disambiguation goal at the display layer.

**Build-time work needed**: when multiple CUIs in the same category share a friendly_name, append a disambiguator to make them distinct. Source of disambiguator:

- **Labs**: LOINC system axis (Bld / Ser/Plas / Urine / etc.) — already available via `mrsat.ATN='LOINC_SYSTEM'`
- **Conditions**: ICD-10 hierarchy depth or specific text in the technical name
- **Medications**: TTY or product vs ingredient distinction

This is mechanical work for us at build time. It doesn't change the concept schema — it just changes how we populate `friendly_name` when collisions occur. We'll handle it as part of the build, but flagging here so the team knows it's not "free" from UMLS alone.

---

## Issue 2: Multiple friendly names per CUI — picking rule unclear

`patient_friendly_names.csv` is keyed by `(source, code)`, not by CUI. Codes that share a CUI often have **different friendly names**. Verified in our data:

- **~11,100 CUIs** have multiple distinct friendly names across their codes
- Example: one CUI may have `"Speech Audiometry Threshold, Automated"` and `"Speech Threshold Hearing Test"` from different source codes

When the concept layer collapses to one entry per CUI, **we need a rule for which friendly_name wins**. The spec doesn't specify one.

### Options

| Option | How |
|---|---|
| **(a) Shortest** | Pick the shortest patient-friendly name per CUI — usually the cleanest |
| **(b) Most common in Table 1** | Pick the friendly name that the most input codes resolved to |
| **(c) MEDLINEPLUS-preferred** | If any code on the CUI resolved via MEDLINEPLUS, use that name; else fall back to (a) or (b) |
| **(d) All aliases** | Keep all of them in the `aliases` array and pick a primary via (a)/(b)/(c) |

**Our recommendation: (c) + (d)** — MEDLINEPLUS names are explicitly patient-friendly, fall back to shortest otherwise, and keep the rest as aliases. We already collect this provenance in Table 1.

### Question for the team

Confirm the picking rule, or specify your own. Once we know it, we'll apply it at concept-layer build time.

---

## Smaller items (no implementation blockers)

### Code count estimates vs our actual data

Spec estimates vs what we currently produce:

| Category | Spec estimate | Our current coverage | Gap |
|---|---|---|---|
| Conditions | ~280K | 98K ICD10 + 242K SNOMED (TUI-filtered) = **~340K** | Spec is low |
| Labs | ~500K | 104K LNC (TTY=LN only) + ~12K SNOMED lab = **~116K** | Spec is high — where would the extra ~384K come from? |
| Medications | ~42K | 83K (with brand/component TTYs) | Spec is low |
| Procedures | ~300K | 15K CPT + 79K ICD10PCS + 155K SNOMED proc (incl. T058 Health Care Activity) = **~249K** | Roughly aligned |

For labs specifically — including all LNC TTYs (LPN parts, LA answers) would push the number higher but adds noise. What's the source of the 500K estimate? Worth aligning on lab scope before we build.

### GBD coverage is sparse

Spec says "5,111 ICD-10 codes → disability weight". Our condition layer has ~98K ICD-10 codes. So **~5% of conditions** will have a non-zero `gbd_dw`. The spec should set expectations: most `gbd_dw` values will be `0`/`null`, and consumers should treat absence as "no data" rather than "zero disability". Suggest documenting this in the field description.

### Build cadence tension

UMLS updates twice yearly (AA releases, ~May/November). But:
- Synthea condition-lab curated data may update more often
- Reference ranges update occasionally
- GBD updates annually

**Suggestion**: rebuild the code layer per UMLS release (heavy — full re-extraction). Allow **incremental updates** of concept-layer metadata (curated additions like reference ranges) without a full rebuild. This means the concept file should have a build timestamp or content hash the app can check.

### Missing from spec

- **No `schema_version` field** on either layer. If the format evolves, consumers can't tell. Add `"schema_version": "2.0"` to the first line of each file.
- **No version field on records**. If code and concept files from different builds coexist (e.g., during a migration), there's no way to detect mismatched pairs.
- **Open question 5 (embedding prototype pre-computation)** — strong yes. Pre-compute centroids at build time from `search_texts` grouped by CUI. Saves ~200ms × N lookups at runtime. Worth doing.

---

## What we can produce from existing data

Most of the source fields in the spec come from data we already have or can derive:

| Spec field | Our current source |
|---|---|
| Code entries (code, system, search_texts) | UMLS MRCONSO per-source filters — we already do this in `build_embedding_index_full.py` |
| CUI linking | UMLS MRCONSO (`CUI` column) — already in our schema |
| `friendly_name`, `aliases` | `patient_friendly_names.csv` (1.1M rows) |
| `associated_meds` | `condition_medication_ingredient.csv` (2.98M rows, UMLS `may_treat`) — already produced |
| `observation_category` | `mrsat.ATN='LCL'` (LOINC CLASS) — already in our schema |
| `encounter_class` | We have the Encounter Type ValueSet index; can map to class |
| Drug class | ATC levels (already extracted in `rxnorm_ingredient_decomposition.csv`) |

**New sources we'd need from the app team:**

| Field | Source | Status |
|---|---|---|
| `gbd_dw` | `gbd_disability_weights.json` (5,111 codes) | App team to provide |
| `reference_ranges` | `reference_ranges.json` (35 labs) | App team to provide |
| `associated_labs` (Synthea baseline) | `condition_lab_relationships.json` (34 conditions) | App team to provide |
| `molecular_weight` | PubChem (not in UMLS) | New lookup needed; out of current scope |
| `monitoring_labs` | UMLS monitoring relationships | May exist in UMLS — needs investigation |

---

## Summary

The spec is implementable once we resolve the two issues:

- **Issue 1** (medication ingredient CUIs) affects medication concept-entry schema
- **Issue 2** (friendly-name picking rule) affects every concept entry

The disambiguation rule is correct but needs build-time name-collision resolution — we'll handle that on our side, no team decision needed.

Once the team confirms the resolution for each issue, we can scope the build. The data we have already covers ~70% of the spec; the remaining 30% is either app-team-curated files or new UMLS lookups.

Happy to discuss on a call if easier — the two issues benefit from a back-and-forth to land on the right trade-offs.