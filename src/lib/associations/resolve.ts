/**
 * Resolve FHIR-coded items to association CIDs and concept keys.
 *
 * Resolution order per resource type (most authoritative first):
 *   Medication — product CID (RXNORM:{code}) → canonical code → ingredient
 *                decomposition → by_name fallback
 *   Condition  — SNOMED anchor → ICD-10 anchor (exact) → ICD-10 3-char
 *                category → ICD-10→SNOMED crosswalk → by_name fallback
 *   Lab        — LOINC test code → part CIDs via crosswalk (labs are bucket
 *                members, not concepts, so they resolve to part CID sets)
 *   Immunization — CVX anchor → by_name fallback
 *   Procedure  — SNOMED anchor → by_name fallback
 */

import type { GroupableRecord, PatientFriendlyGroup } from "../fhir/patient-groups";
import { getIngredientsForRxnormCode } from "../fhir/rxnorm-decomposition";
import { loadAssociationBundle, loadIcd10Crosswalk, loadLabPartCrosswalk } from "./bundle";

export interface GroupConceptResolution {
  /** Concept key for clickable concepts (meds, conditions, procedures, vaccines). */
  conceptKey?: string;
  /** Candidate CIDs for labs/vitals — LP parts from the crosswalk plus
   *  identity CIDs (VAL-LAB/VAL-VIT) — matched against concept lab and
   *  vital buckets. */
  labPartCids?: string[];
  /** Which CID produced the conceptKey, for diagnostics. */
  resolvedVia?: string;
}

function codingKeysOfSystem(records: GroupableRecord[], system: string): string[] {
  const prefix = `${system}:`;
  const codes = new Set<string>();
  for (const record of records) {
    for (const key of record.codingKeys ?? []) {
      if (key.startsWith(prefix)) codes.add(key.slice(prefix.length));
    }
  }
  return [...codes];
}

function conceptForCid(byCid: Record<string, string>, cid: string): string | undefined {
  return byCid[cid] ?? undefined;
}

function byNameConcept(
  byCid: Record<string, string>,
  byName: Record<string, string>,
  name: string
): { conceptKey: string; via: string } | undefined {
  const cid = byName[name.toLowerCase()];
  if (!cid) return undefined;
  const conceptKey = byCid[cid];
  return conceptKey ? { conceptKey, via: cid } : undefined;
}

function icd10CategoryCode(code: string): string | undefined {
  // E11.65 → E11 (3-character category); E11 stays E11.
  if (!/^[A-Z]\d{2}/.test(code)) return undefined;
  return code.slice(0, 3);
}

async function resolveCondition(
  records: GroupableRecord[],
  group: PatientFriendlyGroup
): Promise<{ conceptKey: string; via: string } | undefined> {
  const [bundle, crosswalk] = await Promise.all([loadAssociationBundle(), loadIcd10Crosswalk()]);
  const byCid = bundle.by_cid;

  for (const code of codingKeysOfSystem(records, "snomed")) {
    const conceptKey = conceptForCid(byCid, `VAL-COND-SNOMED-${code}`);
    if (conceptKey) return { conceptKey, via: `VAL-COND-SNOMED-${code}` };
  }

  const icd10Codes = codingKeysOfSystem(records, "icd10cm");
  if (group.canonicalCode?.system === "icd10" && group.canonicalCode.code) {
    icd10Codes.unshift(group.canonicalCode.code);
  }
  for (const code of icd10Codes) {
    const exact = conceptForCid(byCid, `VAL-COND-ICD10CM-${code}`);
    if (exact) return { conceptKey: exact, via: `VAL-COND-ICD10CM-${code}` };
    const snomedAnchor = crosswalk[`VAL-COND-ICD10CM-${code}`];
    if (snomedAnchor) {
      const viaCrosswalk = conceptForCid(byCid, snomedAnchor);
      if (viaCrosswalk) return { conceptKey: viaCrosswalk, via: snomedAnchor };
    }
    const category = icd10CategoryCode(code);
    if (category && category !== code) {
      const viaCategory = conceptForCid(byCid, `VAL-COND-ICD10CM-${category}`);
      if (viaCategory) return { conceptKey: viaCategory, via: `VAL-COND-ICD10CM-${category}` };
      const categoryAnchor = crosswalk[`VAL-COND-ICD10CM-${category}`];
      if (categoryAnchor) {
        const viaCategoryCrosswalk = conceptForCid(byCid, categoryAnchor);
        if (viaCategoryCrosswalk) return { conceptKey: viaCategoryCrosswalk, via: categoryAnchor };
      }
    }
  }

  return byNameConcept(byCid, bundle.by_name, group.patientFriendlyName);
}

async function resolveMedication(
  records: GroupableRecord[],
  group: PatientFriendlyGroup
): Promise<{ conceptKey: string; via: string } | undefined> {
  const bundle = await loadAssociationBundle();
  const byCid = bundle.by_cid;

  const productCodes = codingKeysOfSystem(records, "rxnorm");
  if (group.canonicalCode?.system === "rxnorm" && group.canonicalCode.code) {
    productCodes.unshift(group.canonicalCode.code);
  }
  for (const code of productCodes) {
    const conceptKey = conceptForCid(byCid, `RXNORM:${code}`);
    if (conceptKey) return { conceptKey, via: `RXNORM:${code}` };
  }

  for (const code of productCodes) {
    const ingredients = await getIngredientsForRxnormCode(code);
    for (const ingredient of ingredients) {
      const conceptKey = conceptForCid(byCid, `VAL-MED-RXNORM-${ingredient.code}`);
      if (conceptKey) return { conceptKey, via: `VAL-MED-RXNORM-${ingredient.code}` };
    }
  }

  return byNameConcept(byCid, bundle.by_name, group.patientFriendlyName);
}

async function resolveLabParts(records: GroupableRecord[], group: PatientFriendlyGroup): Promise<string[]> {
  const crosswalk = await loadLabPartCrosswalk();
  const codes = codingKeysOfSystem(records, "loinc");
  if (group.canonicalCode?.system === "loinc" && group.canonicalCode.code) {
    codes.unshift(group.canonicalCode.code);
  }
  const parts = new Set<string>();
  for (const code of codes) {
    for (const part of crosswalk[`VAL-LAB-LOINC-${code}`] ?? []) parts.add(part);
    // Bucket members reference labs two ways the crosswalk doesn't cover:
    // direct test-code CIDs (e.g. VAL-LAB-LOINC-6301-6 for INR) and vital
    // members keyed VAL-VIT-LOINC-{code} (BP, HR, O2 sat). Emit identity
    // CIDs alongside the parts so both member forms can match.
    parts.add(`VAL-LAB-LOINC-${code}`);
    parts.add(`VAL-VIT-LOINC-${code}`);
  }
  return [...parts];
}

async function resolveAnchorPrefixed(
  records: GroupableRecord[],
  group: PatientFriendlyGroup,
  prefix: string,
  system: string
): Promise<{ conceptKey: string; via: string } | undefined> {
  const bundle = await loadAssociationBundle();
  const byCid = bundle.by_cid;
  for (const code of codingKeysOfSystem(records, system)) {
    const conceptKey = conceptForCid(byCid, `${prefix}${code}`);
    if (conceptKey) return { conceptKey, via: `${prefix}${code}` };
  }
  return byNameConcept(byCid, bundle.by_name, group.patientFriendlyName);
}

/** Resolve a patient group to its association concept key or lab part CIDs. */
export async function resolveGroupConcept(
  group: PatientFriendlyGroup,
  memberRecords: GroupableRecord[]
): Promise<GroupConceptResolution> {
  try {
    if (group.resourceTypes.includes("MedicationRequest")) {
      const resolved = await resolveMedication(memberRecords, group);
      return resolved ? { conceptKey: resolved.conceptKey, resolvedVia: resolved.via } : {};
    }
    if (group.resourceTypes.includes("Condition")) {
      const resolved = await resolveCondition(memberRecords, group);
      return resolved ? { conceptKey: resolved.conceptKey, resolvedVia: resolved.via } : {};
    }
    if (group.resourceTypes.includes("Observation")) {
      return { labPartCids: await resolveLabParts(memberRecords, group) };
    }
    if (group.resourceTypes.includes("Immunization")) {
      const resolved = await resolveAnchorPrefixed(memberRecords, group, "VAL-VAX-CVX-", "cvx");
      return resolved ? { conceptKey: resolved.conceptKey, resolvedVia: resolved.via } : {};
    }
    if (group.resourceTypes.includes("Procedure")) {
      const resolved = await resolveAnchorPrefixed(memberRecords, group, "VAL-PROC-SNOMED-", "snomed");
      return resolved ? { conceptKey: resolved.conceptKey, resolvedVia: resolved.via } : {};
    }
  } catch {
    // Association data unavailable — resolution stays empty; UI falls back to
    // the existing relationship cache.
  }
  return {};
}
