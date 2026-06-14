# Threat Model

**Status:** Draft  
**Date:** May 24, 2026  
**Scope:** fhir4px browser-only SMART/PWA architecture

---

## 1. Assets

Primary assets:

- Patient FHIR records
- SMART access tokens and refresh tokens
- OAuth authorization codes and PKCE verifier
- Patient-authored patches
- Referral summaries
- Local encrypted Bundle exports
- Decryption material
- Patient-provider relationship graph

Secondary assets:

- Provider directory integrity
- Endpoint validation history
- Application code integrity
- Build and deployment pipeline
- Public SMART client registration metadata

---

## 2. Trust Assumptions

The architecture assumes:

- Source EHRs correctly authenticate the patient.
- Source EHRs enforce SMART scopes.
- Browser Web Crypto behaves correctly.
- The fhir4px origin is served over HTTPS.
- The PWA code loaded by the patient is authentic.
- The receiving provider handles imported records according to its own security obligations.

The architecture does not assume:

- fhir4px backend is trusted with patient records.
- fhir4px backend is trusted with encrypted patient payloads.
- Browser storage is permanent.
- WebAuthn PRF exists on every device.
- Receiving clinics can always parse structured artifacts.
- EHR vendors behave identically.

---

## 3. Threat Summary

| Threat | Severity | Primary Mitigation |
|---|---|---|
| fhir4px backend compromise | High | Backend stores no patient data, tokens, patches, or payloads |
| XSS in PWA | Critical | Strict CSP, dependency control, no arbitrary scripts, minimized PHI lifetime |
| Token theft from browser storage | Critical | Encrypt token material before persistence; no plaintext localStorage |
| Service worker caches PHI | High | Explicit allowlist; FHIR/OAuth network-only |
| Malicious dependency | High | Lockfile review, dependency minimization, SCA, no third-party scripts on PHI routes |
| Malicious or mistaken receiving clinic import | Medium | Patient review, provenance labels, scoped exports |
| Provider directory poisoning | Medium | Validation, source tracking, moderation, endpoint freshness |
| QR payload interception | Medium | Encryption, short display windows, patient confirmation |
| Device loss | Medium | Local vault encryption, biometric unlock, remote wipe outside app |
| Browser storage wipe | Medium | Re-auth recovery; no server vault by design |
| Patient-provider relationship inference | High | No patient accounts for MVP; scrub logs; avoid persistent search linkage |

---

## 4. Scenario: Backend Compromise

### Attacker Goal

Steal patient records, tokens, patches, referral payloads, or provider relationship history from fhir4px servers.

### Exposure

Allowed backend data:

- Public provider directory
- Public endpoint metadata
- Static app assets
- Opt-in endpoint-only validation signals

Forbidden backend data:

- Records
- Tokens
- Patches
- Referral payloads
- Encrypted Bundles
- SHL manifests with patient data
- Patient-provider relationship graph

### Mitigations

- No backend OAuth callback
- No backend FHIR proxy
- No referral relay
- No server vault
- No patient accounts for MVP
- Logs scrubbed of query strings and clinical content

### Residual Risk

An attacker can tamper with public endpoint metadata or static assets if deployment controls fail. Asset integrity and deployment security remain critical.

---

## 5. Scenario: XSS in the Browser App

### Attacker Goal

Run script in the fhir4px origin to steal tokens, records, patches, or generated handoff artifacts.

### Why It Matters

XSS is the highest-risk threat because PHI legitimately exists in browser memory.

### Mitigations

- Strict CSP
- No arbitrary third-party scripts
- No unsanitized HTML
- No `dangerouslySetInnerHTML` for clinical content
- Dependency minimization
- Dependency pinning and review
- Trusted Types where practical
- Keep PHI out of long-lived global stores
- Encrypt before IndexedDB persistence
- Clear transient auth state after callback

### Residual Risk

If malicious code executes in the browser origin during an active session, it can potentially access in-memory PHI. The architecture reduces duration and persistence, but it cannot make active XSS harmless.

---

## 6. Scenario: Token Theft from Storage

### Attacker Goal

Read access or refresh tokens from browser storage.

### Mitigations

- No plaintext localStorage token persistence
- Token material encrypted before IndexedDB write
- WebAuthn PRF-backed vault key where supported
- Session-only fallback where persistent vault is unavailable
- Explicit disconnect and clear-local-data controls

### Residual Risk

Malicious browser extensions, compromised devices, or active XSS can target tokens while decrypted in memory.

---

## 7. Scenario: Service Worker Caches PHI

### Attacker Goal

Recover cached FHIR responses, QR payloads, or export artifacts from Cache Storage.

### Mitigations

- Explicit service worker cache allowlist
- Network-only for FHIR and OAuth origins
- No broad runtime caching
- No background sync for patient payloads
- Test cache contents during CI and release validation

### Residual Risk

Misconfigured Workbox/runtime rules can accidentally cache sensitive GET responses. This needs automated tests.

---

## 8. Scenario: Provider Directory Poisoning

### Attacker Goal

Inject a malicious FHIR endpoint or alter endpoint metadata to redirect patients to attacker-controlled infrastructure.

### Mitigations

- Store source provenance for every endpoint
- Prefer CMS/vendor-published sources
- Validate SMART configuration
- Track TLS origin and metadata freshness
- Require moderation or confidence threshold before surfacing endpoints prominently
- Display organization identity clearly before SMART launch
- Never send credentials to fhir4px; patient authenticates at provider origin

### Residual Risk

A convincing malicious endpoint could still trick users if directory validation and UI identity checks are weak.

---

## 9. Scenario: QR or Local Export Misuse

### Attacker Goal

Scan a QR summary, copy an encrypted file, or obtain decryption material.

### Mitigations

- Encrypt portable artifacts
- Display only scoped payloads
- Separate encrypted file from decryption material where practical
- Short display windows for QR codes
- Patient confirmation before showing/share/export
- Clear included-data review
- Include provenance and creation time

### Residual Risk

Patient-mediated sharing depends on the patient and clinic environment. Shoulder-surfing and accidental sharing cannot be fully eliminated.

---

## 10. Scenario: Device Loss

### Attacker Goal

Access local vault, tokens, patches, or exports from a lost device.

### Mitigations

- Vault encrypted at rest
- WebAuthn/biometric unlock where supported
- No server recovery vault
- Clear local data control
- Encourage device OS lock and remote wipe
- Do not persist plaintext exports

### Residual Risk

If the device is unlocked or compromised while the app is active, local data may be exposed.

---

## 11. Scenario: Patient Relationship Inference

### Attacker Goal

Infer that a patient is connected to a provider, condition, specialty, or referral path through fhir4px logs or analytics.

### Mitigations

- No patient accounts for MVP
- No patient-specific connection history
- Endpoint confirmations are opt-in and endpoint-only
- Avoid raw search log retention
- Aggregate operational metrics only
- Scrub IP/device identifiers as quickly as operationally feasible

### Residual Risk

Network-level observers outside fhir4px may still infer activity from source EHR or clinic traffic.

---

## 12. Test Requirements

Security tests should verify:

- No token values are written to localStorage.
- No FHIR payloads are written to localStorage.
- IndexedDB patient entries are encrypted.
- Service worker Cache Storage contains no FHIR/API/token responses.
- OAuth callback cleans URL parameters.
- Directory API rejects PHI-like validation payloads.
- Build contains no unintended third-party analytics on PHI routes.

---

## 13. Open Decisions

1. Choose security test tooling for browser storage and service worker cache inspection.
2. Define provider directory confidence scoring.
3. Define CSP deployment mechanism with MUI/Emotion.
4. Define local export encryption envelope.
5. Define whether refresh tokens are allowed in MVP.
6. Define how to handle malicious browser extension risk in user-facing copy.

---

## 14. Related Documents

- `architecture.md` - system boundaries and acceptance criteria
- `security-model.md` - security controls
- `handoff-modes.md` - referral transfer modes
- `provider-directory.md` (moved to fhir4px-directory repo) - directory integrity and validation
