# fhir4px Architecture

**Status:** Draft architecture baseline  
**Date:** May 24, 2026  
**Scope:** Browser-only SMART orchestration, zero fhir4px server-side patient-data custody

---

## 1. Architectural Rule

fhir4px is a patient-side SMART on FHIR application. The browser may process patient health information with the patient's authorization, but fhir4px servers must never receive patient records, tokens, patches, manifests, encrypted bundles, or referral payloads.

In this document, **zero custody** means **zero fhir4px server-side data custody**.

The backend can host static application assets and public provider endpoint metadata. It is not part of the health-data path.

### Forbidden Server Data

fhir4px backend services must not receive, store, relay, cache, log, or analyze:

- FHIR resources or FHIR Bundles
- SMART access tokens, refresh tokens, authorization codes, or credentials
- Patient-authored patch data
- SMART Health Link manifests containing patient data
- JWE/JWS payloads derived from patient records
- Local vault backups
- Patient-provider relationship history
- Referral payloads or generated referral bundles
- Analytics events containing PHI, provider relationship history, or clinical content

### Allowed Server Data

The backend may store:

- Static PWA assets
- Public provider directory records
- Public FHIR endpoint metadata
- Public SMART configuration metadata
- Opt-in endpoint validation signals stripped of patient identity and clinical content
- Aggregate operational metrics that cannot reconstruct patient-provider relationships

---

## 2. System Components

### Browser PWA

The browser PWA is the core application. It handles:

- Provider search
- SMART App Launch
- OAuth redirect handling
- Token encryption and local vault storage
- FHIR reads from source EHRs
- Local normalization and display
- Patient patch layer
- Referral handoff generation
- Local encrypted export

### Source EHR / FHIR Server

The source EHR is the system of record. The patient authenticates directly with this system through SMART App Launch. fhir4px does not see credentials.

### Receiving Provider / EHR

The receiving provider receives a referral handoff through one of the browser-only modes:

- Direct source pull
- QR-contained summary
- Local encrypted FHIR Bundle

### Provider Directory Backend

The backend exposes public endpoint metadata. It supports search and endpoint validation, but it does not store patient-specific connection history.

### Static Hosting / CDN

The PWA can be hosted as static assets. Hosting must not add server-side rendering, server actions, API routes that touch PHI, or backend OAuth token handling.

---

## 3. Trust Boundaries

```
+--------------------------------+
| Patient Device / Browser PWA   |
| - SMART launch                 |
| - Local vault                  |
| - FHIR reads                   |
| - Patch layer                  |
| - Referral handoff             |
+---------------+----------------+
                |
                | SMART OAuth + FHIR API
                v
+--------------------------------+
| Source EHR / FHIR Server       |
| - Authentication               |
| - Token endpoint               |
| - Patient records              |
+---------------+----------------+
                |
                | Patient-mediated handoff
                v
+--------------------------------+
| Receiving Provider / EHR       |
| - Source pull                  |
| - QR summary import            |
| - Local bundle import          |
+--------------------------------+

+--------------------------------+
| fhir4px Backend                |
| - Static app hosting           |
| - Public endpoint directory    |
| - Opt-in endpoint validation   |
| Not in the PHI path            |
+--------------------------------+
```

The critical boundary is between the browser and fhir4px backend. Patient data may cross from source EHR to browser, and from browser to receiving provider. It must not cross from browser to fhir4px backend.

---

## 4. Data Classification

| Class | Examples | Storage Rule | Server Rule |
|---|---|---|---|
| Public metadata | Provider name, NPI, address, public FHIR base URL, SMART configuration URL | Backend allowed | Backend allowed |
| Local sensitive auth | SMART access tokens, refresh tokens, launch context | Encrypted local vault only | Forbidden |
| Local PHI | FHIR resources, referral drafts, patches, generated summaries | Memory or encrypted local vault only | Forbidden |
| Handoff artifacts | QR payload, encrypted Bundle file, source-pull instruction | Browser/device only | Forbidden unless source/receiver hosts it |
| Operational telemetry | Build version, app crash without payload, feature timing | Aggregate only | Allowed only if PHI-free |

---

## 5. Frontend / PWA Stack

### Chosen Stack

- **Runtime:** Browser-only SPA/PWA
- **Language:** TypeScript
- **Build tool:** Vite
- **UI framework:** React
- **UI components:** MUI Material
- **Routing:** React Router in SPA mode
- **Local database:** Dexie over IndexedDB
- **Crypto:** Web Crypto API directly
- **Authenticator-backed keys:** WebAuthn PRF where supported
- **SMART client:** Internal browser SMART module adapted from `fhir4ds/web/wasm-demo/src/lib/smart-auth.ts`, `smart-config.ts`, and `smart-data.ts`
- **PWA/service worker:** `vite-plugin-pwa` / Workbox in controlled mode
- **Icons:** `lucide-react` used inside MUI controls

### UI Decision: MUI Material

fhir4px is a workflow-heavy patient utility. The UI needs predictable forms, dialogs, drawers, alerts, lists, progress states, steppers, tabs, and mobile navigation more than a bespoke visual system. MUI provides these controls with a mature theming model.

Constraints:

- Use MUI Core as the primary component system.
- Use a custom fhir4px theme so the app does not look like default Material Design.
- Use `lucide-react` for icons instead of `@mui/icons-material` to avoid unnecessary icon bundle weight.
- Prefer MUI `sx`, theme tokens, and component overrides over mixing in Tailwind.
- Avoid UI components that depend on server rendering.
- Ensure dialogs, drawers, menus, steppers, and form controls have explicit accessible labels.

### Styling and CSP

The app should use a strict Content Security Policy. Because MUI uses Emotion for style injection, the implementation must either:

- Configure Emotion with a CSP nonce, or
- Use a CSP-compatible styling approach agreed before implementation.

The app must not allow arbitrary third-party scripts on PHI-handling routes.

---

## 6. SMART Module Strategy

The default SMART implementation should be a small internal TypeScript module, promoted from the existing `fhir4ds` browser implementation rather than adopting a general-purpose SMART client library as the primary runtime dependency.

Useful source behavior from `fhir4ds`:

- SMART endpoint discovery through `.well-known/smart-configuration`
- CapabilityStatement `/metadata` fallback for OAuth endpoint discovery
- Browser-only PKCE verifier/challenge generation
- Direct browser token exchange against the source EHR token endpoint
- Callback cleanup with URL replacement
- Popup callback support with `postMessage` and `BroadcastChannel`
- Epic `Epic-Client-ID` request header support
- Bundle pagination through `link[relation=next]`
- Partial resource failure handling for unsupported resource types

Required hardening before reuse:

- Rename storage keys from `fhir4ds_*` to `fhir4px_*`.
- Do not persist access tokens, refresh tokens, callback results, or session metadata in plaintext `localStorage`.
- Store persistent token material only through the encrypted local vault.
- Keep PKCE `code_verifier` and OAuth `state` short-lived, single-use, and aggressively cleaned up.
- Add TTL checks to transient auth state.
- Avoid console logging redirect URIs, token exchange details, patient IDs, scopes, or endpoint-specific failures that can reveal patient-provider relationships.
- Make popup callback messages token-free when possible; if tokens must cross windows, persist them immediately into the encrypted vault and clear transient channels.
- Replace hard-coded sandbox defaults with directory-driven provider metadata for production.
- Expand resource scope beyond the demo set according to `fhir-scope.md`.

`fhirclient` remains useful as a reference implementation and compatibility test target, but it is not the default architecture because fhir4px needs explicit control over token persistence, service worker behavior, and the zero-server data boundary.

---

## 7. PWA and Service Worker Rules

The service worker exists to make the app shell reliable, not to cache patient records.

### May Cache

- HTML app shell
- Versioned JS/CSS assets
- Local icons and manifest assets
- Static fonts if self-hosted
- Public provider-directory metadata, subject to cache expiration

### Must Not Cache

- FHIR API responses
- SMART authorization responses
- OAuth tokens
- Refresh tokens
- Patient patches
- Referral summaries
- Generated QR payloads
- Encrypted FHIR Bundles
- Local vault contents

### Implementation Rule

Use explicit cache allowlists. Do not use broad runtime caching rules such as "cache all GET requests." FHIR and OAuth origins must be network-only and no-store from the service worker's perspective.

---

## 8. SMART App Launch Flow

### Standalone Patient Launch

```
1. Patient selects a provider endpoint from the directory.
2. Browser fetches public SMART configuration from the provider.
3. Browser starts SMART authorization using PKCE.
4. Patient authenticates directly with the provider.
5. Provider redirects back to the PWA redirect URI.
6. Browser exchanges authorization code for tokens directly with provider token endpoint.
7. Tokens are encrypted locally before persistent storage.
8. Browser uses tokens to read scoped FHIR resources from the source EHR.
```

### Token Handling

- fhir4px is a public client; no client secret is embedded in the app.
- Authorization uses PKCE.
- Authorization codes and tokens never touch fhir4px backend services.
- Token persistence is disabled until the local encryption key is available.
- Plaintext `localStorage` token persistence is forbidden.
- Transient OAuth state in web storage must be short-lived, single-use, and PHI-free.
- Refresh tokens require explicit product approval and must be encrypted locally.
- If local storage is wiped, the patient re-authenticates with the source provider.

### Scopes

Request only the minimum scopes needed for the current workflow. Do not request broad clinical scopes just because the application may need them later.

Vendor launch scopes and redirect URI matching are not interchangeable. For the Epic public sandbox client used by the earlier `fhir4ds` demo, Epic accepts the exact local redirect URI `http://localhost:3000` with no trailing slash and rejects the HTTPS variant. The Epic sandbox launch also omits `launch/patient` while still requesting the patient read scopes configured in the old demo. Cerner sandbox launches continue to use `launch/patient` plus patient read scopes.

---

## 9. Local Vault

The local vault stores encrypted patient-side state in IndexedDB through Dexie.

### Contents

The vault may contain encrypted:

- Provider connection metadata selected by the patient
- SMART token material
- Patient patch layer
- Referral drafts
- Recent local handoff state

The vault must not contain plaintext clinical resources at rest.

### Key Management

Preferred path:

```
WebAuthn Passkey -> PRF output -> Web Crypto key material -> local vault encryption key
```

Fallback path is an open decision. Acceptable fallback candidates:

- Session-only tokens with no persistent vault
- Patient-entered passphrase for local export/import
- Native wrapper later for stronger platform keychain access

### Wipe Behavior

If IndexedDB is cleared, device storage is wiped, or PRF is unavailable:

- The app remains usable.
- The patient re-authenticates to source providers.
- The local patch layer is gone unless the patient imported a local encrypted backup.
- No server recovery path exists because no server vault exists.

---

## 10. FHIR Data Handling

### Fetching

FHIR reads happen from the browser directly to the source FHIR server. The source server must support browser access and CORS for the required SMART workflow.

### Normalization

FHIR resources can be normalized in memory for display and handoff generation. Normalized views are derived data and inherit the same restrictions as raw FHIR resources.

### MVP Resource Set

Initial architecture should support:

- `Patient`
- `MedicationRequest`
- `MedicationStatement` where available
- `AllergyIntolerance`
- `Condition`
- `Observation`
- `DiagnosticReport`
- `DocumentReference`
- `Encounter`
- `Procedure`
- `Immunization`

Exact MVP scopes belong in `fhir-scope.md`.

---

## 11. Patient Patch Layer

Patient edits never overwrite provider-sourced records. The app renders a client-side merge:

```
Provider FHIR resources + Patient patch layer -> Local aggregate view
```

Rules:

- Provider resources remain read-only.
- Patient patches are stored separately.
- Patches are encrypted locally.
- Patches are clearly labeled as patient-reported.
- Referral handoffs include patches only when the patient explicitly chooses to include them.
- Patch data is never synced through fhir4px backend services.

---

## 12. Referral Handoff Modes

The zero-server architecture supports three handoff modes.

### Mode A: Direct Source Pull

The receiver pulls records from the source EHR after patient authorization or through a source-hosted sharing mechanism.

Best for:

- Systems that support SMART Health Links or equivalent source-hosted exchange
- Larger record sets
- Higher fidelity clinical transfer

Limitations:

- Requires receiving system support
- Requires source EHR support
- May require app registration and workflow alignment per EHR tenant

### Mode B: QR-Contained Summary

The browser creates a compact encrypted referral summary and places it directly in a QR/deep-link artifact or adjacent local handoff material.

Best for:

- Medication, allergy, problem, and referral-context summary
- Front-desk or intake workflows
- Small payloads

Limitations:

- QR size limits constrain the payload
- Large clinical histories do not fit
- May not be a fully interoperable SMART Health Link unless the receiver supports this exact payload format

### Mode C: Local Encrypted FHIR Bundle

The browser creates an encrypted FHIR Bundle file on the patient device. The patient gives it to the clinic through a local channel.

Best for:

- Larger exports
- MVP reliability
- Clinics that can upload/import files

Limitations:

- Less seamless than scan-only transfer
- Requires a receiving workflow for file intake
- Decryption material must be shared patient-to-clinic without fhir4px servers

---

## 13. Provider Directory Backend

The provider directory is a public metadata service.

### Responsibilities

- Search providers by name, location, specialty, organization, and endpoint availability
- Store NPI and organization metadata
- Store public FHIR base URLs
- Store public SMART configuration observations
- Track endpoint freshness and validation status
- Accept opt-in endpoint-only confirmations

### Non-Responsibilities

The directory must not:

- Store patient accounts for MVP
- Store which providers a patient connected to
- Store patient search history tied to an identity
- Store SMART launch outcomes tied to a patient
- Store clinical data
- Proxy FHIR API calls

### Logging Rules

- Do not persist raw provider search logs tied to IP or device identifiers longer than operationally necessary.
- Do not log query strings that may imply patient-provider relationships unless redacted or aggregated.
- Do not include PHI in client-side analytics.
- Endpoint confirmations must be endpoint-only, opt-in, and unlinkable to patient records.

---

## 14. Security Controls

### Browser Security

- Strict CSP with no arbitrary third-party scripts
- Trusted Types where practical
- No inline script except approved nonced bootstrap if required
- Dependency pinning and lockfile review
- No PHI in URL query strings
- No PHI in logs, analytics, errors, or crash reports
- No persistent plaintext PHI

### OAuth Security

- PKCE required
- State and nonce validation required
- Redirect URI allowlist required
- No client secret in browser
- Token endpoint calls go directly from browser to source EHR
- Token storage must be encrypted before persistence

### Local Vault Security

- Encrypt before write
- Use AES-GCM or another approved authenticated encryption mode through Web Crypto
- Bind vault records to origin and app version metadata where useful
- Provide a visible "clear local data" control
- Avoid global stores that keep PHI longer than needed

### Service Worker Security

- Explicit cache allowlist
- Network-only handling for FHIR and OAuth requests
- Clear update UX for new app versions
- No background sync of patient payloads

---

## 15. Failure Modes

| Failure | Expected Behavior |
|---|---|
| Source EHR does not support CORS/browser SMART access | Show provider-specific connection failure and suggest local export alternatives |
| SMART registration unavailable | Mark endpoint as known but not connectable for current app registration |
| Token expires | Prompt patient to re-authenticate with source provider |
| IndexedDB cleared | Rebuild local vault through provider re-auth; patches require local import or recreation |
| WebAuthn PRF unsupported | Fall back to session-only or passphrase-backed local export/import, depending on product decision |
| Patient phone goes offline before handoff | Direct source pull may still work if source/receiver supports it; QR summary/local file require device availability |
| QR payload too large | Switch to local encrypted Bundle file |
| Receiving clinic cannot import file | Provide human-readable summary view or direct source-pull workflow if available |
| Backend compromise | Attacker can access public directory data only; no records, tokens, patches, or payloads exist server-side |
| XSS in browser app | Highest-risk client threat; mitigated through CSP, dependency control, minimized PHI lifetime, and encrypted local storage |

---

## 16. Deployment Model

### MVP Deployment

- Static PWA hosted on CDN or static hosting
- Provider directory API hosted separately
- Directory API returns only public metadata
- No backend session for patient identity
- No backend OAuth callback
- No backend FHIR proxy
- No backend referral relay

### Environment Separation

- Development SMART sandbox
- Staging directory API with synthetic provider data
- Production directory API with public endpoint metadata

No environment may receive real patient payloads through fhir4px backend services.

---

## 17. Architecture Acceptance Criteria

The implementation satisfies this architecture only if:

- A patient can connect to a source EHR without fhir4px backend receiving OAuth tokens.
- FHIR reads go browser-to-source, not browser-to-fhir4px-to-source.
- Referral handoffs do not post records or encrypted bundles to fhir4px servers.
- Service worker caches no FHIR responses or patient artifacts.
- Local persisted patient state is encrypted before writing to IndexedDB.
- A backend breach cannot expose patient records, tokens, patches, or referral payloads because they were never sent there.
- Provider directory usage cannot reconstruct a patient's provider relationship graph.

---

## 18. Open Decisions

1. **Vault fallback:** Decide behavior when WebAuthn PRF is unavailable.
2. **First handoff mode:** Choose MVP priority between local encrypted Bundle and QR-contained summary.
3. **Bundle encryption format:** Define exact file format, metadata, key derivation, and decryption UX.
4. **MUI theme:** Define fhir4px theme tokens, typography, density, and dark/light behavior.
5. **Directory API platform:** Choose the public metadata backend implementation.
6. **FHIR MVP scope:** Finalize resources, scopes, and display normalization rules.
7. **Endpoint validation:** Define opt-in validation payload shape and anti-linkage safeguards.

---

## 19. Related Documents

- `fhir-phr-concept.md` - product concept and business framing
- `branding.md` - brand language and product vocabulary
- `implementation-plan.md` - phased build plan and sandbox validation path
- `handoff-modes.md` - detailed handoff design
- `security-model.md` - authentication, local vault, PWA, and logging controls
- `threat-model.md` - attacker scenarios and mitigations
- `fhir-scope.md` - MVP resource and SMART scope specification
- `provider-directory.md` (moved to fhir4px-directory repo) - directory schema and governance
