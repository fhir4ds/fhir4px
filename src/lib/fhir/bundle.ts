import type { FhirResource } from "../smart/data";
import type { PatientPatch } from "./patches";

export interface LocalReferralBundle {
  resourceType: "Bundle";
  type: "collection";
  timestamp: string;
  entry: Array<{
    fullUrl: string;
    resource: FhirResource | PatientPatch;
  }>;
}

export function createLocalReferralBundle(resources: FhirResource[], patches: PatientPatch[] = []): LocalReferralBundle {
  const entries = [
    ...resources.map((resource) => ({
      fullUrl: `${resource.resourceType}/${resource.id || crypto.randomUUID()}`,
      resource
    })),
    ...patches.map((patch) => ({
      fullUrl: `PatientPatch/${patch.id}`,
      resource: patch
    }))
  ];

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries
  };
}
