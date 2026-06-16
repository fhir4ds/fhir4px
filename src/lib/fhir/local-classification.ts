import type { GroupableRecord, PatientObservationBucket } from "./patient-groups";

export type AllergyAssertionType = "specific_allergy" | "negative_assertion" | "unknown";
export type AllergyDomain = "generic" | "drug" | "food" | "environmental" | "latex" | "other" | "unknown";
export type EncounterVisitClass =
  | "inpatient"
  | "outpatient"
  | "emergency"
  | "urgent_care"
  | "telehealth"
  | "procedure"
  | "home_health"
  | "other"
  | "unknown";
export type LocalClassificationSource = "fhir_category" | "deterministic" | "local_model" | "embedding" | "fallback";

export interface AllergyClassification {
  assertionType: AllergyAssertionType;
  allergyDomain: AllergyDomain;
  confidence: number;
  fallback: boolean;
  source: LocalClassificationSource;
}

export interface EncounterVisitClassification {
  visitClass: EncounterVisitClass;
  confidence: number;
  fallback: boolean;
  source: LocalClassificationSource;
}

export interface ObservationCategoryClassification {
  observationCategory: PatientObservationBucket | "unknown";
  confidence: number;
  fallback: boolean;
  source: LocalClassificationSource;
}

function normalizedText(value?: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordConceptText(record: GroupableRecord): string {
  return normalizedText(
    [
      record.sourceLabel,
      record.groupingText,
      record.category,
      record.categoryCode,
      ...(record.codeTexts ?? []),
      ...(record.codeCodings ?? []).flatMap((coding) => [coding.code, coding.display]),
      ...(record.codingKeys ?? [])
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

const NEGATIVE_ALLERGY_PATTERNS: Array<{ domain: AllergyDomain; patterns: RegExp[] }> = [
  {
    domain: "drug",
    patterns: [
      /\bnkda\b/,
      /\bno known drug allerg(y|ies)\b/,
      /\bno known medication allerg(y|ies)\b/,
      /\bno known medicine allerg(y|ies)\b/,
      /\bno drug allerg(y|ies)\b/,
      /\bno medication allerg(y|ies)\b/
    ]
  },
  {
    domain: "food",
    patterns: [/\bno known food allerg(y|ies)\b/, /\bno food allerg(y|ies)\b/]
  },
  {
    domain: "environmental",
    patterns: [
      /\bno known environmental allerg(y|ies)\b/,
      /\bno environmental allerg(y|ies)\b/,
      /\bno known seasonal allerg(y|ies)\b/,
      /\bno seasonal allerg(y|ies)\b/
    ]
  },
  {
    domain: "latex",
    patterns: [/\bno known latex allerg(y|ies)\b/, /\bno latex allerg(y|ies)\b/]
  },
  {
    domain: "generic",
    patterns: [/\bnka\b/, /\bno known allerg(y|ies)\b/, /\bno allerg(y|ies)\b/, /\bno known adverse reactions?\b/]
  }
];

const SPECIFIC_ALLERGY_DOMAIN_PATTERNS: Array<{ domain: AllergyDomain; patterns: RegExp[] }> = [
  {
    domain: "latex",
    patterns: [/\blatex\b/]
  },
  {
    domain: "drug",
    patterns: [
      /\bpenicillin\b/,
      /\bamoxicillin\b/,
      /\bampicillin\b/,
      /\bcephalosporin\b/,
      /\bcef[a-z]+\b/,
      /\bsulfa\b/,
      /\bsulfonamide\b/,
      /\baspirin\b/,
      /\bibuprofen\b/,
      /\bnaproxen\b/,
      /\bnsaid\b/,
      /\bcodeine\b/,
      /\bmorphine\b/,
      /\bopioid\b/,
      /\bdrug\b/,
      /\bmedication\b/,
      /\bmedicine\b/,
      /\bantibiotic\b/
    ]
  },
  {
    domain: "food",
    patterns: [
      /\bpeanut\b/,
      /\btree nut\b/,
      /\bnut\b/,
      /\bshellfish\b/,
      /\bshrimp\b/,
      /\bmilk\b/,
      /\begg\b/,
      /\bwheat\b/,
      /\bsoy\b/,
      /\bfish\b/,
      /\bfood\b/
    ]
  },
  {
    domain: "environmental",
    patterns: [
      /\bpollen\b/,
      /\bdust\b/,
      /\bmold\b/,
      /\bcat\b/,
      /\bdog\b/,
      /\bgrass\b/,
      /\bragweed\b/,
      /\bseasonal\b/,
      /\benvironmental\b/
    ]
  }
];

export function deterministicAllergyClassification(record: GroupableRecord): AllergyClassification {
  const text = recordConceptText(record);
  if (!text) {
    return {
      assertionType: "unknown",
      allergyDomain: "unknown",
      confidence: 0.35,
      fallback: true,
      source: "fallback"
    };
  }

  for (const entry of NEGATIVE_ALLERGY_PATTERNS) {
    if (hasAny(text, entry.patterns)) {
      return {
        assertionType: "negative_assertion",
        allergyDomain: entry.domain,
        confidence: 0.92,
        fallback: false,
        source: "deterministic"
      };
    }
  }

  for (const entry of SPECIFIC_ALLERGY_DOMAIN_PATTERNS) {
    if (hasAny(text, entry.patterns)) {
      return {
        assertionType: "specific_allergy",
        allergyDomain: entry.domain,
        confidence: 0.82,
        fallback: false,
        source: "deterministic"
      };
    }
  }

  return {
    assertionType: "specific_allergy",
    allergyDomain: "unknown",
    confidence: 0.45,
    fallback: true,
    source: "fallback"
  };
}

function normalizedObservationCategory(record: GroupableRecord): string {
  return normalizedText(record.categoryCode || record.category).replace(/\s+/g, "-");
}

export function deterministicObservationCategoryClassification(
  record: GroupableRecord
): ObservationCategoryClassification {
  const category = normalizedObservationCategory(record);
  if (category === "laboratory" || category === "lab") {
    return { observationCategory: "labs", confidence: 1, fallback: false, source: "fhir_category" };
  }
  if (category === "vital-signs" || category === "vital-sign" || category === "vitals") {
    return { observationCategory: "vitals", confidence: 1, fallback: false, source: "fhir_category" };
  }
  if (category) {
    return { observationCategory: "other", confidence: 0.9, fallback: false, source: "fhir_category" };
  }

  const text = recordConceptText(record);
  if (
    hasAny(text, [
      /\bblood pressure\b/,
      /\bsystolic\b/,
      /\bdiastolic\b/,
      /\bheart rate\b/,
      /\bpulse\b/,
      /\btemperature\b/,
      /\bweight\b/,
      /\bheight\b/,
      /\bbmi\b/,
      /\boxygen saturation\b/
    ])
  ) {
    return { observationCategory: "vitals", confidence: 0.78, fallback: false, source: "deterministic" };
  }

  if (
    hasAny(text, [
      /\bhemoglobin\b/,
      /\ba1c\b/,
      /\bglucose\b/,
      /\bcreatinine\b/,
      /\bcholesterol\b/,
      /\btriglyceride\b/,
      /\bvitamin\b/,
      /\bplatelet\b/,
      /\bwbc\b/,
      /\blab\b/,
      /\blaboratory\b/
    ])
  ) {
    return { observationCategory: "labs", confidence: 0.75, fallback: false, source: "deterministic" };
  }

  return { observationCategory: "unknown", confidence: 0.4, fallback: true, source: "fallback" };
}

export function deterministicEncounterVisitClassification(record: GroupableRecord): EncounterVisitClassification {
  const text = recordConceptText(record);
  if (!text) return { visitClass: "unknown", confidence: 0.35, fallback: true, source: "fallback" };

  if (hasAny(text, [/\btelehealth\b/, /\btelemedicine\b/, /\bvirtual\b/, /\bvideo visit\b/, /\btelephone\b/])) {
    return { visitClass: "telehealth", confidence: 0.86, fallback: false, source: "deterministic" };
  }
  if (hasAny(text, [/\burgent care\b/])) {
    return { visitClass: "urgent_care", confidence: 0.86, fallback: false, source: "deterministic" };
  }
  if (hasAny(text, [/\bemergency\b/, /\bed\b/, /\bemer\b/])) {
    return { visitClass: "emergency", confidence: 0.86, fallback: false, source: "deterministic" };
  }
  if (hasAny(text, [/\binpatient\b/, /\bhospital stay\b/, /\bhospitalization\b/, /\bimp\b/])) {
    return { visitClass: "inpatient", confidence: 0.84, fallback: false, source: "deterministic" };
  }
  if (hasAny(text, [/\bhome health\b/, /\bhome visit\b/, /\bhh\b/])) {
    return { visitClass: "home_health", confidence: 0.84, fallback: false, source: "deterministic" };
  }
  if (hasAny(text, [/\bsurgery\b/, /\bsurgical\b/, /\bprocedure\b/, /\boperative\b/])) {
    return { visitClass: "procedure", confidence: 0.78, fallback: false, source: "deterministic" };
  }
  if (hasAny(text, [/\boutpatient\b/, /\bambulatory\b/, /\boffice visit\b/, /\bclinic\b/, /\bamb\b/])) {
    return { visitClass: "outpatient", confidence: 0.82, fallback: false, source: "deterministic" };
  }

  return { visitClass: "unknown", confidence: 0.4, fallback: true, source: "fallback" };
}

export function allergyNegativeAssertionSuperseded(
  classification: AllergyClassification,
  activeSpecificDomains: Set<AllergyDomain>
): boolean {
  if (classification.assertionType !== "negative_assertion") return false;
  if (classification.allergyDomain === "generic") return activeSpecificDomains.size > 0;
  if (classification.allergyDomain === "unknown") return false;
  return activeSpecificDomains.has(classification.allergyDomain);
}

export function visitClassLabel(value: EncounterVisitClass): string {
  switch (value) {
    case "inpatient":
      return "Inpatient";
    case "outpatient":
      return "Outpatient";
    case "emergency":
      return "Emergency";
    case "urgent_care":
      return "Urgent care";
    case "telehealth":
      return "Telehealth";
    case "procedure":
      return "Procedure";
    case "home_health":
      return "Home health";
    case "other":
      return "Other";
    case "unknown":
      return "Unknown";
  }
}
