/**
 * Loader for the deterministic CID association bundle (Pipeline 4).
 *
 * Hosted on HuggingFace at fhir4ds/associations (versioned directories
 * pinned by the repo manifest). The bundle plus crosswalks total ~15MB
 * gzipped. Matching is pure dict/set lookup once items are resolved to
 * CIDs — no embedding inference on this path.
 */

import { associationsArtifactUrl, resolveRelease } from "./manifest";
import type { AssociationBundle, Icd10Crosswalk, LabPartCrosswalk } from "./types";

let bundlePromise: Promise<AssociationBundle> | null = null;
let labPartsPromise: Promise<LabPartCrosswalk> | null = null;
let icd10Promise: Promise<Icd10Crosswalk> | null = null;

async function fetchGzJson<T>(gzUrl: string, plainUrl?: string): Promise<T> {
  async function fetchPlain(): Promise<T> {
    if (!plainUrl) throw new Error(`Association data unavailable: no gzip support and no plain fallback for ${gzUrl}`);
    const plain = await fetch(plainUrl);
    if (!plain.ok) throw new Error(`Association data unavailable: ${plain.status} ${plainUrl}`);
    return (await plain.json()) as T;
  }
  const response = await fetch(gzUrl);
  if (response.status === 404) return fetchPlain();
  if (!response.ok || !response.body) {
    throw new Error(`Association data unavailable: ${response.status} ${gzUrl}`);
  }
  if (typeof DecompressionStream === "undefined") {
    return fetchPlain();
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text) as T;
}

export async function loadAssociationBundle(): Promise<AssociationBundle> {
  if (bundlePromise) return bundlePromise;
  bundlePromise = resolveRelease()
    .then((release) =>
      fetchGzJson<AssociationBundle>(associationsArtifactUrl("graph", release, "associations.json.gz"))
    )
    .catch((error) => {
    bundlePromise = null;
    throw error;
  });
  return bundlePromise;
}

export async function loadLabPartCrosswalk(): Promise<LabPartCrosswalk> {
  if (labPartsPromise) return labPartsPromise;
  labPartsPromise = resolveRelease()
    .then((release) =>
      fetchGzJson<LabPartCrosswalk>(
        associationsArtifactUrl("crosswalks", release, "loinc_test_to_part.json.gz"),
        associationsArtifactUrl("crosswalks", release, "loinc_test_to_part.json")
      )
    )
    .catch((error) => {
    labPartsPromise = null;
    throw error;
  });
  return labPartsPromise;
}

export async function loadIcd10Crosswalk(): Promise<Icd10Crosswalk> {
  if (icd10Promise) return icd10Promise;
  icd10Promise = resolveRelease()
    .then((release) =>
      fetchGzJson<Icd10Crosswalk>(
        associationsArtifactUrl("crosswalks", release, "icd10_to_snomed.json.gz"),
        associationsArtifactUrl("crosswalks", release, "icd10_to_snomed.json")
      )
    )
    .catch((error) => {
    icd10Promise = null;
    throw error;
  });
  return icd10Promise;
}

/** Preload bundle + crosswalks during idle time so click-to-relate is instant. */
export async function preloadAssociations(): Promise<void> {
  await Promise.all([loadAssociationBundle(), loadLabPartCrosswalk(), loadIcd10Crosswalk()]);
}

export function associationsLoaded(): boolean {
  return bundlePromise !== null;
}

/** Test-only: inject parsed data directly, bypassing fetch. */
export function setAssociationsForTest(
  data: {
    bundle?: AssociationBundle | null;
    labParts?: LabPartCrosswalk | null;
    icd10?: Icd10Crosswalk | null;
  } | null
): void {
  bundlePromise = data?.bundle ? Promise.resolve(data.bundle) : null;
  labPartsPromise = data?.labParts ? Promise.resolve(data.labParts) : null;
  icd10Promise = data?.icd10 ? Promise.resolve(data.icd10) : null;
}
