/**
 * Clear local PATIENT data only: the encrypted vault (SMART sessions and
 * tokens, fetched datasets, grouping/classification/relationship caches,
 * patient patches and authored records), SMART transient state, the session
 * vault key, and in-memory dataset-scoped caches (quality-measure runs).
 * Then reloads the app — keep-alive pages hold loaded patient state in
 * React state, so a reload is the only reliable reset.
 *
 * App-only data is intentionally preserved: Cache Storage (embedding and
 * terminology models), the fhir4ds wheel/wasm extensions, vendored eCQM CQL
 * and ValueSets (static app code under /vendor and /fhir4ds), and the OMOP
 * concept cache (terminology code mappings, not patient data).
 */

import { localVault } from "./store";
import { clearTransientState } from "../smart/transient-state";
import { clearSessionVaultKey } from "./keys";
import { invalidateQualityEvaluation } from "../fhir/quality-run";

export async function clearAllLocalData(): Promise<void> {
  // Vault: sessions, tokens, datasets, caches, patches, authored records
  await localVault.clear();
  clearTransientState();
  clearSessionVaultKey();

  // In-memory dataset-scoped caches (quality-measure runs are patient-derived)
  invalidateQualityEvaluation();

  // Keep-alive pages hold loaded patient state in React state — reload.
  window.location.assign("/");
}
