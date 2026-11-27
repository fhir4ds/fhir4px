/**
 * Delete one portal's local data, leaving the others intact: the connection,
 * its token and session, the records fetched from it, the groupings and edits
 * made to those records, and the care-gap dismissals of its patient.
 *
 * Records the user added themselves are not tied to a portal and stay. The
 * legacy "current" session pointer, which the quality evaluation reads when
 * nothing scopes it, is moved to a portal that still exists.
 */

import type { CareGapDismissal } from "../fhir/care-gaps";
import type { PatientPatch } from "../fhir/patches";
import type { FhirDataset } from "../smart/data";
import { CURRENT_SOURCE_ID, getSourceCredentials, isPortalSource, listConnectedSources } from "../smart/sources";
import { getOrCreateSessionVaultKey } from "./keys";
import { localVault, type LocalVault } from "./store";

export interface DeleteSourceResult {
  /** False when the portal was not connected any more. */
  deleted: boolean;
  /** Portals left after the deletion. */
  remaining: number;
}

/** Records carry their portal in the id ("<source id>:<resource id>"). */
function belongsToSource(recordId: string, sourceId: string): boolean {
  return recordId.startsWith(`${sourceId}:`);
}

export async function deleteSourceData(
  sourceId: string,
  options: { vault?: LocalVault; key?: CryptoKey } = {}
): Promise<DeleteSourceResult> {
  const vault = options.vault ?? localVault;
  const key = options.key ?? (await getOrCreateSessionVaultKey());
  const sources = await listConnectedSources(key, vault);
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (!source) return { deleted: false, remaining: sources.length };

  const dataset = await vault.getJson<FhirDataset>(key, { type: "source-dataset", id: source.id });
  const patientId = typeof dataset?.patient?.id === "string" ? dataset.patient.id : null;

  for (const patch of await vault.listJson<PatientPatch>(key, "patient-patch")) {
    if (belongsToSource(patch.targetResourceId, source.id)) {
      await vault.delete({ type: "patient-patch", id: patch.id });
    }
  }
  if (patientId) {
    for (const dismissal of await vault.listJson<CareGapDismissal>(key, "care-gap-dismissal")) {
      if (dismissal.patientId === patientId) {
        await vault.delete({ type: "care-gap-dismissal", id: dismissal.id });
      }
    }
  }

  await vault.delete({ type: "smart-source", id: source.id });
  if (source.kind === "portal") {
    await vault.delete({ type: "smart-token", id: source.tokenRef });
    await vault.delete({ type: "smart-session", id: source.sessionRef });
  }
  await vault.delete({ type: "source-dataset", id: source.id });

  // The legacy pointer has to name a portal: a received Bundle has nothing to fetch.
  const remaining = sources.filter((candidate) => candidate.id !== source.id);
  const remainingPortals = remaining.filter(isPortalSource);
  if (remainingPortals.length > 0) {
    const credentials = await getSourceCredentials(key, remainingPortals[0], vault);
    await vault.putJson(key, { type: "smart-token", id: CURRENT_SOURCE_ID }, credentials.token);
    await vault.putJson(key, { type: "smart-session", id: CURRENT_SOURCE_ID }, credentials.session);
  } else {
    await vault.delete({ type: "smart-token", id: CURRENT_SOURCE_ID });
    await vault.delete({ type: "smart-session", id: CURRENT_SOURCE_ID });
  }

  return { deleted: true, remaining: remaining.length };
}
