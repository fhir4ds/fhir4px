# Browser-Side P4 Association Matching — Integration Guide

**To:** fhir4px app team
**From:** fhir4px-model team
**Date:** 2026-07-15

---

## What's new

We've added **browser-side clinical association matching** (Pipeline 4) using pre-computed embeddings. When a user clicks on a medication or condition in the patient record, the app can instantly identify which labs, vitals, and other items are clinically relevant — without a server call.

This uses the **same ONNX model already loaded** in your app (`joelmontavon/fhir4px-embeddings-onnx`, q8). No additional model download needed — just the centroid data file.

---

## What's available

### Files on HuggingFace

**Repo:** `joelmontavon/fhir4px-embeddings-onnx`
**Path:** `p4_centroids/`

| File | Size | Purpose |
|---|---|---|
| `p4_associations.json` | 23MB | Pre-computed member embeddings (all concepts) |
| `p4_associations.json.gz` | **5.4MB** | Gzipped — use this for downloads |
| `p4_association_resolver.js` | 9KB | Browser resolver module |

### Data coverage

| Type | Concepts | Example |
|---|---|---|
| Medications | 3,849 | metformin, lisinopril, warfarin, ... |
| Conditions | 2,167 | diabetes type 2, hypertension, CKD, ... |
| Vitals | 392 | blood pressure, heart rate, ... |
| Procedures | 88 | ECG, chest X-ray, hepatitis screening, ... |

Each concept has 5-20 pre-computed member embedding vectors (768-dim) representing its clinically associated labs, medications, conditions, vitals, and procedures.

---

## How it works

```
1. App already has the ONNX PubMedBERT model loaded (for classification centroids)
2. User clicks "Metformin" in the patient record
3. App loads p4_associations.json (5.4MB gzipped, one-time)
4. For each patient lab/med/condition:
   a. Embed the item text using the existing ONNX model (~100ms)
   b. Compare against metformin's pre-computed member embeddings
   c. If similarity ≥ 0.45 → relevant
5. UI highlights relevant labs — no server call, patient data never leaves browser
```

---

## Integration

### Step 1: Install the resolver

Copy `p4_association_resolver.js` into your app's assets, or fetch from HF:

```javascript
import { P4Resolver } from './assets/p4_association_resolver.js';
```

### Step 2: Initialize (once, after model load)

```javascript
import { pipeline, env } from '@huggingface/transformers';

// You already have this for classification centroids:
env.allowRemoteModels = true;
const extractor = await pipeline(
  'feature-extraction',
  'joelmontavon/fhir4px-embeddings-onnx',
  { dtype: 'q8' }
);

// Initialize P4 resolver with the SAME extractor (no extra model load)
const p4 = new P4Resolver({
  centroidsUrl: 'https://huggingface.co/joelmontavon/fhir4px-embeddings-onnx/resolve/main/p4_centroids/p4_associations.json',
  extractor: extractor,  // Reuse the same pipeline instance
  threshold: 0.45,
});

await p4.init();
// Ready: ~5.4MB download + ~1s parse
```

### Step 3: Find relevant items when user selects a concept

```javascript
// User clicks "Metformin" in their medication list
const result = await p4.findRelevant('metformin', {
  medications: [
    {id: 'med_1', text: 'Metformin 1000mg BID'},
    {id: 'med_2', text: 'Lisinopril 10mg daily'},
    {id: 'med_3', text: 'Omeprazole 20mg daily'},
  ],
  conditions: [
    {id: 'cond_1', text: 'Type 2 Diabetes'},
    {id: 'cond_2', text: 'CKD Stage 3'},
  ],
  labs: [
    {id: 'lab_1', text: 'eGFR: 28'},
    {id: 'lab_2', text: 'A1c: 9.2%'},
    {id: 'lab_3', text: 'LDL: 145'},
    {id: 'lab_4', text: 'Sodium: 138'},
  ],
});

console.log(result);
```

### Step 4: Use the results

```javascript
// result looks like:
{
  source: 'centroid',
  concept: 'metformin',
  concept_key: 'metformin',
  threshold: 0.45,
  relevant_medications: [
    {id: 'med_1', text: 'Metformin 1000mg BID', similarity: 0.95, matched_member: 'metFORMIN'},
  ],
  relevant_labs: [
    {id: 'lab_1', text: 'eGFR: 28', similarity: 0.84, matched_member: 'Creatinine'},
    {id: 'lab_2', text: 'A1c: 9.2%', similarity: 0.72, matched_member: 'A1c'},
  ],
  relevant_conditions: [
    {id: 'cond_1', text: 'Type 2 Diabetes', similarity: 0.65, matched_member: 'diabetes'},
  ],
}

// Highlight relevant items in the UI
result.relevant_labs.forEach(lab => {
  document.getElementById(lab.id).classList.add('highlight');
});
```

---

## Performance

| Metric | Value |
|---|---|
| Initial data download | 5.4MB gzipped (one-time) |
| Data parse time | ~1s |
| Per-item embedding | ~100ms (depends on device) |
| Per-item matching | <1ms (pre-computed vectors, cosine sim) |
| **Total for 10-item context** | **~1s** (10 embeddings + 10 comparisons) |
| Server call saved | Yes — zero network round trips |

### Batch mode (more efficient for scanning full records)

If you need to check multiple concepts against the same patient record (e.g., scanning all medications), use `findRelevantBatch()` — it embeds each patient item once and reuses:

```javascript
const results = await p4.findRelevantBatch(
  ['metformin', 'lisinopril', 'atorvastatin'],
  patientContext
);
// Returns: { metformin: {...}, lisinopril: {...}, atorvastatin: {...} }
```

---

## Response format

```typescript
interface P4Result {
  source: 'centroid' | 'not_found';
  concept: string;           // The concept queried
  concept_key: string;       // Matched key in centroid data
  threshold: number;         // Similarity threshold (0.45)
  relevant_medications: P4Item[];
  relevant_labs: P4Item[];
  relevant_conditions: P4Item[];
}

interface P4Item {
  id: string;                // The patient context item ID
  text: string;              // The patient context item text
  similarity: number;        // Cosine similarity (0.0 - 1.0)
  matched_member: string;    // Which member name matched (e.g., "Creatinine", "A1c")
}
```

---

## What this replaces (and what it doesn't)

### Replaces: Server call to P4 `/api/associations`

For concepts that are in the centroid data (5,661 concepts), the browser can match locally in ~1s. No server call needed.

### Does NOT replace: P5 clinical Q&A, safety checking, alerts

This identifies **which items are related** to a concept. It does NOT:
- Explain WHY they're related (use the LLM)
- Detect drug-drug interactions (use the LLM via P5)
- Generate alerts or recommendations (use the LLM via P5)
- Provide clinical reasoning (use the LLM via P5)

Use the server's `/api/associations` endpoint as fallback for:
- Concepts not in the centroid data
- When the user needs clinical reasoning, not just matching
- When alerts are needed

---

## Concept name matching

The resolver handles common name variations automatically:

| Input concept | Matches centroid key |
|---|---|
| "Metformin" | metformin |
| "Type 2 Diabetes" | diabetes type 2 |
| "T2DM" | diabetes type 2 |
| "Hypertension" | high blood pressure / essential hypertension |
| "CKD" | chronic kidney disease |
| "CHF" | heart failure |

For names not found, the resolver returns `source: 'not_found'` with empty arrays.

---

## Limitations

1. **Threshold-dependent**: At 0.45, ~83% precision, ~67% recall. Some relevant items may be missed; some borderline items may be included.

2. **Per-concept matching**: Each concept is matched independently. Cross-concept relationships (e.g., "diabetes affects CKD management") are not handled — those need the LLM.

3. **No frequency/timing data**: The centroids identify WHAT labs are relevant, not HOW OFTEN to check them. For "check A1c every 3 months", use the server endpoint.

4. **Static data**: The centroid file is a snapshot. To update, re-download the file from HF after we publish new versions.

---

## Questions?

Reply to this thread or ping us. The resolver is ready to use today.
