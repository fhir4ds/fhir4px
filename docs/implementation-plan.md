# fhir4px Implementation Plan

**Status:** Active execution plan with MVP foundation implemented
**Date:** May 26, 2026
**Scope:** Build the zero-server browser PWA described in `architecture.md`

---

## 1. Implementation Goal

Build a browser-only SMART on FHIR PWA that lets a patient:

1. Find a provider endpoint.
2. Launch SMART OAuth against the source EHR.
3. Fetch scoped FHIR resources directly from the source EHR into the browser.
4. Explore medications, conditions, observations, and related records in a patient-friendly mobile view.
5. Use local, browser-only AI assistance to group confusing or uncodified clinical labels without sending patient data to fhir4px servers.
6. Store sensitive local state only in an encrypted local vault.
7. Generate zero-server referral handoffs after the patient has reviewed and organized their record.

The implementation must preserve the core rule: fhir4px backend services never receive records, tokens, patches, manifests, encrypted bundles, referral payloads, or patient-provider relationship history.

---

## 2. Current Implementation Status

**Senior foundation and patient-explorer foundation status:** Complete as of May 26, 2026.

Completed:

- Vite React TypeScript PWA scaffold
- MUI app shell and route structure
- Internal browser SMART module adapted from the prior `fhir4ds` SMART flow
- SMART discovery with `.well-known/smart-configuration` and `/metadata` fallback
- Browser-only PKCE authorization URL generation
- Browser-only callback/token exchange
- Plaintext token persistence removed
- Transient OAuth state namespaced to `fhir4px_*` with TTL cleanup
- Dexie-backed encrypted local vault
- Web Crypto AES-GCM envelope helpers
- WebAuthn PRF key-path placeholder with session-only MVP fallback
- WebAuthn PRF profile registration/forget UX in Settings
- MVP refresh-token non-retention policy implemented
- FHIR browser fetch module with Epic header support, pagination, and partial resource tolerance
- FHIR normalization and patient patch primitives
- Observation/lab normalization and referral summary display
- Patient patch editing screens for medication status/comment, allergy correction, and condition notes
- Encrypted patient patch persistence in the local vault
- Local encrypted Bundle and QR summary library rails
- Local encrypted Bundle save/share UX with one-time export keys
- Patient patch include/exclude support during encrypted Bundle export
- Date-range filtering for high-volume export resources
- QR summary generation UI with scanner-size fallback to encrypted Bundle
- DuckDB provider directory ETL scaffold and generated Chicago public directory artifact
- Provider directory Census batch geocoding for matched practice addresses
- Provider directory 50-mile Chicago pilot export filter and provider/FHIR-base endpoint deduplication
- Provider directory Chicago denominator coverage report
- Provider directory endpoint validation crawler with bounded top-N mode
- Provider directory low-confidence and missing-endpoint assisted-review packet generation plus assertion validation scripts
- CMS National Provider Directory download/ingest scripts and Chicago candidate coverage report
- Provider search UI wired to sandbox records plus the generated public Chicago artifact
- Provider search by name, organization, specialty, ZIP, and endpoint brand
- Provider result sorting by name or distance from entered coordinates/ZIP-derived origin
- Production static security headers, including CSP, referrer, no-sniff, and permissions policy
- Formal engineering security review document and sandbox validation checklist
- PWA service-worker cache allowlist policy
- Security-focused unit tests for SMART auth, vault encryption, FHIR fetch/filtering/normalization, handoff encryption, directory search, security headers, and cache policy
- Playwright app-shell, Epic authorize-request, Cerner authorize-request, provider directory, callback, and cache-storage tests
- Epic launch hardening for `http://localhost:3000`, root-route callback handling, normalized `aud`, and fhir4ds-compatible Epic sandbox scopes
- Safe Vite env bridge for public sandbox base URLs and client IDs only
- Mobile-first patient-friendly Records explorer route for medications, conditions, observations/labs, and vaccines
- Browser-only exact-source pre-clustering with a WebLLM adapter for `Llama-3.2-3B-Instruct-q4f16_1-MLC`
- WebLLM structured-output validation and source-record fallback handling
- WebLLM chunk split out of the main app bundle and excluded from service-worker precache
- FHIR reference indexing, local reference resolution, and bounded same-server missing-reference fetches
- Observation value/unit normalization with original-value preservation and conservative canonical conversions
- Immunization normalization and referral-summary inclusion
- Local patient-authored medication, condition, and vaccine records plus hidden/inactive local-view overlays
- SMART Dev Sandbox cloned under `build/test-harness/smart-dev-sandbox`, configured as R4-only with the empty HAPI image to avoid local OOM failures
- Synthetic R4 patient-explorer fixture and `npm run sandbox:load-fixtures` loader for local SMART Dev Sandbox data
- Production build and audit verification

Verification completed:

```text
npm run typecheck
npm run test:run
npm run build
npm run test:e2e
npm run sandbox:load-fixtures
npm audit
```

Remaining work:

- Epic authorize validation now matches the older fhir4ds behavior: Epic accepts the configured non-production client ID with exact redirect URI `http://localhost:3000` and rejects `https://localhost:3000`, trailing slash variants, and callback-path variants.
- Real-device WebLLM performance and memory testing, especially mobile load time, WebGPU availability, and smaller-model fallback decisions
- Terminology-server `$translate`/coding enrichment remains deferred until after local grouping quality is measured
- Cross-resource grouping, trend charts, and richer timeline/report/document views remain future patient-explorer work
- SMART Dev Sandbox launcher-path validation with synthetic patient selection remains manual
- Manual Epic and Cerner sandbox login/consent validation with local `.env` credentials
- Manual encrypted Bundle, QR summary, and patient patch include/exclude validation with sandbox patient data
- Provider directory manual QA and public-evidence review before enabling real endpoint launch
- Health-system scraper adapters for priority Chicago systems beyond the generic review-packet workflow
- Production deployed-origin CSP/header verification
- WebAuthn PRF cross-browser/device testing and recovery decision
- Legal/compliance review before real patient data
- Expand and adjudicate health-system affiliation candidates from AHRQ→ONC Lantern joins before broader launch
- Expand and adjudicate health-system affiliation candidates from additional public sources (including direct practitioner-source joins) before broader launch

---

## 3. Available Test Configuration

The local `.env` file contains test configuration for Epic and Cerner/Oracle sandbox flows. Do not print, commit, or expose secret values.

The registered local SMART redirect origin is:

```text
http://localhost:3000
```

The PWA dev server and Playwright config use this origin so `window.location.origin` produces the exact registered redirect URI. The root route handles callback query parameters such as `?code=...&state=...`.

Relevant key names:

- `EPIC_SANDBOX_BASE_URL`
- `EPIC_NON_PROD_CLIENT_ID`
- `EPIC_NON_PROD_TEST_USER1_USERNAME`
- `EPIC_NON_PROD_TEST_USER1_PASS`
- `EPIC_NON_PROD_TEST_USER2_USERNAME`
- `EPIC_NON_PROD_TEST_USER2_PASS`
- `EPIC_SANDBOX_REDIRECT_URL`
- `CERNER_SANDBOX_BASE_URL`
- `CERNER_APP_ID`
- `CERNER_CLIENT_ID`
- `CERNER_TEST_USER1_USERNAME`
- `CERNER_TEST_USER1_PASS`
- `VITE_EPIC_CLIENT_ID`
- `VITE_CERNER_CLIENT_ID`

Rules:

- Only `VITE_*` values may be used by browser code.
- The Vite config maps only safe public non-`VITE_` values into the browser when the `VITE_*` equivalent is absent: client IDs and sandbox base URLs only.
- Test usernames and passwords are for Playwright/manual test harnesses only.
- Never bundle usernames/passwords into the PWA.
- Never log credential values.
- Never include `.env` in generated docs, screenshots, test output, or fixtures.

---

## 4. Target Stack

- React + TypeScript + Vite
- MUI Material with custom fhir4px theme
- React Router SPA mode
- Dexie over IndexedDB
- Web Crypto API directly
- WebAuthn PRF where supported
- Internal SMART module adapted from the prior `fhir4ds` implementation
- WebLLM for local browser-only grouping, starting with `Llama-3.2-3B-Instruct-q4f16_1-MLC`
- `vite-plugin-pwa` / Workbox with explicit cache allowlists
- `lucide-react` icons inside MUI controls
- Vitest for unit tests
- Playwright for browser and sandbox SMART flow tests
- SMART Dev Sandbox as an optional local Docker-based R4 SMART/FHIR test harness for rapid patient-explorer testing with sample or custom datasets

---

## 5. Repository Shape

Initial application structure:

```text
src/
  app/
    App.tsx
    routes.tsx
    theme.ts
  components/
    layout/
    workflow/
    fhir/
  lib/
    smart/
      discovery.ts
      oauth.ts
      callback.ts
      data.ts
      providers.ts
      types.ts
    vault/
      crypto.ts
      db.ts
      keys.ts
      types.ts
    fhir/
      normalize.ts
      filters.ts
      references.ts
      observation-values.ts
      patient-groups.ts
      bundle.ts
      patches.ts
    llm/
      webllm.ts
      grouping.ts
    handoff/
      qr-summary.ts
      encrypted-bundle.ts
      source-pull.ts
    directory/
      client.ts
      types.ts
    pwa/
      register-sw.ts
  pages/
    Home.tsx
    ProviderSearch.tsx
    SmartCallback.tsx
    ConnectedProvider.tsx
    ReferralBuilder.tsx
    LocalExport.tsx
    Settings.tsx
tests/
  unit/
  e2e/
```

The first implementation can keep everything in a single Vite app. The provider directory API can remain a mocked/static client until the UI and SMART flow are working.

---

## 6. Milestone 0: Project Bootstrap

**Status:** Complete.

### Tasks

- Initialize Vite React TypeScript app in this directory.
- Add MUI, Emotion, React Router, Dexie, lucide-react, Vitest, Playwright, and PWA tooling.
- Add strict TypeScript config.
- Add formatting/linting.
- Add `.env.example` with key names only.
- Ensure `.env` is ignored if a Git repo is initialized.
- Add basic app shell, router, and theme.

### Acceptance Criteria

- `npm run dev` starts the PWA locally.
- The local dev origin is `http://localhost:3000`.
- `npm run build` completes.
- `npm test` runs unit tests.
- No `.env` values are emitted into the app or logs.

---

## 7. Milestone 1: Internal SMART Module

**Status:** Complete for foundation; pending manual sandbox validation.

Adapt the prior `fhir4ds` SMART code into `src/lib/smart`.

### Source Details to Reuse

From `/mnt/d/fhir4ds/web/wasm-demo/src/lib/smart-auth.ts`:

- SMART discovery through `.well-known/smart-configuration`
- CapabilityStatement `/metadata` fallback
- PKCE verifier/challenge generation
- Authorization URL construction
- Callback handling
- Token endpoint exchange
- Popup callback support
- URL cleanup after callback

From `/mnt/d/fhir4ds/web/wasm-demo/src/lib/smart-config.ts`:

- Epic and Cerner sandbox configuration shape
- Scope patterns
- Client ID environment handling

From `/mnt/d/fhir4ds/web/wasm-demo/src/lib/smart-data.ts`:

- Epic `Epic-Client-ID` header
- Bundle pagination
- Auth/scope error handling
- Partial resource fetch tolerance

### Required Changes

- Rename storage keys from `fhir4ds_*` to `fhir4px_*`.
- Remove plaintext token persistence.
- Remove plaintext callback result persistence.
- Add TTL to transient OAuth state.
- Store only transient PKCE state in web storage when needed.
- Route token persistence through the encrypted local vault.
- Stop logging redirect URIs, patient IDs, token details, scopes, or endpoint-specific patient flow failures.
- Expand resource fetch coverage based on `fhir-scope.md`.

### Acceptance Criteria

- Epic sandbox authorization URL can be generated from env/config.
- Cerner sandbox authorization URL can be generated from env/config.
- OAuth callback validates state and exchanges code without backend involvement.
- Token response is never written to plaintext `localStorage`.
- Expired/missing auth state produces a recoverable UI error.

---

## 8. Milestone 2: Local Vault

**Status:** Complete for session-only MVP fallback and initial WebAuthn PRF profile UX; cross-browser testing remains.

### Tasks

- Implement Dexie schema for encrypted vault records.
- Implement Web Crypto encryption/decryption helpers.
- Implement vault envelope format with version, algorithm, IV, associated data, and ciphertext.
- Implement WebAuthn PRF key path where available.
- Implement MVP fallback behavior.
- Add clear-local-data control.

### MVP Fallback Recommendation

For the first build, use:

- WebAuthn PRF-backed persistent vault when registered and available.
- Session-only mode when PRF is unavailable.

Passphrase-backed export/import can be added after the core SMART flow works.

### Acceptance Criteria

- Vault writes contain ciphertext, not plaintext tokens or PHI.
- Local data wipe clears Dexie, transient auth state, and relevant app state.
- App remains usable after wipe through provider re-auth.
- Unit tests verify encryption before write.

---

## 9. Milestone 3: Provider Directory MVP

**Status:** Public artifact search, geocoding, endpoint validation, assisted-review packet generation, assertion import, and evaluation reporting are wired. Health-system affinity coverage now includes deterministic AHRQ→ONC Lantern joins (adds 8,307 candidate-mapped missing providers before review), a strict review-only vector candidate path, provider endpoint evidence graph scoring, and top-3 confirmation recommendations, while manual QA and expanded priority-system scraper coverage remain.

### Tasks

- Add static sandbox provider records for Epic and Cerner using `.env` base URL/client ID config.
- Build provider search UI with MUI.
- Build provider detail page showing endpoint and launch readiness.
- Add directory client abstraction so static data can later be replaced with API data.
- Add no-patient-history logging rule to code comments/tests.
- Load generated Chicago public directory artifact from `/directory-public/chicago-directory.json`. **Complete.**
- Search generated records by provider, organization, specialty, ZIP, and endpoint/access brand. **Complete.**
- Sort by name, and by distance when `lat`/`lon` are present. **Complete.**
- Geocode matched provider practice addresses through Census batch geocoding. **Complete for current artifact: 4,043 matched-provider addresses, 35,392 matched providers with coordinates before pilot filtering.**
- Export only taxonomy-eligible providers within 50 miles of the Chicago Loop for the pilot artifact. **Complete for current artifact: 18,011 providers and 23,686 endpoint links.**
- Reject obviously invalid NPPES endpoint candidates and deduplicate provider/FHIR-base endpoint rows. **Complete: 679 bad endpoint candidates rejected.**
- Import CMS National Provider Directory bulk FHIR resources and derive endpoint candidates. **Complete: 6,929 candidate rows for 4,559 providers; explicit role/organization endpoint evidence adds 1,210 previously unmatched providers and affiliation evidence brings total new coverage to 2,577 providers.**
- Generate Chicago pilot denominator coverage report. **Complete: 48,144 taxonomy-eligible active individual providers in radius; 18,011 with any endpoint match (37.41%); 13,222 with high-confidence endpoint match (27.46%).**
- Apply MVP patient-search taxonomy policy. **Complete: physicians, PAs, NPs, clinical nurse specialists, advanced practice midwives/CNMs, and podiatry included; optometry and ancillary/non-prescriber categories excluded.**
- Validate public SMART endpoints in bounded top-N mode. **Complete for top 20 current endpoints: 19 of 20 exposed authorization metadata.**
- Generate assisted-review packets for low-confidence endpoint mappings and missing pilot endpoint coverage. **Complete.**
- Generate balanced 500-task missing-endpoint review packets with known priority-system endpoint hints. **Complete.**
- Validate and import accepted public-evidence assertions into DuckDB with provenance. **Complete.**
- Consume accepted reviewed assertions in provider-to-endpoint matching through explicit reviewed match methods. **Complete.**
- Generate assisted-review evaluation reports and manual QA samples. **Complete.**
- Run first deterministic public-profile calibration import. **Complete: 10 accepted Northwestern assertions added via `scrape_reviewed_assertion`.**
- Generate health-system affiliation enrichment candidates using AHRQ hospital→health-system links joined to ONC Lantern organizations/endpoints. **Complete: 1 review-ready candidate table generated with 2,156,945 rows, covering 15,282 unique providers and 8,307 missing providers (27.57% of missing).**
- Generate vector-assisted health-system affiliation candidates by embedding unmatched provider records and an endpoint profile corpus (merged ONC Lantern / CMS NPD / pilot endpoint evidence) to produce review-only candidate endpoint links. **Complete as infrastructure: endpoint profile hygiene now excludes weak `contains_org_match` public rows, splits multi-URL blobs, and caps large alias/address sets; vector matching uses structured postfilters and disables broad city/state fallback by default. Full strict TF-IDF baseline: 1,791 candidates for 1,147 of 30,133 unmatched providers (`3.81%`). A full strict semantic run remains optional benchmarking before vector candidates feed assisted review at scale.**
- Build provider endpoint evidence graph scoring across deterministic, CMS NPD, public health-system, and strict vector evidence. **Complete: `provider_endpoint_evidence_edge` and `provider_endpoint_candidate_scored` are generated with recommendations such as `accept_candidate`, `review_direct`, `review_affiliation`, and `review_vector_only`; report emitted at `build/directory/reports/provider-endpoint-evidence-graph-report.json`.**
- Generate top-3 provider endpoint recommendations for confirmation and manual QA. **Complete: `provider_endpoint_recommendation` ranks deduped provider/access-brand/endpoint options using empirical QA calibration and access-brand canonicalization, suppresses weak evidence paths from visible recommendations, stores `provider_endpoint_recommendation_qa_sample`, and emits `provider-access-brand-recommendation-qa.jsonl` with 500 public-metadata tasks focused on provider -> practice/group/location -> access brand confirmation. The cleaned provider profile layer now combines NPPES, CMS Doctors and Clinicians, and CMS NPD public facts so stale NPPES locations can be superseded by corroborated group/location evidence before mapping to access brands/endpoints.**

### Acceptance Criteria

- User can select Epic sandbox provider.
- User can select Cerner sandbox provider.
- Browser code receives only public endpoint metadata and `VITE_*` client IDs.
- No provider search or connection history is sent to a backend.
- Public real-world endpoint records are shown without enabling launch until an app registration/client ID exists.

---

## 10. Milestone 4: SMART Connection UX

**Status:** Foundation and mocked Epic/Cerner authorize checks complete; full external login/consent validation remains.

### Tasks

- Build connect flow.
- Handle SMART callback query parameters on the registered root redirect route.
- Build connection status UI.
- Build re-auth and disconnect controls.
- Build recoverable error states for denied access, missing scopes, expired state, CORS failure, and token exchange failure.
- Add popup or same-window launch decision.

### Acceptance Criteria

- Epic sandbox connection can complete manually.
- Cerner sandbox connection can complete manually.
- Callback route cleans OAuth params from URL.
- Tokens enter encrypted vault or session-only memory, never plaintext persistent storage.
- Disconnect removes local token/vault connection records.

---

## 11. Milestone 5: FHIR Fetch and Aggregate View

**Status:** Fetch/normalization and medication/allergy/condition/Observation UX complete; richer report/document views remain future work.

### Tasks

- Fetch `Patient`.
- Fetch referral summary resource set:
  - `MedicationRequest`
  - `AllergyIntolerance`
  - `Condition`
  - `Observation`
- Add optional expanded resources:
  - `DiagnosticReport`
  - `DocumentReference`
  - `Encounter`
  - `Procedure`
  - `Immunization`
- Add pagination and resource-specific query behavior.
- Add progress UI.
- Add normalization for medication/allergy/problem/lab display. **Complete for medication, allergy, condition, and Observation.**

### Acceptance Criteria

- Browser fetches FHIR resources directly from source EHR.
- No fhir4px backend proxy is used.
- Unsupported resource types degrade gracefully.
- Expired token and insufficient-scope errors are clear and recoverable.
- Service worker does not cache FHIR responses.

---

## 12. Milestone 5A: Patient-Friendly Record Explorer

**Status:** Foundation implemented. Compact exact-source clustering, incremental WebLLM naming, observation trend summaries, and large synthetic grouping fixtures are in place. Real-device WebLLM testing, terminology enrichment, cross-resource grouping, and richer timeline/report views remain.

The explorer should make the patient record useful on its own. Referral handoff remains the long-term monetization path, but the near-term product should help patients understand medications, conditions, observations, and related context before they generate a referral.

Implemented foundation:

- `/records` mobile-first route fetches SMART resources directly from the source FHIR server and renders medications, conditions, labs/observations, and vaccines.
- Exact source-fact grouping runs immediately; WebLLM patient-friendly naming is attempted only in browser contexts with WebGPU and validated before use.
- Before WebLLM runs, repeated records are compacted into stable per-resource clusters so large patients do not send hundreds of repeated labs/vitals to the local model.
- Patient-authored medications, conditions, and vaccines can be added locally; provider-authored facts remain read-only.
- Local hide/inactive overlays are stored as encrypted vault records and do not alter source FHIR JSON.
- Reference-resolution and Observation-normalization summaries are surfaced as non-fatal display context.
- Observation groups show latest value, result count, numeric range when available, and recent values over time.

### Product Direction

- Mobile-first clinical timeline and grouped resource views.
- Organize by major FHIR resource type first: medications, conditions, and observations in the first pass.
- Group related clinical labels into patient-friendly groups automatically.
- Keep all AI processing in the browser with WebLLM. Do not send FHIR resources, prompts, labels, model outputs, or grouping decisions to fhir4px servers.
- Start with `Llama-3.2-3B-Instruct-q4f16_1-MLC`. Test mobile performance, loading time, memory use, and structured-output reliability before deciding whether a smaller fallback is required.
- Defer remote terminology-server calls for MVP. Source codes/displays remain available to the grouping prompt, but the first implementation should see how far local WebLLM can get without a live terminology service.

### FHIR Reference Resolution Tasks

- Build an in-memory resource index keyed by:
  - `ResourceType/id`
  - relative references such as `Medication/123`
  - same-server absolute references when they can be safely normalized
- Resolve references from already-fetched resources before making network calls.
- Detect missing same-server references that materially improve display, including:
  - `MedicationRequest.medicationReference -> Medication`
  - `MedicationStatement.medicationReference -> Medication`
  - `Encounter.reasonReference -> Condition`
  - `DiagnosticReport.result -> Observation`
  - `Observation.encounter -> Encounter`
- Fetch missing references directly from the source FHIR server in the browser when the reference is same-origin/same-FHIR-base and the granted SMART scopes allow it.
- Prefer bounded direct `GET /ResourceType/id` reads for missing references. Evaluate `_include` only where it improves compatibility without making the primary fetch path brittle.
- Track unresolved references as display warnings, not fatal errors.
- Never send unresolved-reference identifiers to fhir4px servers.

### Observation Value and Unit Normalization Tasks

- Preserve the original `Observation.value[x]`, unit, code, system, comparator, reference range, interpretation, and effective date.
- Add normalized display fields for:
  - numeric value
  - display unit
  - UCUM code where present
  - canonical value/unit for common lab and vital-sign units
  - sortable effective date
  - abnormal/source interpretation flag
- Support common `value[x]` variants:
  - `valueQuantity`
  - `valueCodeableConcept`
  - `valueString`
  - `valueBoolean`
  - `valueInteger`
  - `valueDateTime`
  - `valuePeriod`
  - `dataAbsentReason`
- Use conservative unit conversion only for known-safe common cases. Keep unknown units unconverted and mark them as display-only.
- Do not infer diagnoses or clinical meaning from normalized values. Show source interpretation where present.

### WebLLM Grouping Tasks

- Create a browser-only grouping service that accepts normalized, minimized facts rather than raw full resources where possible.
- Group by resource type first:
  - medications
  - conditions
  - observations
- Defer cross-resource clinical grouping, such as diabetes combining A1c, glucose, metformin, and a diabetes condition, until single-resource grouping is stable.
- Run exact-source pre-clustering before WebLLM:
  - exact coding matches
  - exact source-label matches where codes are absent
  - medication ingredient plus route clusters when those facts are explicitly present or resolved from source FHIR resources
  - observation category plus exact observation coding clusters
- Do not hardcode clinical synonym or family maps in the deterministic path. Lab/vital synonym normalization, vaccine family names, condition-family names, and medication-friendly labels belong to WebLLM now and terminology services later.
- Prefer incremental WebLLM naming for compact records when prompt size is a risk: ask for one compact code/display/text concept at a time, then pass previously accepted friendly names as available responses for later records.
- Use structured JSON output with fields such as:
  - `groupId`
  - `patientFriendlyName`
  - `resourceIds`
  - `resourceTypes`
  - `reason`
  - `confidence`
  - `fallback`
- Use minimized input records. Example:

```json
{
  "resourceType": "Observation",
  "id": "cluster:Observation:abc123",
  "concept": {
    "text": ["Hemoglobin A1c/Hemoglobin.total in Blood"],
    "coding": [
      {
        "code": "4548-4",
        "display": "Hemoglobin A1c/Hemoglobin.total in Blood"
      }
    ]
  },
  "categoryCode": "laboratory",
  "resourceCount": 12
}
```

- Require WebLLM to return JSON only. Example output shape:

```json
{
  "groups": [
    {
      "groupId": "observation-hemoglobin-a1c",
      "patientFriendlyName": "Hemoglobin A1c",
      "resourceIds": ["obs-123", "obs-456"],
      "resourceTypes": ["Observation"],
      "confidence": 0.93,
      "reason": "Same compact source concept.",
      "fallback": false
    }
  ],
  "unassigned": []
}
```

- Group automatically, but keep source records visible and unchanged.
- Use stable exact-source pre-clustering before the model where possible, but keep that as a prompt-size optimization rather than patient-facing semantic grouping. Avoid hardcoded clinical aliases or synonym maps. Let terminology services or the local model handle true synonym normalization.
- When WebLLM is unavailable or a section fails refinement, show one card per source record instead of grouping records by shared code alone.
- Validate every WebLLM response before using it:
  - every `resourceId` must exist in the input batch
  - every group must contain at least one resource
  - group names must be short patient-facing navigation labels, not clinical advice
  - confidence must be numeric and bounded from 0 to 1
  - low-confidence or schema-invalid records fall back to `Other labs`, `Other conditions`, or `Other medications`
  - model output must not create new diagnoses, values, dates, statuses, or medication instructions
- Keep original source labels under every friendly group. Friendly names are navigation labels, not replacements for source clinical terms.
- Cache grouping outputs only inside encrypted local storage if persistence is needed. Do not write prompts or model outputs to console logs, analytics, service worker cache, or backend APIs.

### Initial Grouping Examples

Observation examples:

- `Hemoglobin A1c`, `HbA1c`, `4548-4` -> `Hemoglobin A1c`
- `76534-7: Systolic blood pressure by Noninvasive (e.g., automated cuff)` -> `Systolic Blood Pressure`
- `Diastolic blood pressure`, `8462-4` -> `Diastolic Blood Pressure`
- `25-hydroxyvitamin D`, `Vitamin D level` -> `Vitamin D`
- `Creatinine [Mass/volume] in Serum or Plasma` -> `Creatinine`
- `eGFR`, `Glomerular filtration rate/1.73 sq M.predicted` -> `Estimated Kidney Filtration`

Condition examples:

- `E11.65`, `Type 2 diabetes mellitus with hyperglycemia` -> `Type 2 Diabetes`
- `R73.03`, `Prediabetes` -> `Prediabetes`
- `Essential hypertension`, `High blood pressure` -> `Blood pressure`
- `Hyperlipidemia` -> `Cholesterol`
- `Asthma`, `COPD` -> `Breathing conditions`

Medication examples:

- `metformin` + `Oral tablet` -> `Metformin Tablet`
- `metformin` + `Extended release tablet` -> `Metformin Extended Release Tablet`
- `albuterol` + `Metered dose inhaler` -> `Albuterol Inhaler`
- `albuterol` + `Inhalation solution` -> `Albuterol Inhalation Solution`

### Patient Update Model

- Patients may add local, patient-authored overlay records for medications, vaccines, and conditions.
- Patients may mark local status overlays such as active, inactive, stopped, taken differently, not recognized, or hidden from local view.
- Patients may add notes/comments to explain their understanding.
- Patients may inactivate or hide an entire record in their local view without altering the source record.
- Patients must not edit provider-authored source facts such as codes, lab values, dates, medication dose text, diagnoses, or original FHIR JSON.
- Referral exports should clearly label provider-authored records separately from patient-authored overlays.

### Acceptance Criteria

- Patient can open mobile-first medication, condition, and observation views after SMART fetch.
- Related medications, conditions, and observations are automatically grouped under patient-friendly names.
- Observation values and units display consistently while preserving original source values.
- Repeated labs/vitals are grouped by specific measurement and show recent values over time.
- Large repeated resource sets are compacted before local model grouping and expanded back to original source resource IDs after validation.
- Referenced resources are resolved from the local index or fetched directly from the source FHIR server when allowed.
- Missing references, unsupported resources, and low-confidence groups degrade gracefully.
- WebLLM prompts and outputs stay browser-local and are excluded from logs, analytics, service worker cache, and fhir4px backend requests.
- Source FHIR JSON remains immutable.

---

## 13. Milestone 6: Patient Patch Layer

**Status:** Complete for MVP medication/allergy/condition corrections.

### Tasks

- Add local patch model.
- Add UI to mark medication status/comment, allergy correction, and condition note. **Complete.**
- Store patches encrypted in local vault. **Complete.**
- Render provider source and patient-reported patch side by side. **Complete.**
- Ensure patches never mutate source FHIR JSON. **Complete.**
- Reconcile existing patch/edit screens with the patient explorer update policy: status overlays, notes, hidden/inactive local-view flags, and patient-authored additions are allowed; direct editing of provider-authored facts is not.

### Acceptance Criteria

- Patient corrections are clearly labeled.
- Patch data is encrypted before persistence.
- Patches can be included/excluded during handoff.
- No patch data is sent to fhir4px backend.
- Provider-authored facts remain read-only in patient-facing edit flows.

---

## 14. Milestone 7: Referral Handoff MVP

**Status:** MVP export, QR, and import/decrypt workflows complete; sandbox validation remains.

Build handoff modes in this order:

1. Local encrypted FHIR Bundle
2. QR-contained summary
3. Direct source pull helper where source/receiver support exists

### Local Encrypted Bundle Tasks

- Build resource category selector. **Complete for resource type selection.**
- Build date-range filters for high-volume resources. **Complete.**
- Build local FHIR Bundle generator. **Complete.**
- Encrypt Bundle before save/share. **Complete with one-time export key.**
- Display decryption material separately. **Complete.**
- Add import/decrypt dev utility for testing. **Complete.**
- Add patient correction include/exclude control. **Complete.**

### QR Summary Tasks

- Build compact summary model. **Complete.**
- Add payload size estimator. **Complete.**
- Add QR generation. **Complete.**
- Auto-fallback to local encrypted Bundle when too large. **Complete.**

### Acceptance Criteria

- No handoff payload is posted to fhir4px backend.
- Plaintext Bundle is never persisted.
- QR summary is blocked or downgraded when too large.
- Patient can review included data before handoff.
- Encrypted Bundle can be saved locally and shared where Web Share file support exists.
- Decryption key is generated separately from the local vault key.
- Encrypted Bundle can be imported and decrypted locally for receiver workflow testing.

---

## 15. Milestone 8: PWA and Service Worker Hardening

**Status:** Cache policy, PWA build, production headers, WebLLM precache exclusion, and cache inspection tests complete; deployed-origin header verification remains.

### Tasks

- Configure app manifest.
- Add controlled service worker registration.
- Precache app shell and versioned assets only.
- Keep WebLLM/model-heavy chunks outside Workbox precache so the install path stays small and no AI prompts/outputs are cached by the service worker.
- Add network-only rules for FHIR/OAuth origins and callback routes.
- Add tests that inspect Cache Storage after callback flow. **Complete with mocked callback.**
- Add update prompt for new app versions.

### Acceptance Criteria

- App shell works after first load.
- FHIR/OAuth responses are absent from Cache Storage.
- Generated handoff artifacts are absent from Cache Storage.
- Service worker update flow is visible and recoverable.

---

## 16. Milestone 9: Automated Testing

**Status:** Foundation, authorize-flow, provider directory, callback, and cache-storage tests complete; live sandbox login remains manual.

### Unit Tests

- PKCE helper generation
- SMART discovery parsing
- OAuth state TTL and cleanup
- Token storage denial in plaintext localStorage
- Vault encryption/decryption
- FHIR Bundle pagination
- FHIR reference indexing and missing-reference fetch queue generation
- Observation value and unit normalization, including preservation of original values
- Resource filtering and normalization
- WebLLM grouping schema parsing and low-confidence fallback behavior
- Patch merge behavior
- QR payload size routing
- Public provider directory artifact search and distance sort
- Production security header policy

### Playwright Tests

- App shell loads.
- Mobile viewport patient explorer renders medication, condition, and observation groups without layout overlap.
- Provider search works.
- Epic sandbox launch request uses `http://localhost:3000`, normalized `aud`, and fhir4ds-compatible Epic scopes.
- Epic sandbox launch reaches the authorization page without Epic `error=4`.
- Cerner sandbox launch reaches authorization page.
- Callback route handles mocked token exchange.
- Cache Storage contains no FHIR/token payloads.
- `.env` test credentials are used only in Node-side test automation.

Full automated login to vendor sandboxes may be brittle due to external auth UI changes. Keep a manual test checklist even if Playwright covers most of the flow.

### Local SMART Dev Sandbox Harness

Use the SMART Dev Sandbox for rapid, local R4 testing before slower Epic/Cerner manual passes. The repository is archived, so treat it as a development harness rather than a production dependency.

Reference: `https://github.com/smart-on-fhir/smart-dev-sandbox`

Current local setup:

- Clone path: `build/test-harness/smart-dev-sandbox`
- R4 FHIR base: `http://localhost:4004/hapi-fhir-jpaserver/fhir`
- Home page: `http://localhost:4000`
- Launcher: `http://localhost:4013`
- Patient browser: `http://localhost:4012`
- FHIR viewer: `http://localhost:4011`
- R4 image is set to `smartonfhir/hapi-5:r4-empty`; the larger `r4-synthea` image was OOM-killed locally under the sandbox's 2 GB container limit.
- Load the synthetic patient-explorer case with `npm run sandbox:load-fixtures`.
- Generate a large repeated-resource patient with `npm run sandbox:generate-large-fixture`.
- Load the large patient with `npm run sandbox:load-large-fixture`.

Planned use:

- Run the Docker-based SMART Dev Sandbox locally with R4 enabled and unused FHIR versions disabled when possible to reduce memory use.
- Use the repository synthetic fixture for fast smoke testing:
  - medication references such as `MedicationRequest.medicationReference -> Medication`
  - condition references from encounters
  - observations with mixed `value[x]` shapes
  - UCUM and non-UCUM units
  - active/inactive/resolved statuses
  - common chronic-disease clusters for grouping tests
- Add more custom synthetic patients as edge cases are found.
- Use `tests/fixtures/fhir/large-patient-r4.json` to exercise large-patient grouping behavior: 453 total resources, including 425 observations with repeated labs/vitals, missing codes, OID-prefixed systems, and source-label variation.
- Register or configure the local app redirect against `http://localhost:3000` where the sandbox launcher supports it.
- Use this harness to validate SMART launch, direct browser FHIR fetch, reference resolution, observation normalization, and WebLLM grouping without waiting on Epic/Cerner portals.

Limitations:

- The sandbox is not a substitute for Epic/Cerner validation.
- It is not clinical infrastructure and must not be used with real patient data.
- It does not prove real-world vendor quirks, portal UX, consent behavior, or production endpoint compatibility.

---

## 17. Milestone 10: Manual Sandbox Validation

**Status:** Manual checklist ready; external login/consent validation remains.

Current Epic status: authorize request validation is unblocked when mimicking the older `fhir4ds` redirect shape. Live probes show Epic accepts the configured non-production client ID with `redirect_uri=http://localhost:3000`, no trailing slash, fhir4ds-compatible scopes, normalized R4 `aud`, and valid PKCE. Epic rejects the HTTPS variant for the same client ID.

Using `.env` credentials, validate:

- SMART Dev Sandbox R4 local launch/fetch flow with synthetic patients
- Epic sandbox standalone launch
- Cerner sandbox standalone launch
- Successful callback and token exchange
- Patient ID extraction
- Resource fetch for MVP resource set
- Disconnect and re-auth
- Local encrypted Bundle generation
- QR summary generation
- No PHI/token data in:
  - fhir4px backend requests
  - localStorage
  - service worker Cache Storage
  - console logs
  - test output

Do not record videos or screenshots that show credentials, tokens, patient records, or generated handoff payloads.

---

## 18. Backend/API Implementation

**Status:** Static public JSON directory artifact is implemented for MVP; no patient-data backend is planned.

Backend work should stay limited until the browser app is stable.

### MVP Backend

- Static hosting for PWA
- Public provider directory API, or static JSON served as public metadata
- No patient accounts
- No OAuth callback
- No FHIR proxy
- No referral relay
- No vault backup

### Later Backend

- Public endpoint crawler
- Endpoint freshness checks
- Opt-in endpoint-only confirmations
- Community endpoint flags
- Directory moderation tools

---

## 19. Definition of Done for MVP

The MVP is done when:

- Epic and Cerner sandbox flows can be tested with local `.env` configuration.
- OAuth completes without fhir4px backend involvement.
- Tokens are not persisted in plaintext storage.
- FHIR data is fetched directly from source EHR into browser.
- Patient can view core medications, conditions, and observations in a patient-friendly mobile explorer.
- Patient-friendly grouping runs locally in the browser and does not send prompts, model outputs, or FHIR payloads to fhir4px servers.
- Referenced resources needed for display are resolved locally or fetched directly from the source FHIR server when scopes allow.
- Observation values and units are normalized for display/sort/trend use while preserving original source values.
- Patient can create at least one local encrypted Bundle handoff.
- Service worker caches no PHI/token material.
- Manual validation confirms no patient-data server path.
- Architecture acceptance criteria in `architecture.md` are satisfied.

---

## 20. Immediate Next Steps

1. Run the SMART Dev Sandbox launcher flow manually against `http://localhost:3000` using the loaded synthetic patient and verify `/records` after callback.
2. Run the manual checklist in `manual-sandbox-validation.md` for Epic from `http://localhost:3000`.
3. Run the manual checklist in `manual-sandbox-validation.md` for Cerner from `http://localhost:3000`.
4. Measure WebLLM load time, memory, structured-output reliability, and WebGPU availability on target mobile devices; decide whether a smaller fallback model is required.
5. Add patient-explorer quality review cases for grouping labels, Observation unit display, hidden/inactive overlays, and patient-authored records.
6. Add terminology-server `$translate` or coding enrichment only after local grouping quality gaps are clear.
7. Add cross-resource grouping and richer trend/timeline views after single-resource grouping is stable.
8. If a future Epic app registration must use HTTPS, create/update a separate Epic client ID whose redirect URI is exactly `https://localhost:3000` with no trailing slash.
9. Continue provider-directory QA in parallel, but keep real endpoint launch disabled until public-evidence review is complete.
10. Verify production CSP/security headers on the deployed hosting platform.
11. Run cross-browser WebAuthn PRF registration/unlock testing.

---

## 21. Related Documents

- `architecture.md` - system architecture and acceptance criteria
- `security-model.md` - security and storage rules
- `threat-model.md` - attacker scenarios and security tests
- `fhir-scope.md` - FHIR resources and scopes
- `handoff-modes.md` - referral handoff design
- `provider-directory.md` (moved to fhir4px-directory repo) - endpoint directory plan
- `security-review.md` - engineering security review and pre-real-data go/no-go
- `manual-sandbox-validation.md` - Epic/Cerner manual sandbox checklist
