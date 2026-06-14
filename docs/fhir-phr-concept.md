# FHIR PHR Orchestration App — Concept Document

**Project Name:** *fhir4px*
**Date:** May 2026
**Status:** Concept / Pre-seed

---

## The Problem

There is no patient-friendly way to:

1. **Discover** your provider's FHIR endpoint
2. **Connect** your health records across providers
3. **Move** those records to a new provider when you need a referral

Existing solutions (MyChart, CommonHealth, Apple Health) are siloed, provider-controlled, or require technical sophistication. No neutral, patient-controlled layer exists that orchestrates across the ecosystem without holding sensitive data.

---

## The Insight

The FHIR ecosystem has all the right standards in place:

- **SMART App Launch** — standardized OAuth for EHR access
- **FHIR R4** — structured, queryable health records
- **SMART Health Links** — time-limited, scoped, portable record sharing
- **21st Century Cures Act** — mandates open APIs across health systems

What's missing is the **UX layer** that makes these standards accessible to normal patients — and a **national provider endpoint directory** that makes discovery possible.

---

## The Solution

A free, patient-facing app that acts as a **browser-only SMART orchestration layer** — not a data store. The app:

- Helps patients **find their provider's FHIR endpoint** by location
- Facilitates **SMART App Launch** to connect to their EHR
- Generates browser-only referral handoffs, including SMART Health Links where the source or receiving system supports them
- Enables **warm referrals** with clinical context attached without sending health data to fhir4px servers

**The app never stores patient data on fhir4px servers. It never holds credentials. It is a patient-side orchestrator, not a server-side custodian.**

---

## Core Design Principles

### 1. Zero Server-Side Data Custody
The fhir4px server path holds no patient health data:

- No health records
- No encrypted FHIR bundles, JWE payloads, or hosted manifests
- No FHIR tokens or refresh tokens
- No credentials
- No patient-authored patch data
- Only: static app hosting, a provider endpoint directory, public endpoint metadata, and opt-in endpoint validation signals stripped of patient identity and record content

In this document, **zero custody** means zero fhir4px server-side custody. The browser can temporarily process PHI with the patient's authorization, but fhir4px servers never receive, store, relay, or log patient records, tokens, patches, or encrypted health payloads.

### 2. Decentralized by Design
Patient data never passes through fhir4px infrastructure. The flow is always local-to-source, source-to-receiver, or patient-mediated:

```
Provider A FHIR Server  ──SMART──►  Patient Browser  ──handoff──►  Provider B
                                            │
                                            └── fhir4px backend only supplies
                                                app code + public endpoint data
```

### 3. Radically Simple UX
The target user is not a FHIR developer. They are a 58-year-old patient managing a chronic condition across three providers. Every interaction must be:

- Findable in two taps
- Explainable without technical jargon
- Recoverable if something goes wrong

Complexity lives in the architecture. The surface is simple.

---

## Key Features

### Provider Lookup
- Search by name, specialty, or location
- Backed by a crowd-sourced + crawled national FHIR endpoint directory
- Seeded from NPPES and CMS open data
- Community-validated over time (Waze model — users confirm, flag, update)
- Patients can opt into endpoint confirmations that contain only public endpoint metadata, never identity or record data

### Provider Connection
- One-tap SMART App Launch against the provider's FHIR endpoint
- Patient authenticates directly with their provider portal — app never sees credentials
- OAuth tokens encrypted client-side using a key derived from the patient's Passkey (WebAuthn PRF extension)
- Encrypted token blob stored only in browser IndexedDB or device-local storage — unreadable without biometric unlock
- No token backup, refresh token, or encrypted token blob is stored by the fhir4px backend

### Record Sharing & Referrals
- Patient selects a provider to refer to
- Patient controls scope: what data is shared, for how long, and by which handoff mode
- Browser fetches selected FHIR resources directly from the source EHR using the patient's SMART authorization
- Browser normalizes, scopes, compresses, and encrypts locally when a portable artifact is needed
- No record bundle, manifest body, encrypted JWE, or referral payload is posted to fhir4px servers

### Record Transfer — Browser-Only Referral Handoff

The mechanism behind a fhir4px referral is a **Browser-Only Referral Handoff**. Instead of hosting an ephemeral manifest relay, fhir4px keeps the entire health-data path inside the patient's browser, the source EHR, and the receiving provider's system.

**Why not a hosted relay?**
- A relay is convenient, but it creates a fhir4px server-side patient-data path even when the payload is encrypted
- External S3/R2-style storage requires object lifecycle management, access policy controls, and persistent custody decisions
- WebRTC-style peer transfer is fragile in hospital networks and mobile browsers
- Zero-server mode preserves the cleanest trust boundary: fhir4px infrastructure never receives the payload at all

**Supported Handoff Modes:**

```
1. Direct Source Pull
   └─ Patient authorizes source EHR through SMART App Launch
   └─ Browser creates a source-access handoff or uses a source-hosted SMART Health Link when available
   └─ Receiving provider pulls directly from the source EHR
   └─ fhir4px backend never receives records, manifests, tokens, or keys

2. QR-Contained Summary
   └─ Browser fetches selected FHIR resources directly from the source EHR
   └─ Browser creates a compact, scoped, encrypted summary payload
   └─ QR/deep link contains the encrypted payload or enough local handoff material for the receiver
   └─ Best for medication, allergy, problem, and referral-context summaries

3. Local Encrypted Bundle
   └─ Browser creates an encrypted FHIR Bundle file on the patient device
   └─ Patient gives it to the clinic through local upload, portal upload, AirDrop, email, or removable media
   └─ Decryption material is shared patient-to-clinic, not through fhir4px servers
```

**Trade-off:** Without a backend relay, fhir4px does not provide an asynchronous "scan later after the patient's phone goes offline" transfer path unless the source EHR or receiving system hosts the exchange endpoint. The patient device or the source EHR must be available at handoff time.

**Privacy reality:** The strongest privacy boundary is not that fhir4px stores unreadable ciphertext. It is that fhir4px servers never receive the ciphertext in the first place.

**Payload size:** Small referral summaries can fit into QR/deep-link handoffs. Large medical histories should use direct source pull or a local encrypted FHIR Bundle file rather than forcing the entire record into a QR code.

---

### Patient Corrections — FHIR Patch Layer

fhir4px is not just a data courier. Patients can annotate and correct their own records — marking a medication as discontinued, adding an allergy, noting a condition as resolved. This introduces a critical design constraint: **patient-generated health data (PGHD) must never overwrite or corrupt provider-signed clinical data.**

The solution is a **FHIR Patch Correction Layer** — a client-side adjustment layer that sits on top of the raw provider record without touching it.

**Core principle:** The original FHIR JSON from Epic or Cerner is never modified. Altering it directly breaks the provider's cryptographic trust chain. Instead, patient edits generate a separate, small patch resource.

**Example — patient marks a medication inactive:**

```json
{
  "resourceType": "MedicationRequest",
  "id": "epic-med-id-123",
  "status": "ended",
  "note": [{
    "authorString": "Patient",
    "text": "Discontinued by patient due to side effects."
  }]
}
```

**Client-side merge at render time:**

```
[ Provider FHIR Data (read-only) ]  ──┐
                                       ├──► [ Client-Side Merge ] ──► Clean UI
[ Patient Patch Layer (encrypted) ] ───┘
```

The UI clearly distinguishes source:
- **Lisinopril 10mg** — *Active (Northwestern Medicine)*
- **Simvastatin 20mg** — *Inactive (Marked by patient, May 24 2026)*

**Persisting patches** follows the same zero-server rule as tokens:
- Patch list is encrypted locally using the PRF-derived key
- Encrypted patch data stays in browser IndexedDB or device-local storage
- No patch blob is synced through the fhir4px backend
- A new device requires re-entry, provider re-auth, or a patient-controlled local encrypted import

**How this appears in a referral bundle:**

When generating a browser-only referral handoff, fhir4px can bundle both streams into a local FHIR Bundle:

1. Original untouched provider-sourced resources
2. Patient-authored patch resources with FHIR Provenance elements clearly marking them as self-reported

This is precisely what a receiving clinician needs for **medication reconciliation** — the single highest-risk handoff moment in care transitions. Rather than raw patient edits overwriting chart data (which clinicians distrust), they see a structured side-by-side: what the hospital believes the patient is taking vs. what the patient reports actually taking. That distinction at the point of care is clinically valuable and potentially life-saving.

---

### Cross-Device Recovery
- Patient creates a Passkey on first use → stored in iCloud Keychain or Google Password Manager natively
- Passkey syncs across the patient's own devices automatically via Apple/Google infrastructure where supported
- No fhir4px server copy of tokens, patches, provider connections, or encrypted patient vault data exists
- On a new device, the patient re-auths with provider portals through SMART App Launch
- If local patches matter, the patient can import a patient-controlled encrypted backup or recreate the patch layer locally
- The public provider directory remains available instantly because it contains endpoint metadata, not patient-specific connection history

---

## The Directory Problem — Solved as a Byproduct

The national FHIR endpoint directory is the hardest infrastructure problem. This app solves it elegantly:

| Data Source | Role |
|---|---|
| NPPES | Seed provider identity (NPI, name, address, specialty) |
| CMS endpoint lists | Seed known FHIR endpoints |
| App crawlers | Discover `/.well-known/smart-configuration` at known health system domains |
| Opt-in confirmations | Patients can submit endpoint-only validation signals after successful launch |
| Community flags | Patients report stale or incorrect data |

The directory is not a separate product to build. It grows organically through crawlers, public datasets, and opt-in endpoint-only confirmations. Successful patient connections are never logged as patient-specific relationship data.

---

## Deployment Model — Zero-Install PWA

fhir4px is delivered as a **Progressive Web App (PWA)** — no App Store download required. A patient scans a QR code at a clinic or clicks a link and is immediately onboarded in their mobile browser. As of 2026, Safari 18+ on iOS and Chrome on Android both fully support the WebAuthn PRF extension, making this viable without compromise.

**PWA installation prompt:** After connecting their first provider, patients are prompted to "Add to Home Screen." This one step:
- Exempts the app from iOS's 7-day IndexedDB storage purge
- Creates a persistent, app-like experience
- Requires no App Store account or download

**Fallback if storage is cleared:** The patient's Passkey lives in iCloud Keychain or Google Password Manager — never in the browser. If IndexedDB is wiped, the patient taps FaceID where supported and re-auths with their provider portal. The local vault is rebuilt from the source EHR; no server backup is required.

---

## Security Architecture — WebAuthn PRF + Encrypted Local Vault

Token security is handled entirely on the patient's device using the **WebAuthn PRF (Pseudo-Random Function) extension** where supported — a modern web standard that bridges browser apps to the device's native Secure Enclave without requiring a native app install.

```
[ Patient Browser ]
        │
        │  1. FaceID / TouchID biometric prompt
        ▼
[ Device Secure Enclave ]
        │
        │  2. Derives unique 32-byte symmetric key via PRF
        │     (Passkey stored in iCloud Keychain / Google Password Manager)
        ▼
[ Web Crypto API (in-browser) ]
        │
        │  3. Encrypts / decrypts SMART OAuth tokens in memory
        ▼
[ Browser IndexedDB ]
        │  Stores encrypted local vault — unreadable without biometric
        │
        ▼
[ Local Referral Handoff ]
        │  Source pull, QR-contained summary, or encrypted local Bundle
        │  No fhir4px server receives tokens, records, patches, or payloads.
```

**Why this maintains Zero Server-Side Data Custody:**
The decryption key never leaves the patient's device, and the fhir4px backend stores no encrypted patient vault to attack. Even a complete fhir4px server breach cannot expose records, tokens, patches, or referral payloads because they were never sent there.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                   Patient Device (PWA)                    │
│                                                          │
│  ┌──────────────┐   ┌────────────────────────────────┐  │
│  │  App UX      │   │  Secure Enclave                 │  │
│  │  - Find      │   │  Passkey → PRF → Crypto Key     │  │
│  │  - Connect   │   └────────────────┬───────────────┘  │
│  │  - Share     │                    │ encrypts/decrypts │
│  │  - Refer     │   ┌────────────────▼───────────────┐  │
│  └──────┬───────┘   │  IndexedDB                      │  │
│         │           │  Encrypted local vault           │  │
│         │           └────────────────────────────────┘  │
└─────────┼────────────────────────────────────────────────┘
          │
          │  SMART App Launch (OAuth2 — patient authenticates directly)
          │
┌─────────▼──────────────┐
│   Provider A            │
│   EHR / FHIR Server    │
│   (Epic, Cerner,        │
│    Athena, etc.)        │
└─────────┬───────────────┘
          │
          │  Source pull, source-hosted SHL, QR summary,
          │  or local encrypted Bundle — never via fhir4px servers
          ▼
┌────────────────────────┐
│   Provider B           │
│   EHR / FHIR Server    │
│   receives referral    │
└────────────────────────┘

┌────────────────────────┐
│   App Backend           │  Not in the health-data path.
│  - Static PWA hosting   │
│  - Provider directory   │  Public endpoint metadata only.
│  - Opt-in validations   │  No identity, PHI, tokens, patches, or payloads.
│  - No referral relay    │
│  - No patient vault     │
└────────────────────────┘
```

---

## Business Model

### Free for Patients — Always
Monetization comes from the value delivered to the receiving end of a referral, not from the patient.

### Revenue Streams

**1. Warm Referral Fees**
Health systems pay per converted new patient referral. A record-attached warm referral is worth significantly more than a cold lead. Comparable to:
- Patient acquisition costs in health systems: $200–$500 per new patient
- Zocdoc referral model but with clinical context attached

**2. Developer API**
Third-party SMART app developers pay to query the endpoint directory:
- "Give me all FHIR R4 endpoints within 50 miles of ZIP 90210"
- Per-query or subscription pricing
- Natural market: app developers, researchers, health plans

**3. Network-Contained Referrals (ACO / Health Plan)**
ACOs and health plans pay to keep referrals within their network. App can surface in-network providers preferentially when a plan relationship exists.

**4. Priority Placement**
Specialist practices pay for surfaced placement in referral recommendations — similar to sponsored listings but governed by clinical relevance rules.

### What Is Not a Revenue Stream
- Selling patient data — architecturally impossible by design
- Patient subscriptions — creates access inequality, misaligns incentives
- Advertising — degrades trust in a clinical context

---

## Competitive Positioning

| | This App | MyChart | Apple Health | CommonHealth |
|---|---|---|---|---|
| Provider-agnostic | ✅ | ❌ | Partial | ✅ |
| No server-side data custody | ✅ | ❌ | ❌ | ❌ |
| Provider discovery | ✅ | ❌ | ❌ | ❌ |
| Warm referrals | ✅ | ❌ | ❌ | ❌ |
| Cross-device (no lock-in) | ✅ | Partial | ✅ | ❌ |
| Free to patient | ✅ | ✅ | ✅ | ✅ |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| SMART registration friction — app must be registered with each EHR tenant | Target large EHR platforms first (Epic, Oracle Health); registration covers thousands of health systems |
| Patient engagement / retention between referral events | Care gap alerts, medication reminders, appointment tracking as retention hooks |
| Patient edits corrupting clinical data | FHIR Patch layer never modifies source data; patches are separately attributed and clearly labeled as patient-reported in referral bundles |
| Health system resistance to referral fees | Frame as patient acquisition cost reduction, not a new fee |
| No backend relay for asynchronous handoff | Use direct source pull where available; otherwise use QR-contained summaries or local encrypted Bundle files while the patient device is present |
| iOS 7-day IndexedDB storage purge | Prompt patient to install as PWA (Add to Home Screen); PWA storage is exempt from purge |
| Token loss on device wipe | Passkey survives in iCloud Keychain / Google Password Manager where supported; patient re-auths with the provider portal |
| WebAuthn PRF browser support | Safari 18+ and Chrome on Android fully support PRF as of 2026; graceful fallback to re-auth for older browsers |

---

## Open Questions

1. What is the minimum viable provider directory to launch? (Geographic focus — single metro first?)
2. What retention hook brings patients back between referral events?
3. What is the right first health system partner to validate the referral fee model?
4. Should a native app wrapper (Capacitor) be offered alongside the PWA for patients who want permanent keychain storage without the PWA install prompt?
5. Should the endpoint directory be open-sourced as a commons to accelerate adoption?

---

## Summary

This is a **patient-managed Health Overlay Network** disguised as a simple app. The value proposition to the patient is clear: find your provider, connect your records, move them when you need to. The value proposition to the business is the referral network that emerges naturally from that usage. The architectural commitment to zero server-side data custody is not a constraint — it is the product's most defensible attribute.

The directory builds through public data, crawlers, and opt-in endpoint validation. The moat deepens with every verified endpoint. The monetization sits at the moment of highest clinical value — the referral.
