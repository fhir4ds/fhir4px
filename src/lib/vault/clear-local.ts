/**
 * Clear ALL local app data: the encrypted vault (sessions, tokens, datasets,
 * grouping/classification/relationship caches, patient patches and authored
 * records), localStorage (SMART transient state, session vault key, OMOP
 * concept cache), Cache Storage (downloaded models/assets), and in-memory
 * module caches (quality-measure runs). Then reloads the app — keep-alive
 * pages hold loaded patient state in React state, so a reload is the only
 * reliable reset.
 *
 * Static app assets (fhir4ds wheel/wasm/valuesets/CQL under /vendor and
 * /fhir4ds) are code, not data — they are never cleared.
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

  // localStorage app data (OMOP concept cache etc.)
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && (key.startsWith("fhir4px:") || key.startsWith("smart."))) keysToRemove.push(key);
  }
  for (const key of keysToRemove) localStorage.removeItem(key);

  // Cache Storage: downloaded embedding/terminology models and assets
  if (typeof caches !== "undefined") {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }

  // In-memory dataset-scoped caches (quality measures)
  invalidateQualityEvaluation();

  // Keep-alive pages hold loaded patient state in React state — reload.
  window.location.assign("/");
}
