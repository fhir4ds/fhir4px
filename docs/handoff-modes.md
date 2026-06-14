# Referral Handoff Modes

**Status:** Draft  
**Date:** May 24, 2026  
**Scope:** Browser-only referral exchange without fhir4px server-side patient-data custody

---

## 1. Rule

Referral handoff artifacts are created in the patient browser and move directly to the receiving provider or source EHR. They must not be posted to fhir4px backend services.

Forbidden fhir4px server traffic:

- FHIR Bundle uploads
- SMART Health Link manifests containing patient data
- Encrypted JWE/JWS payloads derived from patient records
- QR payload material
- Local encrypted Bundle files
- Decryption keys or passphrases
- Patient-provider relationship history

---

## 2. Mode Selection

| Mode | Best For | Requires | Server PHI Path | MVP Priority |
|---|---|---|---|---|
| Direct Source Pull | Larger records, standards-aligned transfer | Source and receiver support | No | High, where available |
| QR-Contained Summary | Intake summary, meds/allergies/problems | Small payload and scanner workflow | No | High |
| Local Encrypted Bundle | Larger MVP export, reliable fallback | Clinic file intake path | No | Highest practical fallback |

The app should choose the simplest mode that preserves fidelity and works in the receiving setting. If a mode fails, the fallback order is:

1. Direct source pull if source and receiver support it
2. QR-contained summary for small referral context
3. Local encrypted Bundle file
4. Human-readable local summary view

---

## 3. Mode A: Direct Source Pull

Direct source pull keeps the source EHR as the data host. fhir4px helps the patient find the endpoint, authorize access, and create instructions for the receiver.

### Flow

```
1. Patient selects source provider and receiving provider.
2. Browser discovers source SMART/FHIR capabilities.
3. Patient authorizes source EHR through SMART App Launch.
4. Browser prepares a source-access handoff.
5. Receiving provider pulls from source EHR through supported source/receiver workflow.
6. fhir4px backend receives no records, tokens, manifests, or payloads.
```

### Candidate Artifacts

- Source-hosted SMART Health Link when available
- Source FHIR endpoint instruction plus patient consent record
- Receiving-provider launch instruction
- Clinic-readable connection packet with endpoint metadata only

### Advantages

- Best fit for large record sets
- Avoids QR payload size limits
- Preserves source-system authority
- Most aligned with provider-to-provider clinical workflows

### Constraints

- Requires source support
- Requires receiver support
- May require app registration per EHR tenant
- May require patient to stay involved in consent/authentication
- fhir4px cannot guarantee asynchronous handoff unless the source or receiver hosts the exchange

### Acceptance Criteria

- No source FHIR data touches fhir4px servers.
- No OAuth token is sent to the receiving provider unless explicitly part of a standards-compliant source-supported flow.
- The receiving provider can identify the source, patient-mediated consent context, requested scope, and expiration behavior.

---

## 4. Mode B: QR-Contained Summary

QR-contained summary is for small referral-context payloads. The browser creates a compact encrypted summary and encodes it directly into a QR/deep-link artifact or adjacent local handoff material.

### Flow

```
1. Patient selects referral summary scope.
2. Browser fetches selected FHIR resources from source EHR.
3. Browser normalizes and minimizes the summary.
4. Browser compresses and encrypts the payload locally.
5. Browser renders QR/deep link for the receiving clinic.
6. Receiving clinic scans/imports locally.
7. fhir4px backend receives no payload or key material.
```

### Initial Summary Scope

- Demographics needed for matching
- Active medications
- Allergies and intolerances
- Active problems/conditions
- Recent high-value labs
- Referral reason
- Patient-authored medication/allergy/problem corrections, if included by the patient

### Payload Policy

The QR payload must be intentionally small. The app should estimate encoded size before rendering and switch to local encrypted Bundle if the payload exceeds scanner-safe limits.

The summary should prefer:

- Coded values over verbose text where possible
- Recent/relevant observations over full lab history
- Explicit provenance for patient-reported fields
- Deterministic ordering for stable review

### Advantages

- Works at front desk/intake
- Does not require clinic file upload
- Does not require fhir4px backend relay
- Can support low-friction warm referral context

### Constraints

- QR payload size is the hard limit
- Scanner quality varies
- Not suitable for complete histories
- May require a receiving app/viewer if the receiving EHR cannot parse the payload
- May not be a standard SMART Health Link unless the receiver supports the exact payload format

### Acceptance Criteria

- QR/deep-link content contains no fhir4px server URL carrying patient payload state.
- Decryption material is not sent to fhir4px servers.
- The app clearly warns when summary scope is partial.
- Large payloads automatically route to local encrypted Bundle.

---

## 5. Mode C: Local Encrypted FHIR Bundle

Local encrypted Bundle is the most reliable zero-server fallback. The browser writes an encrypted file to the patient device; the patient gives it to the receiving clinic through a local channel.

### Flow

```
1. Patient selects export scope.
2. Browser fetches selected FHIR resources from source EHR.
3. Browser adds patient patch layer if selected.
4. Browser creates a FHIR Bundle locally.
5. Browser encrypts the Bundle locally.
6. Browser saves or shares the encrypted file from the patient device.
7. Patient provides decryption material directly to the receiving clinic.
8. fhir4px backend receives no file, payload, or key material.
```

### Candidate File Contents

- Encrypted FHIR Bundle
- Export metadata
- Source endpoint metadata
- Scope manifest
- Creation timestamp
- Expiration recommendation
- Patient-visible explanation
- Integrity metadata

The file format must be specified in a later design pass before implementation.

### Advantages

- Handles larger data sets
- Works without backend relay
- Works when QR payload is too large
- Easier to test end to end than source-hosted exchange

### Constraints

- Requires clinic file intake path
- Requires decryption workflow
- May not import directly into all EHRs
- Patient must manage the file
- UX must prevent accidental sharing of plaintext

### Acceptance Criteria

- Plaintext Bundle is never persisted.
- The export is encrypted before file save/share.
- Decryption material is displayed/transferred separately from the encrypted file.
- The app provides clear expiration and deletion guidance.

---

## 6. Human-Readable Summary Fallback

When technical exchange fails, the app can render a local human-readable referral summary for the patient to show the receiving clinic.

Rules:

- The summary is generated locally.
- The summary is not posted to fhir4px servers.
- The UI should clearly label source data and patient-reported corrections.
- Printing or screenshotting is a patient-controlled action.

This fallback is not a substitute for structured transfer, but it preserves clinical usefulness in low-integration environments.

---

## 7. UX Requirements

The patient should not have to understand the technical handoff mode. The app should present clear choices:

- Share a quick referral summary
- Export a full encrypted record file
- Connect the receiving provider to the source, where supported

For each handoff, the app must show:

- What data is included
- Which provider it came from
- Whether patient corrections are included
- Whether the receiving clinic needs a file, scan, or source connection
- Whether the patient device must remain available
- How to revoke or stop the handoff, if applicable

---

## 8. Open Decisions

1. Define exact QR summary payload format.
2. Define exact local encrypted Bundle file format.
3. Decide whether QR summary should use a FHIR Bundle, a compact app-specific envelope, or both.
4. Decide decryption UX for receiving clinics.
5. Decide how source-hosted SMART Health Links are detected and preferred.
6. Define scanner-safe size thresholds for QR payloads.
7. Define whether a companion receiver/viewer app is needed for clinics.

---

## 9. Related Documents

- `architecture.md` - zero-server architecture and system boundaries
- `security-model.md` - cryptographic and local vault rules
- `fhir-scope.md` - resource and scope selection
- `threat-model.md` - attacker model and mitigations
