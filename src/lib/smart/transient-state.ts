import type { SmartTransientState } from "./types";

const SMART_STATE_KEY = "fhir4px_smart_state";
const POPUP_PENDING_KEY = "fhir4px_smart_popup_pending";
export const SMART_AUTH_CHANNEL = "fhir4px_smart_auth";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function saveTransientState(state: SmartTransientState, storage = getStorage()): void {
  storage?.setItem(SMART_STATE_KEY, JSON.stringify(state));
}

export function loadTransientState(storage = getStorage(), now = Date.now()): SmartTransientState | null {
  const stored = storage?.getItem(SMART_STATE_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as SmartTransientState;
    if (!parsed.expiresAt || parsed.expiresAt <= now) {
      clearTransientState(storage);
      return null;
    }
    return parsed;
  } catch {
    clearTransientState(storage);
    return null;
  }
}

export function clearTransientState(storage = getStorage()): void {
  storage?.removeItem(SMART_STATE_KEY);
  storage?.removeItem(POPUP_PENDING_KEY);
}

export function markPopupAuthPending(storage = getStorage()): void {
  storage?.setItem(POPUP_PENDING_KEY, "1");
}

export function isPopupAuthPending(storage = getStorage()): boolean {
  return storage?.getItem(POPUP_PENDING_KEY) === "1";
}

export function clearPopupAuthPending(storage = getStorage()): void {
  storage?.removeItem(POPUP_PENDING_KEY);
}

export function removeSmartCallbackParams(url: URL): string {
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  return `${url.origin}${url.pathname}${url.search}${url.hash}`;
}
