# Security Model

**Status:** Draft  
**Date:** May 24, 2026  
**Scope:** Browser-only patient data handling for fhir4px

---

## 1. Security Goal

fhir4px should let a patient discover, connect, view, correct, and hand off records without fhir4px servers receiving patient health data.

The primary security property is:

> A compromise of fhir4px backend infrastructure cannot expose patient records, SMART tokens, patient patches, referral payloads, or local vault backups because those artifacts are never sent to fhir4px servers.

This is a technical architecture goal, not a legal conclusion about HIPAA or other regulatory obligations.

---

## 2. Security Boundary

### Inside the Sensitive Boundary

- Patient browser memory
- Browser local vault
- Source EHR/FHIR server
- Receiving provider system
- Patient-controlled export files
- Patient-controlled QR/deep-link artifacts

### Outside the Sensitive Boundary

- fhir4px static hosting
- fhir4px provider directory API
- CDN hosting public assets
- Public endpoint metadata

### Forbidden Server-Side Material

- FHIR resources
- Access tokens
- Refresh tokens
- Authorization codes
- Patient patches
- Referral summaries
- Encrypted Bundles
- JWE/JWS payloads derived from patient records
- SHL manifests containing patient data
- Patient-provider relationship history

---

## 3. SMART OAuth Security

fhir4px is a public browser client.

Requirements:

- Use Authorization Code with PKCE.
- Use high-entropy `state` values.
- Validate returned `state` before token exchange.
- Use provider-discovered authorization and token endpoints.
- Require exact registered redirect URIs.
- Never use or embed a client secret.
- Exchange authorization code directly from browser to source EHR token endpoint.
- Never proxy the token exchange through fhir4px backend.
- Remove `code` and `state` from the URL after callback handling.

### Internal SMART Module

The SMART module should be adapted from the working `fhir4ds` implementation:

- `smart-auth.ts` for discovery, PKCE, callback, and popup flow
- `smart-config.ts` for provider metadata and scopes
- `smart-data.ts` for FHIR fetch, Epic header support, and pagination

Before reuse, the module must remove all plaintext token persistence. The `fhir4ds` implementation stores token and callback payloads in localStorage; fhir4px must not.

### Transient OAuth State

PKCE `code_verifier` and OAuth `state` are sensitive but short-lived. Storage rules:

- Prefer in-memory/session-scoped storage when the browser flow permits it.
- If web storage is required for redirect or popup continuity, store only transient auth state.
- Add a short TTL.
- Use single-use cleanup after callback.
- Do not store patient records or tokens in transient auth state.
- Do not write token responses to localStorage.
- Do not retain refresh tokens for MVP. Re-authenticate through the source EHR when access expires.

---

## 4. Local Vault

The local vault is the only persistent patient-side storage location.

### Storage Backend

- Dexie over IndexedDB
- Encrypted before write
- No plaintext PHI at rest
- No server backup
- No cloud sync by fhir4px

### Vault Contents

Allowed if encrypted:

- SMART token material
- Source endpoint connection metadata selected by the patient
- Patient patch layer
- Referral drafts
- Local export metadata

Not allowed:

- Plaintext FHIR resources
- Plaintext tokens
- Plaintext patch content
- Plaintext referral summaries
- Any server-synced patient vault copy

### Key Path

Preferred path:

```
WebAuthn Passkey -> PRF output -> Web Crypto key material -> vault encryption key
```

Fallback behavior is an open product decision. Acceptable options:

- Session-only mode
- Patient passphrase for local export/import
- Native wrapper later for stronger platform keychain access

### Encryption Requirements

- Use Web Crypto directly.
- Use authenticated encryption, such as AES-GCM.
- Generate a unique nonce/IV per encryption operation.
- Never reuse IVs with the same key.
- Include versioned associated data where useful.
- Store enough metadata to rotate formats later.
- Keep raw key material out of React state and logs.

---

## 5. FHIR Data Handling

FHIR data can exist in:

- Source EHR responses
- Browser memory
- Encrypted local vault entries
- Patient-controlled encrypted exports
- Receiving provider systems

FHIR data must not exist in:

- fhir4px backend requests
- fhir4px backend logs
- fhir4px server-side analytics
- Service worker caches
- Plaintext IndexedDB entries
- URL query strings
- Error reports

### In-Memory Handling

- Keep PHI in narrowly scoped data structures.
- Clear referral drafts when the user exits or completes a flow.
- Avoid global app stores for full FHIR resources unless strictly required.
- Prefer derived display models with minimum necessary fields.

---

## 6. Service Worker Rules

The service worker is an app-shell reliability tool, not a patient-data cache.

Network-only:

- FHIR base URLs
- SMART authorization endpoints
- Token endpoints
- Any URL containing OAuth callback parameters
- Any local handoff artifact route

Cache allowed:

- Versioned JS/CSS
- App shell
- Icons
- Manifest assets
- Public directory metadata with strict expiration

Cache forbidden:

- FHIR responses
- Tokens
- Patient patches
- Referral summaries
- QR payloads
- Export files
- Vault entries

Implementation must use explicit allowlists. Broad runtime caching is forbidden.

---

## 7. Browser Security Controls

### CSP

Use a strict Content Security Policy:

- Restrict `script-src` to self and approved build assets.
- Avoid arbitrary third-party scripts.
- Configure Emotion/MUI styling with nonce support or another CSP-compatible approach.
- Restrict `connect-src` to provider directory, selected FHIR endpoints, and OAuth endpoints.
- Disallow framing except where an EHR launch workflow explicitly requires it.

Current deployable headers live in `public/_headers`. The MVP CSP allows inline styles for MUI/Emotion compatibility but does not allow `unsafe-eval`.

### XSS Reduction

- No unsanitized HTML rendering.
- No user-controlled Markdown rendering in PHI views.
- No `dangerouslySetInnerHTML` for clinical content.
- Pin dependencies.
- Review transitive dependencies that run on PHI-handling routes.
- Avoid analytics scripts on PHI-handling routes.

### URL Hygiene

- No PHI in query strings.
- Remove OAuth callback parameters after handling.
- Avoid patient identifiers in route paths.
- Do not put decryption keys in URLs unless the handoff format requires it and the URL is never sent to fhir4px servers.

---

## 8. Logging and Telemetry

Allowed:

- Build version
- Feature usage counts without patient/provider linkage
- Non-PHI error categories
- Aggregate performance metrics

Forbidden:

- FHIR payloads
- Patient IDs
- Token values
- Scopes tied to a patient session
- Provider connection history tied to a device or identity
- Search logs that reconstruct patient-provider relationships
- QR or export payload content

Client errors must be scrubbed before reporting. When in doubt, do not send the event.

---

## 9. User Controls

The app must provide:

- Clear local data wipe
- Per-provider disconnect
- Token refresh/re-auth flow
- Visible included-data review before handoff
- Patch inclusion toggle before referral export
- Export deletion guidance
- Explanation that server recovery is unavailable by design

---

## 10. Security Acceptance Criteria

The implementation passes this model only if:

- Tokens are never stored in plaintext localStorage.
- FHIR data is never cached by the service worker.
- fhir4px backend logs cannot reconstruct patient-provider relationships.
- A server breach exposes only public directory metadata and non-sensitive operational data.
- Local persisted patient state is encrypted before writing to IndexedDB.
- OAuth state has TTL and single-use cleanup.
- PHI-handling routes run without arbitrary third-party scripts.

---

## 11. Open Decisions

1. Define WebAuthn PRF fallback behavior.
2. Define local vault envelope format.
3. Define key rotation and vault migration strategy.
4. Decide whether refresh tokens are allowed in MVP.
5. Decide if a native wrapper is needed for stronger platform keychain behavior.
6. Decide client-side telemetry vendor or no telemetry for MVP.

---

## 12. Related Documents

- `architecture.md` - system architecture and zero-server boundary
- `threat-model.md` - attacker scenarios and mitigations
- `handoff-modes.md` - referral handoff modes
- `fhir-scope.md` - FHIR resources and scopes
