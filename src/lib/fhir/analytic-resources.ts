/**
 * The records being analysed: the person the Records page is showing.
 *
 * The quality evaluation, the care gaps and the exports all need a resource
 * list. It used to be "the active SMART session's dataset", which only exists
 * for a connected portal — an imported Bundle has no session at all. The
 * Records page sets this list for the person on screen; everything else reads
 * it. When nothing is set (no Records page yet, e.g. a reload straight onto
 * Quality) the active session's dataset is the fallback.
 */

import type { FhirResource } from "../smart/data";
import { loadSessionResources } from "../engine/session-data";

let resources: FhirResource[] | null = null;

/** Set (or clear) the records of the shown person. */
export function setAnalyticResources(next: FhirResource[] | null): void {
  resources = next;
}

/** The records of the shown person, when a page has published them. */
export function analyticResources(): FhirResource[] | null {
  return resources;
}

/** The records of the shown person, or the active SMART session's dataset. */
export async function loadAnalyticResources(): Promise<FhirResource[]> {
  return resources ?? (await loadSessionResources());
}
