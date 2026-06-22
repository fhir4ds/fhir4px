/**
 * Condition association lookup — code-keyed.
 *
 * Replaces the old name-keyed condition-medication-lookup.ts and
 * condition-lab-lookup.ts. Loads condition_associations.json which is
 * keyed by bare condition code (ICD-10 or SNOMED) and contains
 * labs (LOINC codes) and medications (RxNorm ingredient codes) with
 * strength and relationship tags.
 *
 * For medication → condition reverse lookup, uses rxnorm-ingredients.json
 * to decompose product codes to ingredient codes, then scans for
 * conditions that list those ingredients.
 */

import { getIngredientsForRxnormCode } from "./rxnorm-decomposition";

export type AssociationStrength = "strong" | "moderate" | "weak";
export type MedicationRelationship = "treats" | "prevents";

interface LabAssociation {
  code: string;
  strength: AssociationStrength;
}

interface MedicationAssociation {
  code: string;
  strength: AssociationStrength;
  relationship: MedicationRelationship;
  depth?: number;
}

interface ConditionAssociation {
  labs: LabAssociation[];
  medications: MedicationAssociation[];
}

type AssociationTable = Record<string, ConditionAssociation>;

interface AssociationFile {
  _meta?: unknown;
  [key: string]: unknown;
}

let tablePromise: Promise<AssociationTable | null> | null = null;

async function loadTable(): Promise<AssociationTable | null> {
  if (tablePromise) return tablePromise;
  tablePromise = (async () => {
    try {
      const response = await fetch("/terminology/condition_associations.json");
      if (!response.ok) {
        throw new Error(`Failed to load condition_associations.json: ${response.status}`);
      }
      const raw = (await response.json()) as AssociationFile;
      const { _meta, ...rest } = raw;
      void _meta;
      return rest as AssociationTable;
    } catch (err) {
      console.warn("[fhir4px:associations]", {
        event: "load-failed",
        error: err instanceof Error ? err.message : String(err)
      });
      return null;
    }
  })();
  return tablePromise;
}

/**
 * Get lab LOINC codes associated with a condition.
 * Returns empty array if condition not in table.
 */
export async function getLabsForCondition(
  conditionCode: string,
  minStrength: AssociationStrength = "moderate"
): Promise<Array<{ code: string; strength: AssociationStrength }>> {
  const table = await loadTable();
  if (!table) return [];
  const entry = table[conditionCode];
  if (!entry?.labs) return [];
  return entry.labs.filter((lab) => strengthRank(lab.strength) >= strengthRank(minStrength));
}

/**
 * Get medication ingredient codes that treat/prevent a condition.
 * Returns empty array if condition not in table.
 */
export async function getMedicationsForCondition(
  conditionCode: string,
  minStrength: AssociationStrength = "moderate"
): Promise<Array<{ code: string; strength: AssociationStrength; relationship: MedicationRelationship }>> {
  const table = await loadTable();
  if (!table) return [];
  const entry = table[conditionCode];
  if (!entry?.medications) return [];
  return entry.medications.filter((med) => strengthRank(med.strength) >= strengthRank(minStrength));
}

/**
 * Find conditions treated by a medication (reverse lookup).
 * Accepts a product code — decomposes to ingredient codes first.
 * Returns condition codes with the strength of the match.
 */
export async function findConditionsForMedication(
  medicationCode: string,
  options?: { ingredients?: string[] }
): Promise<Array<{ conditionCode: string; strength: AssociationStrength }>> {
  const table = await loadTable();
  if (!table) return [];

  let ingredientCodes = options?.ingredients ?? [];
  if (ingredientCodes.length === 0) {
    const ingredients = await getIngredientsForRxnormCode(medicationCode);
    ingredientCodes = ingredients.map((i) => i.code);
  }
  if (ingredientCodes.length === 0) ingredientCodes = [medicationCode];

  const ingredientSet = new Set(ingredientCodes);
  const results: Array<{ conditionCode: string; strength: AssociationStrength }> = [];

  for (const [conditionCode, assoc] of Object.entries(table)) {
    if (!assoc?.medications) continue;
    let bestStrength: AssociationStrength | null = null;
    for (const med of assoc.medications) {
      if (ingredientSet.has(med.code)) {
        if (!bestStrength || strengthRank(med.strength) > strengthRank(bestStrength)) {
          bestStrength = med.strength;
        }
      }
    }
    if (bestStrength) {
      results.push({ conditionCode, strength: bestStrength });
    }
  }

  return results;
}

/**
 * Find conditions monitored by a lab (reverse lookup).
 */
export async function findConditionsForLab(
  loincCode: string
): Promise<Array<{ conditionCode: string; strength: AssociationStrength }>> {
  const table = await loadTable();
  if (!table) return [];

  const results: Array<{ conditionCode: string; strength: AssociationStrength }> = [];

  for (const [conditionCode, assoc] of Object.entries(table)) {
    if (!assoc?.labs) continue;
    for (const lab of assoc.labs) {
      if (lab.code === loincCode) {
        results.push({ conditionCode, strength: lab.strength });
        break;
      }
    }
  }

  return results;
}

function strengthRank(strength: AssociationStrength): number {
  return strength === "strong" ? 3 : strength === "moderate" ? 2 : 1;
}

/** Test-only */
export function setAssociationTableForTest(table: AssociationTable | null): void {
  tablePromise = table ? Promise.resolve(table) : null;
}
