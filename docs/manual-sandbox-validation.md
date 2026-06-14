# Manual Sandbox Validation

**Status:** Ready to execute  
**Date:** May 25, 2026  
**Scope:** Epic and Cerner/Oracle sandbox checks from `http://localhost:3000`

Do not record screenshots or videos that contain credentials, tokens, patient records, QR payloads, encrypted Bundles, or decryption keys.

---

## 1. Preflight

1. Start the app at `http://localhost:3000`.
2. For local SMART Dev Sandbox testing, start HAPI R4 with `npm run sandbox:start`, then load the app fixture with `npm run sandbox:load-fixtures`.
3. Confirm `http://localhost:4004/hapi-fhir-jpaserver/fhir/metadata` returns a CapabilityStatement before selecting `SMART Dev Sandbox` in the UI.
4. Confirm `.env` contains sandbox credentials, but do not print them.
5. Open DevTools with Network, Application, Console, IndexedDB, localStorage, and Cache Storage visible.
6. Clear prior local data from Settings.

---

## 2. Epic

1. Search for `Epic Sandbox`.
2. Connect.
3. Confirm the authorize request uses:
   - `redirect_uri=http://localhost:3000`
   - no trailing slash
   - normalized R4 `aud`
   - no `launch/patient` scope for the current non-production Epic client
4. Log in with the sandbox test user.
5. Complete consent.
6. Confirm redirect back to `/connected`.
7. Confirm token/session records are encrypted in IndexedDB and absent from localStorage.
8. Fetch referral summary.
9. Create one patient correction.
10. Build encrypted export with corrections included and excluded.
11. Confirm Cache Storage contains no FHIR records, token values, patient IDs, QR payloads, or export contents.

---

## 3. Cerner / Oracle

1. Search for `Cerner Sandbox`.
2. Connect.
3. Confirm the authorize request includes `launch/patient`.
4. Log in with the sandbox test user.
5. Complete consent.
6. Confirm redirect back to `/connected`.
7. Repeat the same storage, summary, correction, export, and cache checks used for Epic.

---

## 4. Pass Criteria

- SMART login completes without a fhir4px backend callback.
- Token exchange happens directly from browser to source EHR.
- No token or FHIR payload appears in localStorage, Cache Storage, console output, or fhir4px-origin network requests.
- FHIR resources are fetched directly from the source FHIR origin.
- Patient corrections remain local and encrypted.
- Local encrypted Bundle can be saved and decrypted locally.
- QR summary renders only when scanner-safe; otherwise it falls back to encrypted Bundle.

---

## 5. Failure Triage

| Symptom | First Check |
|---|---|
| Epic invalid request | Exact redirect URI, no trailing slash, current client ID, no `launch/patient` |
| Token exchange failed | Single-use code reuse, CORS/token endpoint, state TTL, exact redirect URI |
| Missing resources | Scope grant, vendor resource support, resource-specific CORS/status |
| `FHIR Patient read failed... localhost:4004` | SMART Dev Sandbox/HAPI is not running, Docker Desktop is not reachable from WSL, or port 4004 is blocked |
| Empty export | Local SMART session missing or FHIR fetch failed |
| Cache contains sensitive content | Workbox runtime rules and dev/prod service worker state |
