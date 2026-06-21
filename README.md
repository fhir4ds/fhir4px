# fhir4px

A patient-facing FHIR/SMART-on-FHIR progressive web app that helps patients understand their medical records. Connects directly to EHR patient portals (Epic, Cerner, etc.) via SMART on FHIR, downloads records to the browser, and organizes them into patient-friendly summaries — all client-side, zero server-side data custody.

**Live app**: [app.fhir4ds.com](https://app.fhir4ds.com)

## Key features

- **SMART on FHIR OAuth2 + PKCE** — connects to Epic, Cerner, and other EHR portals
- **Zero server-side data custody** — all patient data encrypted in browser IndexedDB via Web Crypto API
- **Multi-tier data cleanup** — resolves messy real-world FHIR data through a four-tier pipeline:
  1. Pattern matching (regex)
  2. Deterministic code lookup (LOINC, SNOMED, RxNorm, ICD-10 → patient-friendly names)
  3. BM25 full-text search (display text → patient-friendly name, ~81% accuracy)
  4. LLM fallback (optional, browser-based inference)
- **Priority scoring** — GBD disability weights + clinical boosters sort conditions/labs/meds by impact
- **Reference ranges** — ACP-based fallback ranges with UCUM unit conversion when resources lack them
- **Canonical code resolution** — maps patient-friendly names to ICD-10/LOINC/RxNorm codes for downstream lookups
- **Embedding classification** — observation category, allergy type, visit type via PubMedBERT centroids
- **Summary view** — cross-domain prioritized view with inline labs, medications, and reference ranges
- **Encrypted export** — generate encrypted bundles or QR codes for clinical handoff

## Tech stack

- **React** + **TypeScript** + **Vite**
- **MUI** (Material UI) for components
- **transformers.js** for browser-based ONNX inference (embeddings + optional LLM)
- **ONNX Runtime Web** with WebGPU/WASM backend
- **Vite PWA** for offline shell + service worker
- **Web Crypto API** for patient data encryption

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Connecting to a provider

1. Click **Providers** in the top nav
2. Select an EHR portal (Epic, Cerner, or local sandbox)
3. Authorize via the EHR's login page
4. Records download to the browser (encrypted, never sent to a server)

### Local sandbox

For development without a real EHR:

```bash
# Start local HAPI FHIR server
docker run -p 4004:80 hapicr/hapi-fhir-jpaserver

# Load test patients
npm run sandbox:load-fixtures
```

Test patients include:
- **Sam Codes-Only** (Tier 2) — standard LOINC/RxNorm/SNOMED codes
- **Alex Miscoded** (Tier 3) — vitals coded as labs and vice versa
- **Robin No-Codes** (Tier 4) — display text only, no codes
- **Jordan Linked** — conditions with deterministic lab/medication relationships

## Architecture

```
src/
├── app/                 # Routes
├── components/          # Shared UI (AppFrame)
├── lib/
│   ├── fhir/            # FHIR normalization, grouping, relationships
│   │   ├── bm25-naming.ts       # Tier 2: BM25 patient-friendly name resolver
│   │   ├── canonical-codes.ts   # Name → ICD-10/LOINC/RxNorm lookup
│   │   ├── reference-ranges.ts  # ACP fallback ranges + UCUM conversion
│   │   ├── patient-groups.ts    # Grouping + PatientFriendlyGroup type
│   │   └── ucum.ts              # UCUM unit conversion wrapper
│   ├── llm/             # LLM pipeline (currently disabled)
│   │   ├── config.ts            # LLM_ENABLED toggle
│   │   ├── transformers-llm.ts  # ONNX LLM wrapper (Llama 3.2 1B)
│   │   └── naming/              # Naming engine + incremental grouping
│   ├── embeddings/      # Tier 3: PubMedBERT classification
│   ├── priority/        # GBD scoring + relationship helpers
│   └── smart/           # SMART on FHIR OAuth
├── pages/               # App screens
│   ├── PatientExplorer.tsx      # Main records view (Summary/Group/Date modes)
│   ├── ProviderSearch.tsx       # EHR connection
│   ├── ReferralBuilder.tsx      # Clinical handoff
│   └── LocalExport.tsx          # Encrypted export
├── public/
│   └── terminology/     # Static data assets
│       ├── canonical-codes/     # Name → code lookup tables
│       ├── patient-friendly/    # Code → name lookup tables
│       ├── embeddings/prototypes/ # Classification prototypes
│       ├── gbd_disability_weights.json
│       └── reference_ranges.json
└── tests/               # Unit + e2e tests
```

## Data assets

| Asset | Size (gzipped) | Purpose |
|---|---|---|
| Patient-friendly name tables | ~5MB per code system | Code → name (Tier 1) |
| BM25 indexes | ~22MB total | Text → name (Tier 2) |
| Canonical code tables | ~3MB | Name → ICD-10/LOINC/RxNorm |
| GBD disability weights | ~150KB | Priority scoring |
| ACP reference ranges | ~30KB | Lab range fallbacks |
| Embedding prototypes | <100KB | Classification centroids |
| PubMedBERT ONNX (optional) | ~105MB | Embedding classification |
| Llama 3.2 1B ONNX (optional) | ~1GB | LLM naming (disabled) |

## License

[GNU Affero General Public License v3.0](LICENSE)
