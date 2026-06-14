# Security Review

**Status:** MVP pre-production review  
**Date:** May 25, 2026  
**Scope:** Browser-only SMART/PWA implementation and provider directory metadata pipeline

---

## 1. Review Result

The current implementation satisfies the core zero-server design constraint for MVP testing:

- No OAuth callback is handled by fhir4px backend services.
- No FHIR request is proxied through fhir4px backend services.
- No patient records, tokens, patches, referral payloads, encrypted Bundles, or decryption material are posted to fhir4px infrastructure.
- Provider directory search uses public metadata only.

This is not a production HIPAA/legal signoff. It is an engineering review of the current repository state.

---

## 2. Implemented Controls

### SMART OAuth

- Authorization Code with PKCE.
- Transient `state` and PKCE verifier with TTL.
- Root-route callback support for the registered `http://localhost:3000` sandbox redirect.
- Browser-side token exchange directly against the source EHR token endpoint.
- Callback URL cleanup after successful handling.
- Refresh tokens are not retained for MVP.

### Local Storage

- SMART token/session records are written through the encrypted Dexie vault.
- Patient patches are encrypted before persistence.
- Plaintext token persistence in `localStorage` is not used.
- WebAuthn PRF profile storage contains only non-PHI credential metadata.
- Session-only vault fallback remains available when PRF is unavailable.

### FHIR Data Handling

- FHIR reads use the source FHIR base URL directly.
- Requests use `cache: "no-store"`.
- FHIR fetch tolerates unsupported non-auth resource failures.
- Referral summaries are held in browser state only.
- Patient patches do not mutate source FHIR resources.

### Handoff

- Local encrypted Bundle export uses a one-time export key.
- Decryption key is displayed separately from the encrypted file.
- QR generation uses payload-size gating.
- Encrypted Bundle import/decrypt utility runs locally in the browser.

### PWA / Browser Hardening

- Service worker registration is disabled and caches are cleared during development.
- Production Workbox runtime caching is limited to public directory artifacts.
- FHIR/OAuth/cache bypass helpers are covered by unit tests.
- Production static headers include CSP, no-referrer, no-sniff, and restrictive permissions policy.

### Provider Directory

- Directory artifacts contain public provider/endpoint metadata only.
- Endpoint validation crawler uses public SMART configuration and CapabilityStatement metadata only.
- Assisted-review packets contain public provider/endpoint facts only.
- Real endpoint launch is disabled until a client registration is configured.

---

## 3. Verification

Automated verification currently covers:

- SMART auth, PKCE, callback, and refresh-token non-retention.
- Vault encryption and typed record listing.
- FHIR pagination and direct source reads.
- Observation/lab normalization.
- Handoff encryption and QR payload sizing.
- Public directory search, ZIP-derived distance origin, and launch-disabled real endpoint results.
- Cache policy and production security headers.
- Playwright app shell, Epic authorize URL shape, provider artifact search, callback handling, and Cache Storage token/PHI absence.

Manual validation still required before real patient data:

- Epic full login and callback with sandbox credentials.
- Cerner full login and callback with sandbox credentials.
- Source FHIR fetch from both sandboxes.
- Local encrypted Bundle generation from sandbox data.
- Patient patch include/exclude behavior from sandbox data.
- Browser storage and network inspection during full sandbox flows.

---

## 4. Residual Risks

| Risk | Status | Required Follow-Up |
|---|---|---|
| Active XSS can read in-memory PHI | Not eliminated | CSP deployment, dependency review, no third-party scripts |
| MUI/Emotion currently needs inline styles | Accepted for MVP | Move to nonce-compatible styling before production if deployment CSP requires it |
| WebAuthn PRF support varies by browser/device | Partially mitigated | Complete cross-browser registration/unlock testing |
| Real endpoint directory mappings may be wrong | Not eliminated | Manual QA and assisted-review validation before enabling real endpoint launch |
| Full sandbox login automation may be brittle | Accepted | Maintain manual validation checklist |
| Service worker production behavior needs deployed-origin validation | Pending | Run cache inspection against production preview build |

---

## 5. Go/No-Go

MVP sandbox testing can continue.

Do not use real patient data until:

1. Epic and Cerner sandbox flows are manually validated end to end.
2. Cache Storage, IndexedDB, localStorage, network requests, and console output are inspected during those flows.
3. WebAuthn PRF behavior is tested on target browsers or the product explicitly accepts session-only mode.
4. Provider directory endpoint mappings intended for launch have passed manual QA.
5. Production CSP/security headers are verified on the deployed hosting platform.
