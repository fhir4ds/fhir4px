# FHIR Scope and Resource Plan

**Status:** Draft  
**Date:** May 24, 2026  
**Scope:** MVP SMART scopes, FHIR R4 resources, and browser fetch rules

---

## 1. Goal

fhir4px should fetch the minimum clinical data needed for patient-controlled referral handoff. Resource scope should expand by workflow, not by default.

The browser fetches FHIR data directly from the source EHR. fhir4px backend services must never proxy, receive, or log FHIR payloads.

---

## 2. Scope Principles

- Request the minimum SMART scopes needed for the active workflow.
- Prefer patient-level read scopes.
- Avoid broad clinical scopes unless a specific workflow requires them.
- Avoid refresh-token scopes for MVP. The current implementation does not retain refresh tokens returned by a sandbox.
- Show patients what categories are included before handoff.
- Treat normalized/derived data as PHI with the same restrictions as source resources.

---

## 3. Base SMART Scopes

Baseline standalone patient connection for vendors that support standard patient context requests:

```text
launch/patient openid fhirUser
```

Epic standalone sandbox is different in practice: the `fhir4ds` demo client is accepted with patient read scopes but without `launch/patient`.

```text
openid fhirUser patient/Patient.read patient/Observation.read patient/Condition.read patient/MedicationRequest.read patient/Encounter.read patient/Procedure.read
```

Initial clinical read scopes:

```text
patient/Patient.read
patient/MedicationRequest.read
patient/AllergyIntolerance.read
patient/Condition.read
patient/Observation.read
patient/DiagnosticReport.read
patient/DocumentReference.read
patient/Encounter.read
patient/Procedure.read
patient/Immunization.read
```

MVP may start with a smaller scope group for provider compatibility and progressively request more when needed.

---

## 4. Scope Groups

### Referral Summary Scope

Used for QR-contained summary and human-readable summary.

```text
launch/patient
openid
fhirUser
patient/Patient.read
patient/MedicationRequest.read
patient/AllergyIntolerance.read
patient/Condition.read
patient/Observation.read
```

### Expanded Clinical Context Scope

Used for local encrypted Bundle export.

```text
launch/patient
openid
fhirUser
patient/Patient.read
patient/MedicationRequest.read
patient/MedicationStatement.read
patient/AllergyIntolerance.read
patient/Condition.read
patient/Observation.read
patient/DiagnosticReport.read
patient/DocumentReference.read
patient/Encounter.read
patient/Procedure.read
patient/Immunization.read
```

`MedicationStatement` may not be available everywhere. The app should request or fetch it only when the source advertises support or when product requirements justify the added compatibility risk.

### Documents Scope

Used when the patient explicitly includes documents.

```text
patient/DocumentReference.read
```

Document binary retrieval is not automatically in scope. Pulling document attachments can dramatically increase payload size and risk. It needs a separate UX and size policy.

---

## 5. MVP Resource Set

| Resource | Purpose | MVP Use |
|---|---|---|
| `Patient` | Identity matching and demographics | Required |
| `MedicationRequest` | Prescribed medications | Required |
| `MedicationStatement` | Patient-reported/current medication use where available | Optional |
| `AllergyIntolerance` | Allergies and intolerances | Required |
| `Condition` | Problems/diagnoses | Required |
| `Observation` | Labs, vitals, clinical measurements | Required, filtered |
| `DiagnosticReport` | Lab/imaging report groupings | Optional in first QR summary, useful for bundle |
| `DocumentReference` | Clinical notes and documents | Optional, explicit patient selection |
| `Encounter` | Visit context | Optional summary, useful for bundle |
| `Procedure` | Procedures/surgical history | Optional |
| `Immunization` | Immunization history | Optional |

---

## 6. Fetch Rules

The browser fetch pattern should follow the existing `fhir4ds` approach, hardened for fhir4px:

1. Discover source endpoint and SMART metadata.
2. Complete SMART OAuth with PKCE.
3. Use patient ID from launch context or token response.
4. Fetch `Patient/{id}` directly.
5. Fetch patient-scoped resources with `_count` pagination.
6. Follow `Bundle.link[relation=next]` up to a workflow-specific limit.
7. Handle unsupported resource types without failing the whole workflow.
8. Surface expired token and insufficient scope errors clearly.

### Query Pattern

Default:

```text
GET {base}/{ResourceType}?patient={patientId}&_count=100
```

Some resources or vendor implementations may require `subject={patientId}`. The app should use resource-specific query rules and record compatibility behavior in the provider directory only as endpoint metadata, not as patient history.

### Vendor Quirks

Known from `fhir4ds`:

- Epic sandbox may require `Epic-Client-ID` header on FHIR requests.
- Epic and Cerner sandbox launch scopes differ. Epic standalone should not include `launch/patient`; Cerner sandbox should.
- Epic sandbox redirect URI matching is exact. The current `fhir4ds`-compatible local redirect is `http://localhost:3000` with no trailing slash.
- Resource support varies by endpoint.

These details are useful production compatibility inputs, but patient-specific successes/failures must not be logged server-side.

---

## 7. Referral Summary Filtering

QR-contained summaries should not include every resource by default.

Initial filtering:

- Active medications, recently changed medications, and patient-marked corrections
- Active allergies and high-severity intolerances
- Active conditions and referral-relevant historical conditions
- Recent abnormal labs and clinically relevant recent observations
- Demographics needed for matching
- Referral reason and patient notes

The summary must state that it is scoped and not a complete record.

---

## 8. Local Encrypted Bundle Scope

Local encrypted Bundle export can include broader data because it is not constrained by QR size.

Still required:

- Patient review before export
- Resource category toggles
- Date-range filters for high-volume resources
- Attachment/document explicit selection
- Patient patch inclusion toggle
- Source/provenance labeling

---

## 9. Patient Patch Representation

Patient patches are not provider-authored corrections. They should be represented as separate patient-authored resources or patch metadata with clear provenance.

Rules:

- Do not overwrite source resources.
- Do not mutate provider FHIR JSON.
- Label patient-reported changes clearly.
- Use valid FHIR R4 codes. For example, `MedicationRequest.status` does not use `ended`; use valid status values such as `stopped` or represent the patient report separately.
- Include `Provenance` or equivalent attribution in referral bundles where practical.

---

## 10. Payload Size Policy

High-volume resources need limits:

- `Observation`: date-range and category filters
- `DiagnosticReport`: recent/relevant reports first
- `DocumentReference`: metadata first, attachment only by explicit selection
- `Encounter`: recent encounters first

If a QR summary exceeds scanner-safe limits, switch to local encrypted Bundle.

---

## 11. Open Decisions

1. Define the exact MVP scope group for first implementation.
2. Define date windows for QR summary resources. **Initial encrypted-export filter supports last 12 months, last 24 months, or all dates.**
3. Define Observation categories to include by default.
4. Decide whether `MedicationStatement` is in MVP.
5. Decide whether `DocumentReference` attachments are allowed in MVP.
6. Define FHIR Bundle profile for local encrypted export.
7. Define patient patch resource representation.

---

## 12. Related Documents

- `architecture.md` - browser-only architecture and SMART module
- `handoff-modes.md` - handoff-specific data needs
- `security-model.md` - storage and token rules
- `provider-directory.md` (moved to fhir4px-directory repo) - endpoint capability metadata
