/**
 * Storage quota management.
 *
 * Browsers assign per-origin storage quotas. Without `persist()`, the quota
 * is smaller and the browser can evict data under pressure. We request
 * persistent storage on app load to get the maximum available quota and
 * prevent eviction of patient data.
 *
 * We also provide helpers to check remaining quota before large writes
 * (e.g., saving a FHIR dataset) and to estimate current usage for debugging.
 */

/**
 * Request persistent storage. Call once on app load.
 * This asks the browser for the maximum available quota and prevents
 * eviction of IndexedDB data under storage pressure.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    try {
      const alreadyPersisted = await navigator.storage.persisted();
      if (alreadyPersisted) return true;
      const granted = await navigator.storage.persist();
      console.info("[fhir4px:storage]", {
        event: "persist-requested",
        granted,
        timestamp: new Date().toISOString()
      });
      return granted;
    } catch (err) {
      console.warn("[fhir4px:storage]", {
        event: "persist-failed",
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return false;
}

/**
 * Get current storage usage and quota estimate.
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number; usagePercent: number } | null> {
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      return {
        usage,
        quota,
        usagePercent: quota > 0 ? Math.round((usage / quota) * 100) : 0
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Check if a write of approximately `bytesNeeded` size would fit within the
 * storage quota. Returns true if the write should be safe, false if it would
 * likely exceed quota.
 */
export async function canStoreBytes(bytesNeeded: number): Promise<boolean> {
  const estimate = await getStorageEstimate();
  if (!estimate || estimate.quota === 0) return true; // can't check, allow it
  const remaining = estimate.quota - estimate.usage;
  return remaining > bytesNeeded * 1.2; // 20% safety margin
}

/**
 * Log current storage usage for debugging.
 */
export async function logStorageUsage(label = "storage-check"): Promise<void> {
  const estimate = await getStorageEstimate();
  if (estimate) {
    console.info("[fhir4px:storage]", {
      event: label,
      usageMB: Math.round(estimate.usage / 1024 / 1024),
      quotaMB: Math.round(estimate.quota / 1024 / 1024),
      usagePercent: estimate.usagePercent,
      timestamp: new Date().toISOString()
    });
  }
}
