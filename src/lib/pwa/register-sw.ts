import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister()))
      );
    }
    // Do not clear Cache Storage here. WebLLM stores model artifacts in browser
    // storage, and wiping all caches on each dev load forces repeated downloads.
    return;
  }

  registerSW({
    immediate: false,
    onNeedRefresh() {
      // UI prompt can be added once the shell is richer.
    },
    onOfflineReady() {
      // The app shell is available offline; patient data remains network/local only.
    }
  });
}
