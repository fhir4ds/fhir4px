/**
 * Told to the app when local data changed behind a mounted page's back: a
 * portal was added, records were imported. Pages that read the vault once (the
 * Records page, which stays mounted while the user is on another page) listen
 * and reload it.
 */

export const LOCAL_DATA_CHANGED_EVENT = "fhir4px:local-data-changed";

export function notifyLocalDataChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCAL_DATA_CHANGED_EVENT));
}
