import type { FhirResource } from "../smart/data";
import type { GroupableResourceType, PatientFriendlyGroup } from "./patient-groups";

export type RelationshipSource = "fhir_reference" | "local_model";
export type ExplicitRelationshipKind =
  | "encounter"
  | "reason"
  | "diagnosis"
  | "result"
  | "derived_from"
  | "has_member"
  | "based_on"
  | "part_of";
export type SuggestedGroupRelationshipKind = "monitoring_marker" | "potentially_related" | "none";

export interface RecordRelationship {
  id: string;
  sourceRecordKey: string;
  targetRecordKey: string;
  sourceResourceType: GroupableResourceType;
  targetResourceType: GroupableResourceType;
  kind: ExplicitRelationshipKind;
  label: string;
  source: RelationshipSource;
}

export interface RelationshipResourceSource {
  sourceId: string;
  resources: FhirResource[];
}

export interface LabConditionAssociation {
  conditionGroupId: string;
  relationship: Exclude<SuggestedGroupRelationshipKind, "none">;
  confidence: number;
  fallback: boolean;
}

export interface SuggestedGroupRelationship {
  sourceGroupId: string;
  targetGroupId: string;
  sourceResourceType: GroupableResourceType;
  targetResourceType: GroupableResourceType;
  relationship: SuggestedGroupRelationshipKind;
  confidence: number;
  fallback: boolean;
  model: string;
  updatedAt: number;
}

const GROUPABLE_RESOURCE_TYPES = new Set<GroupableResourceType>([
  "MedicationRequest",
  "AllergyIntolerance",
  "Condition",
  "Observation",
  "Immunization",
  "Encounter",
  "Procedure",
  "DiagnosticReport"
]);

type ReferenceLike = { reference?: unknown; display?: unknown };

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function relationshipRecordKey(resourceType: string, id: string): string {
  return `${resourceType}/${id}`;
}

export function relationshipGroupKey(group: PatientFriendlyGroup): string {
  return `${group.resourceTypes.slice().sort().join("+")}:${group.groupId}`;
}

export function otherRelationshipRecordKey(relationship: RecordRelationship, currentRecordKey: string): string {
  return relationship.sourceRecordKey === currentRecordKey ? relationship.targetRecordKey : relationship.sourceRecordKey;
}

export function relationshipMapByRecordKey(relationships: RecordRelationship[]): Map<string, RecordRelationship[]> {
  const map = new Map<string, RecordRelationship[]>();
  for (const relationship of relationships) {
    map.set(relationship.sourceRecordKey, [...(map.get(relationship.sourceRecordKey) ?? []), relationship]);
    map.set(relationship.targetRecordKey, [...(map.get(relationship.targetRecordKey) ?? []), relationship]);
  }
  return map;
}

function relationshipKindBetween(
  relationshipsByRecordKey: Map<string, RecordRelationship[]>,
  currentRecordKey: string,
  relatedRecordKey: string,
  allowedKinds: ExplicitRelationshipKind[]
): boolean {
  return (relationshipsByRecordKey.get(currentRecordKey) ?? []).some(
    (relationship) =>
      allowedKinds.includes(relationship.kind) &&
      otherRelationshipRecordKey(relationship, currentRecordKey) === relatedRecordKey
  );
}

function conditionRecordKeysLinkedFromEncounter(
  encounterRecordKey: string,
  relationshipsByRecordKey: Map<string, RecordRelationship[]>
): string[] {
  const conditionKeys = new Set<string>();
  for (const relationship of relationshipsByRecordKey.get(encounterRecordKey) ?? []) {
    if (!["reason", "diagnosis"].includes(relationship.kind)) continue;
    const relatedKey = otherRelationshipRecordKey(relationship, encounterRecordKey);
    if (relatedKey.startsWith("Condition/")) conditionKeys.add(relatedKey);
  }
  return [...conditionKeys].sort();
}

export function conditionRecordKeysLinkedFromObservation(
  observationRecordKey: string,
  relationshipsByRecordKey: Map<string, RecordRelationship[]>
): string[] {
  const conditionKeys = new Set<string>();
  const directRelationships = relationshipsByRecordKey.get(observationRecordKey) ?? [];

  for (const relationship of directRelationships) {
    const relatedKey = otherRelationshipRecordKey(relationship, observationRecordKey);
    if (relatedKey.startsWith("Condition/")) {
      conditionKeys.add(relatedKey);
      continue;
    }

    if (relationship.kind === "encounter" && relatedKey.startsWith("Encounter/")) {
      for (const conditionKey of conditionRecordKeysLinkedFromEncounter(relatedKey, relationshipsByRecordKey)) {
        conditionKeys.add(conditionKey);
      }
      continue;
    }

    if (relationship.kind === "result" && relatedKey.startsWith("DiagnosticReport/")) {
      for (const reportRelationship of relationshipsByRecordKey.get(relatedKey) ?? []) {
        const reportRelatedKey = otherRelationshipRecordKey(reportRelationship, relatedKey);
        if (reportRelatedKey.startsWith("Condition/")) {
          conditionKeys.add(reportRelatedKey);
          continue;
        }
        if (
          reportRelationship.kind === "encounter" &&
          reportRelatedKey.startsWith("Encounter/") &&
          relationshipKindBetween(relationshipsByRecordKey, relatedKey, reportRelatedKey, ["encounter"])
        ) {
          for (const conditionKey of conditionRecordKeysLinkedFromEncounter(reportRelatedKey, relationshipsByRecordKey)) {
            conditionKeys.add(conditionKey);
          }
        }
      }
    }
  }

  return [...conditionKeys].sort();
}

function scopedResourceId(sourceId: string, id: string): string {
  return `${sourceId}:${id}`;
}

function resourceId(resource: FhirResource): string | undefined {
  return typeof resource.id === "string" && resource.id.trim() ? resource.id.trim() : undefined;
}

function groupableType(value: unknown): GroupableResourceType | undefined {
  return typeof value === "string" && GROUPABLE_RESOURCE_TYPES.has(value as GroupableResourceType)
    ? (value as GroupableResourceType)
    : undefined;
}

function localReferenceParts(reference: unknown): { resourceType: GroupableResourceType; id: string } | undefined {
  if (typeof reference !== "string" || !reference.trim() || reference.startsWith("#")) return undefined;
  const withoutQuery = reference.split("?")[0].replace(/\/_history\/[^/]+$/, "");
  const match = withoutQuery.match(/(?:^|\/)([A-Za-z]+)\/([^/]+)$/);
  if (!match) return undefined;
  const resourceType = groupableType(match[1]);
  const id = decodeURIComponent(match[2] ?? "").trim();
  return resourceType && id ? { resourceType, id } : undefined;
}

function referenceArray(value: unknown): ReferenceLike[] {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter((entry): entry is ReferenceLike => typeof entry === "object" && entry !== null);
}

function nestedReferenceArray(value: unknown, key: string): ReferenceLike[] {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    return referenceArray((entry as Record<string, unknown>)[key]);
  });
}

export function buildExplicitRecordRelationships(sources: RelationshipResourceSource[]): RecordRelationship[] {
  const available = new Set<string>();
  for (const source of sources) {
    for (const resource of source.resources) {
      const resourceType = groupableType(resource.resourceType);
      const id = resourceId(resource);
      if (resourceType && id) available.add(relationshipRecordKey(resourceType, scopedResourceId(source.sourceId, id)));
    }
  }

  const byId = new Map<string, RecordRelationship>();

  function addRelationship(params: {
    sourceId: string;
    sourceType: GroupableResourceType;
    sourceResourceId: string;
    reference: ReferenceLike;
    kind: ExplicitRelationshipKind;
    label: string;
  }) {
    const target = localReferenceParts(params.reference.reference);
    if (!target) return;
    const sourceRecordKey = relationshipRecordKey(params.sourceType, scopedResourceId(params.sourceId, params.sourceResourceId));
    const targetRecordKey = relationshipRecordKey(target.resourceType, scopedResourceId(params.sourceId, target.id));
    if (sourceRecordKey === targetRecordKey || !available.has(sourceRecordKey) || !available.has(targetRecordKey)) return;
    const id = stableHash(`${sourceRecordKey}|${targetRecordKey}|${params.kind}`);
    byId.set(id, {
      id,
      sourceRecordKey,
      targetRecordKey,
      sourceResourceType: params.sourceType,
      targetResourceType: target.resourceType,
      kind: params.kind,
      label: params.label,
      source: "fhir_reference"
    });
  }

  function addRelationships(
    sourceId: string,
    resource: FhirResource,
    kind: ExplicitRelationshipKind,
    label: string,
    references: ReferenceLike[]
  ) {
    const sourceType = groupableType(resource.resourceType);
    const sourceResourceId = resourceId(resource);
    if (!sourceType || !sourceResourceId) return;
    for (const reference of references) addRelationship({ sourceId, sourceType, sourceResourceId, reference, kind, label });
  }

  for (const source of sources) {
    for (const resource of source.resources) {
      switch (resource.resourceType) {
        case "Observation":
          addRelationships(source.sourceId, resource, "encounter", "Observed during visit", referenceArray(resource.encounter));
          addRelationships(source.sourceId, resource, "derived_from", "Derived from", referenceArray(resource.derivedFrom));
          addRelationships(source.sourceId, resource, "has_member", "Includes result", referenceArray(resource.hasMember));
          addRelationships(source.sourceId, resource, "based_on", "Ordered from", referenceArray(resource.basedOn));
          break;
        case "DiagnosticReport":
          addRelationships(source.sourceId, resource, "encounter", "Reported during visit", referenceArray(resource.encounter));
          addRelationships(source.sourceId, resource, "result", "Report result", referenceArray(resource.result));
          addRelationships(source.sourceId, resource, "based_on", "Ordered from", referenceArray(resource.basedOn));
          break;
        case "Encounter":
          addRelationships(source.sourceId, resource, "reason", "Visit reason", referenceArray(resource.reasonReference));
          addRelationships(source.sourceId, resource, "diagnosis", "Visit diagnosis", nestedReferenceArray(resource.diagnosis, "condition"));
          addRelationships(source.sourceId, resource, "part_of", "Part of visit", referenceArray(resource.partOf));
          break;
        case "Procedure":
          addRelationships(source.sourceId, resource, "encounter", "Performed during visit", referenceArray(resource.encounter));
          addRelationships(source.sourceId, resource, "reason", "Procedure reason", referenceArray(resource.reasonReference));
          addRelationships(source.sourceId, resource, "based_on", "Ordered from", referenceArray(resource.basedOn));
          break;
        case "MedicationRequest":
          addRelationships(source.sourceId, resource, "encounter", "Ordered during visit", referenceArray(resource.encounter));
          addRelationships(source.sourceId, resource, "reason", "Medication reason", referenceArray(resource.reasonReference));
          addRelationships(source.sourceId, resource, "based_on", "Ordered from", referenceArray(resource.basedOn));
          break;
        case "Immunization":
          addRelationships(source.sourceId, resource, "encounter", "Given during visit", referenceArray(resource.encounter));
          break;
      }
    }
  }

  return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}
