import { isSmartCallback } from "../smart/callback";
import { appUpdateHeld } from "./update-hold";
import { needsIsolationReload, updateReloadAllowed } from "./update-reload";

/** How often a long-lived page asks whether a new version exists. */
const UPDATE_CHECK_MS = 15 * 60 * 1000;
/** Marks the one isolation reload a tab may do. */
const ISOLATION_RELOAD_KEY = "fhir4px:isolation-reload";
/** How often a reload that had to wait for a running job is retried. */
const HELD_RELOAD_RETRY_MS = 5000;

/**
 * Registers the app's service worker.
 *
 * The worker takes over as soon as a new build installs (see vite.config.ts),
 * so this page is running old code while a new version waits to be rendered.
 * When the worker changes under a page that already had one, the page reloads
 * itself once: that is the only moment an update costs a reload. The first
 * visit never reloads, the SMART callback page never reloads, and a running
 * export keeps the update waiting until it finishes.
 */
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

  if (!("serviceWorker" in navigator)) return;

  // A page that starts with a worker in control runs a version installed by an
  // earlier visit; the first visit has none.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let updatePending = false;
  let reloading = false;

  const applyUpdate = () => {
    if (reloading || !updatePending) return;
    if (!updateReloadAllowed({ hadController, smartCallback: isSmartCallback(), held: appUpdateHeld() })) return;
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The visit that installed the worker was served without the isolation
    // headers (a static host cannot send them); now that the worker controls
    // the page, one reload gives it a document that carries them.
    if (
      needsIsolationReload({
        hadController,
        isolated: window.crossOriginIsolated,
        smartCallback: isSmartCallback(),
        alreadyReloaded: sessionStorage.getItem(ISOLATION_RELOAD_KEY) !== null
      })
    ) {
      try {
        sessionStorage.setItem(ISOLATION_RELOAD_KEY, "1");
      } catch {
        // Storage refused: the reload would loop, so do not reload.
        return;
      }
      window.location.reload();
      return;
    }
    updatePending = true;
    applyUpdate();
  });

  // A reload that waited for a job is not lost: retry until the job is done.
  setInterval(applyUpdate, HELD_RELOAD_RETRY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") applyUpdate();
  });

  const register = () => {
    const base = import.meta.env.BASE_URL || "/";
    // The host may cache sw.js for hours; a versioned URL is always this build's
    // manifest, whose precached assets actually exist.
    void navigator.serviceWorker
      .register(`${base}sw.js?v=${__APP_BUILD__}`, { scope: base })
      .then((registration) => {
        const check = () => {
          void registration.update();
        };
        setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      })
      .catch((error: unknown) => {
        // Offline support is an extra, and its absence must not break the app:
        // report it and carry on without a worker.
        console.warn("[fhir4px:pwa] service worker registration failed", error);
      });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
