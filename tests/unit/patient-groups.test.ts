import { describe, expect, it } from "vitest";
import {
  compactRecordsForModel,
  deterministicPatientGrouping,
  expandCompactGrouping,
  validateGroupingResult,
  type GroupableRecord
} from "../../src/lib/fhir/patient-groups";

function record(overrides: Partial<GroupableRecord> & Pick<GroupableRecord, "id" | "resourceType" | "sourceLabel">): GroupableRecord {
  return {
    source: "provider",
    ...overrides
  };
}

const records: GroupableRecord[] = [
  record({
    id: "obs-a1c",
    resourceType: "Observation",
    sourceLabel: "Hemoglobin A1c/Hemoglobin.total in Blood",
    valueKind: "quantity",
    unit: "%"
  }),
  record({
    id: "obs-cr",
    resourceType: "Observation",
    sourceLabel: "Creatinine",
    valueKind: "quantity",
    unit: "mg/dL"
  })
];

describe("patient-friendly grouping", () => {
  it("keeps deterministic grouping limited to exact source labels when no coding exists", () => {
    const result = deterministicPatientGrouping(records);

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((group) => group.patientFriendlyName)).toEqual([
      "Creatinine",
      "Hemoglobin A1c/Hemoglobin.total in Blood"
    ]);
    expect(result.groups.every((group) => group.fallback)).toBe(true);
  });

  it("does not compact vaccine families beyond exact preferred codes", () => {
    const result = deterministicPatientGrouping([
      record({
        id: "imm-dtap-1",
        resourceType: "Immunization",
        sourceLabel: "DTaP, 5 pertussis antigens",
        codingKeys: ["cvx:20"]
      }),
      record({
        id: "imm-dtap-2",
        resourceType: "Immunization",
        sourceLabel: "Diphtheria, tetanus toxoids and acellular pertussis vaccine",
        codingKeys: ["cvx:106"]
      }),
      record({
        id: "imm-mmr-1",
        resourceType: "Immunization",
        sourceLabel: "Measles, mumps and rubella virus vaccine",
        codingKeys: ["cvx:03"]
      }),
      record({
        id: "imm-mmr-2",
        resourceType: "Immunization",
        sourceLabel: "MMR II",
        codingKeys: ["cvx:03"]
      })
    ]);

    expect(result.groups).toHaveLength(3);
    expect(result.groups.map((group) => group.groupId)).not.toContain("immunization-family-dtap");
    expect(result.groups.map((group) => group.groupId)).not.toContain("immunization-family-mmr");
    expect(result.groups.map((group) => group.resourceIds)).toEqual([
      ["imm-dtap-2"],
      ["imm-dtap-1"],
      ["imm-mmr-1", "imm-mmr-2"]
    ]);
  });

  it("compacts only identical source code/display/text concepts", () => {
    const result = deterministicPatientGrouping([
      record({
        id: "imm-mmr-1",
        resourceType: "Immunization",
        sourceLabel: "MMR II",
        codingKeys: ["cvx:03"],
        codeTexts: ["MMR II"],
        codeCodings: [{ code: "03", display: "MMR II" }]
      }),
      record({
        id: "imm-mmr-2",
        resourceType: "Immunization",
        sourceLabel: "MMR II",
        codingKeys: ["cvx:03"],
        codeTexts: ["MMR II"],
        codeCodings: [{ code: "03", display: "MMR II" }]
      })
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      resourceIds: ["imm-mmr-1", "imm-mmr-2"],
      fallback: false
    });
  });

  it("does not hardcode condition families across code systems", () => {
    const result = deterministicPatientGrouping([
      record({
        id: "cond-diabetes-snomed",
        resourceType: "Condition",
        sourceLabel: "Type 2 diabetes mellitus",
        codingKeys: ["snomed:44054006"]
      }),
      record({
        id: "cond-diabetes-icd10",
        resourceType: "Condition",
        sourceLabel: "Type 2 diabetes mellitus with hyperglycemia",
        codingKeys: ["icd10cm:E11.65"]
      }),
      record({
        id: "cond-htn",
        resourceType: "Condition",
        sourceLabel: "Hypertensive disorder",
        codingKeys: ["snomed:38341003"]
      })
    ]);

    expect(result.groups).toHaveLength(3);
    expect(result.groups.map((group) => group.groupId)).not.toContain("condition-family-type-2-diabetes");
    expect(result.groups.map((group) => group.groupId)).not.toContain("condition-family-high-blood-pressure");
  });

  it("does not hardcode common observation measurements from labels or related codes", () => {
    const result = deterministicPatientGrouping([
      record({
        id: "obs-a1c-code",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c/Hemoglobin.total in Blood",
        codingKeys: ["loinc:4548-4"]
      }),
      record({
        id: "obs-a1c-related-code",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c in Blood by HPLC",
        codingKeys: ["loinc:17856-6"]
      }),
      record({
        id: "obs-a1c-label",
        resourceType: "Observation",
        sourceLabel: "HbA1c"
      }),
      record({
        id: "obs-sbp",
        resourceType: "Observation",
        sourceLabel: "Systolic BP"
      })
    ]);

    expect(result.groups).toHaveLength(4);
    expect(result.groups.map((group) => group.groupId)).not.toContain("observation-measure-hemoglobin-a1c");
    expect(result.groups.map((group) => group.groupId)).not.toContain("observation-measure-systolic-blood-pressure");
  });

  it("groups medications by source ingredient plus route instead of dosage form", () => {
    const result = deterministicPatientGrouping([
      record({
        id: "metformin-500",
        resourceType: "MedicationRequest",
        sourceLabel: "Metformin 500 mg tablet",
        ingredients: ["Metformin"],
        dosageForm: "Oral tablet",
        route: "Oral"
      }),
      record({
        id: "metformin-er",
        resourceType: "MedicationRequest",
        sourceLabel: "Metformin ER tablet",
        ingredients: ["Metformin"],
        dosageForm: "Extended release tablet",
        route: "Oral"
      }),
      record({
        id: "metformin-topical",
        resourceType: "MedicationRequest",
        sourceLabel: "Metformin topical",
        ingredients: ["Metformin"],
        route: "Topical"
      })
    ]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups.find((group) => group.groupId === "medicationrequest-ingredient-route-metformin-oral")).toMatchObject({
      patientFriendlyName: "Metformin Oral",
      resourceIds: ["metformin-500", "metformin-er"]
    });
    expect(result.groups.map((group) => group.groupId)).not.toContain("medicationrequest-ingredient-form-metformin-oral-tablet");
  });

  it("rejects model output that references unknown records", () => {
    const fallback = deterministicPatientGrouping(records);
    const result = validateGroupingResult(
      records,
      {
        groups: [
          {
            groupId: "bad",
            patientFriendlyName: "Bad group",
            resourceIds: ["not-real"],
            confidence: 0.9,
            fallback: false
          }
        ]
      },
      fallback
    );

    expect(result).toBe(fallback);
  });

  it("accepts bounded structured output from a local grouping model", () => {
    const modelRecords: GroupableRecord[] = [
      record({
        id: "obs-alpha",
        resourceType: "Observation",
        sourceLabel: "Uncoded outside note",
        valueKind: "string"
      }),
      record({
        id: "obs-beta",
        resourceType: "Observation",
        sourceLabel: "Uncoded second note",
        valueKind: "string"
      })
    ];
    const fallback = deterministicPatientGrouping(modelRecords);
    const result = validateGroupingResult(
      modelRecords,
      {
        groups: [
          {
            groupId: "outside-notes",
            patientFriendlyName: "Outside Notes",
            resourceIds: ["obs-alpha"],
            resourceTypes: ["Observation"],
            confidence: 2,
            reason: "Same note family",
            fallback: false
          }
        ],
        unassigned: ["obs-beta"]
      },
      fallback
    );

    expect(result.groups.find((group) => group.groupId === "outside-notes")).toMatchObject({
      patientFriendlyName: "Outside Notes",
      confidence: 1,
      resourceIds: ["obs-alpha"]
    });
    expect(result.groups.find((group) => group.resourceIds.includes("obs-beta"))).toMatchObject({
      patientFriendlyName: "Uncoded second note",
      fallback: true
    });
    expect(result.unassigned).toEqual([]);
    expect(result.source).toBe("mixed");
  });

  it("rejects diagnosis-style model labels for observation batches", () => {
    const fallback = deterministicPatientGrouping(records);
    const result = validateGroupingResult(
      records,
      {
        groups: [
          {
            groupId: "type-2-diabetes",
            patientFriendlyName: "Type 2 Diabetes",
            resourceIds: ["obs-a1c"],
            resourceTypes: ["Observation"],
            confidence: 0.95,
            fallback: false
          },
          {
            groupId: "creatinine",
            patientFriendlyName: "Creatinine",
            resourceIds: ["obs-cr"],
            resourceTypes: ["Observation"],
            confidence: 0.95,
            fallback: false
          }
        ],
        unassigned: []
      },
      fallback
    );

    expect(result.groups.map((group) => group.patientFriendlyName)).not.toContain("Type 2 Diabetes");
    expect(result.groups.find((group) => group.resourceIds.includes("obs-a1c"))).toMatchObject({
      patientFriendlyName: "Hemoglobin A1c/Hemoglobin.total in Blood",
      fallback: true
    });
    expect(result.groups.find((group) => group.resourceIds.includes("obs-cr"))).toMatchObject({
      patientFriendlyName: "Creatinine",
      fallback: false
    });
    expect(result.unassigned).toEqual([]);
    expect(result.source).toBe("mixed");
  });

  it("allows a broad observation label only when it is the source concept", () => {
    const broadSourceRecord: GroupableRecord[] = [
      record({
        id: "obs-screening",
        resourceType: "Observation",
        sourceLabel: "Diabetes Monitoring",
        codeTexts: ["Diabetes Monitoring"]
      })
    ];
    const fallback = deterministicPatientGrouping(broadSourceRecord);
    const result = validateGroupingResult(
      broadSourceRecord,
      {
        groups: [
          {
            groupId: "diabetes-monitoring",
            patientFriendlyName: "Diabetes Monitoring",
            resourceIds: ["obs-screening"],
            resourceTypes: ["Observation"],
            confidence: 0.8,
            fallback: false
          }
        ],
        unassigned: []
      },
      fallback
    );

    expect(result.groups[0]).toMatchObject({
      patientFriendlyName: "Diabetes Monitoring",
      fallback: false
    });
    expect(result.source).toBe("webllm");
  });

  it("keeps observation bucket classifications from accepted model output", () => {
    const modelRecords: GroupableRecord[] = [
      record({
        id: "obs-a1c",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c/Hemoglobin.total in Blood",
        categoryCode: "laboratory"
      }),
      record({
        id: "obs-sbp",
        resourceType: "Observation",
        sourceLabel: "Systolic blood pressure"
      })
    ];
    const fallback = deterministicPatientGrouping(modelRecords);
    const result = validateGroupingResult(
      modelRecords,
      {
        groups: [
          {
            groupId: "a1c",
            patientFriendlyName: "Hemoglobin A1c",
            observationBucket: "labs",
            resourceIds: ["obs-a1c"],
            resourceTypes: ["Observation"],
            confidence: 0.9,
            fallback: false
          },
          {
            groupId: "sbp",
            patientFriendlyName: "Systolic Blood Pressure",
            observationBucket: "vitals",
            resourceIds: ["obs-sbp"],
            resourceTypes: ["Observation"],
            confidence: 0.9,
            fallback: false
          }
        ]
      },
      fallback
    );

    expect(result.groups.find((group) => group.groupId === "a1c")).toMatchObject({
      patientFriendlyName: "Hemoglobin A1c",
      observationBucket: "labs"
    });
    expect(result.groups.find((group) => group.groupId === "sbp")).toMatchObject({
      patientFriendlyName: "Systolic Blood Pressure",
      observationBucket: "vitals"
    });
  });

  it("falls back to source observation categories when accepted model output omits bucket classifications", () => {
    const modelRecords: GroupableRecord[] = [
      record({
        id: "obs-a1c",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c/Hemoglobin.total in Blood",
        categoryCode: "laboratory"
      }),
      record({
        id: "obs-sbp",
        resourceType: "Observation",
        sourceLabel: "Systolic blood pressure",
        categoryCode: "vital-signs"
      })
    ];
    const fallback = deterministicPatientGrouping(modelRecords);
    const result = validateGroupingResult(
      modelRecords,
      {
        groups: [
          {
            groupId: "a1c",
            patientFriendlyName: "Hemoglobin A1c",
            resourceIds: ["obs-a1c"],
            resourceTypes: ["Observation"],
            confidence: 0.9,
            fallback: false
          },
          {
            groupId: "sbp",
            patientFriendlyName: "Systolic Blood Pressure",
            resourceIds: ["obs-sbp"],
            resourceTypes: ["Observation"],
            confidence: 0.9,
            fallback: false
          }
        ]
      },
      fallback
    );

    expect(result.groups.find((group) => group.groupId === "a1c")).toMatchObject({
      patientFriendlyName: "Hemoglobin A1c",
      observationBucket: "labs"
    });
    expect(result.groups.find((group) => group.groupId === "sbp")).toMatchObject({
      patientFriendlyName: "Systolic Blood Pressure",
      observationBucket: "vitals"
    });
  });

  it("does not pin accepted model output behind deterministic source-code groups", () => {
    const vaccineRecords: GroupableRecord[] = [
      record({
        id: "imm-mmr-1",
        resourceType: "Immunization",
        sourceLabel: "Measles, mumps and rubella virus vaccine",
        codingKeys: ["cvx:03"]
      }),
      record({
        id: "imm-mmr-2",
        resourceType: "Immunization",
        sourceLabel: "MMR II",
        codingKeys: ["cvx:03"]
      })
    ];
    const fallback = deterministicPatientGrouping(vaccineRecords);
    const result = validateGroupingResult(
      vaccineRecords,
      {
        groups: vaccineRecords.map((candidate) => ({
          groupId: candidate.id,
          patientFriendlyName: candidate.sourceLabel,
          resourceIds: [candidate.id],
          resourceTypes: ["Immunization"],
          confidence: 0.8,
          fallback: false
        })),
        unassigned: []
      },
      fallback
    );

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((group) => group.groupId)).toEqual(["imm-mmr-1", "imm-mmr-2"]);
    expect(result.source).toBe("webllm");
  });

  it("merges duplicate model group ids and assigns each record once", () => {
    const vaccineRecords: GroupableRecord[] = [
      record({
        id: "imm-alpha-1",
        resourceType: "Immunization",
        sourceLabel: "Alpha vaccine product"
      }),
      record({
        id: "imm-alpha-2",
        resourceType: "Immunization",
        sourceLabel: "Alpha vaccine alternate product"
      }),
      record({
        id: "imm-beta-1",
        resourceType: "Immunization",
        sourceLabel: "Beta vaccine product"
      })
    ];
    const fallback = deterministicPatientGrouping(vaccineRecords);
    const result = validateGroupingResult(
      vaccineRecords,
      {
        groups: [
          {
            groupId: "alpha",
            patientFriendlyName: "Alpha Vaccine",
            resourceIds: ["imm-alpha-1"],
            resourceTypes: ["Immunization"],
            confidence: 0.9
          },
          {
            groupId: "alpha",
            patientFriendlyName: "Alpha Vaccine",
            resourceIds: ["imm-alpha-2", "imm-alpha-1"],
            resourceTypes: ["Immunization"],
            confidence: 0.8
          },
          {
            groupId: "beta",
            patientFriendlyName: "Beta Vaccine",
            resourceIds: ["imm-beta-1"],
            resourceTypes: ["Immunization"],
            confidence: 0.9
          }
        ]
      },
      fallback
    );

    expect(result.groups).toHaveLength(2);
    expect(result.groups.find((group) => group.groupId === "alpha")).toMatchObject({
      patientFriendlyName: "Alpha Vaccine",
      resourceIds: ["imm-alpha-1", "imm-alpha-2"],
      confidence: 0.8
    });
    expect(result.unassigned).toEqual([]);
  });

  it("compacts repeated observations by category and exact coding while keeping different measurements separate", () => {
    const compact = compactRecordsForModel([
      record({
        id: "sbp-1",
        resourceType: "Observation",
        sourceLabel: "Systolic blood pressure",
        categoryCode: "vital-signs",
        codingKeys: ["loinc:8480-6"],
        date: "2026-01-01"
      }),
      record({
        id: "sbp-2",
        resourceType: "Observation",
        sourceLabel: "Systolic blood pressure",
        categoryCode: "vital-signs",
        codingKeys: ["loinc:8480-6"],
        date: "2026-02-01"
      }),
      record({
        id: "dbp-1",
        resourceType: "Observation",
        sourceLabel: "Diastolic blood pressure",
        categoryCode: "vital-signs",
        codingKeys: ["loinc:8462-4"],
        date: "2026-02-01"
      })
    ]);

    const systolic = compact.find((candidate) => candidate.memberResourceIds?.includes("sbp-1"));
    const diastolic = compact.find((candidate) => candidate.memberResourceIds?.includes("dbp-1"));

    expect(compact).toHaveLength(2);
    expect(systolic).toMatchObject({
      resourceType: "Observation",
      memberResourceIds: ["sbp-1", "sbp-2"],
      resourceCount: 2,
      latestDate: "2026-02-01"
    });
    expect(systolic?.sourceLabels).toEqual(["Systolic blood pressure"]);
    expect(diastolic?.memberResourceIds).toEqual(["dbp-1"]);
  });

  it("compacts observations by the preferred standard code when local codes differ", () => {
    const compact = compactRecordsForModel([
      record({
        id: "a1c-portal-a",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c by HPLC",
        categoryCode: "laboratory",
        codingKeys: ["loinc:4548-4", "local-lab:a1c-panel-1"],
        codeTexts: ["Hemoglobin A1c"],
        date: "2026-01-01"
      }),
      record({
        id: "a1c-portal-b",
        resourceType: "Observation",
        sourceLabel: "HbA1c",
        categoryCode: "laboratory",
        codingKeys: ["loinc:4548-4", "local-lab:hgba1c-legacy"],
        codeTexts: ["HbA1c"],
        date: "2026-02-01"
      })
    ]);

    expect(compact).toHaveLength(1);
    expect(compact[0]).toMatchObject({
      resourceType: "Observation",
      memberResourceIds: ["a1c-portal-a", "a1c-portal-b"],
      resourceCount: 2,
      latestDate: "2026-02-01"
    });
    expect(compact[0].codingKeys).toEqual(["local-lab:a1c-panel-1", "local-lab:hgba1c-legacy", "loinc:4548-4"]);
  });

  it("compacts medications by ingredient plus route when available", () => {
    const compact = compactRecordsForModel([
      record({
        id: "metformin-500",
        resourceType: "MedicationRequest",
        sourceLabel: "Metformin 500 mg tablet",
        ingredients: ["Metformin"],
        dosageForm: "Oral tablet",
        route: "Oral"
      }),
      record({
        id: "metformin-er",
        resourceType: "MedicationRequest",
        sourceLabel: "Metformin ER tablet",
        ingredients: ["Metformin"],
        dosageForm: "Extended release tablet",
        route: "Oral"
      }),
      record({
        id: "albuterol-inhaler",
        resourceType: "MedicationRequest",
        sourceLabel: "Albuterol inhaler",
        ingredients: ["Albuterol"],
        dosageForm: "Metered dose inhaler",
        route: "Inhaled"
      }),
      record({
        id: "albuterol-solution",
        resourceType: "MedicationRequest",
        sourceLabel: "Albuterol inhalation solution",
        ingredients: ["Albuterol"],
        dosageForm: "Inhalation solution",
        route: "Inhaled"
      })
    ]);

    const metformin = compact.find((candidate) => candidate.memberResourceIds?.includes("metformin-500"));
    const albuterol = compact.find((candidate) => candidate.memberResourceIds?.includes("albuterol-inhaler"));

    expect(compact).toHaveLength(2);
    expect(metformin?.memberResourceIds).toEqual(["metformin-500", "metformin-er"]);
    expect(metformin?.route).toBe("Oral");
    expect(albuterol?.memberResourceIds).toEqual(["albuterol-inhaler", "albuterol-solution"]);
    expect(albuterol?.route).toBe("Inhaled");
  });

  it("expands compact model resource ids back to original resource ids", () => {
    const compact = compactRecordsForModel([
      record({
        id: "a1c-1",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c",
        categoryCode: "laboratory",
        codingKeys: ["loinc:4548-4"]
      }),
      record({
        id: "a1c-2",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c",
        categoryCode: "laboratory",
        codingKeys: ["loinc:4548-4"]
      })
    ]);

    const expanded = expandCompactGrouping(compact, {
      source: "webllm",
      groups: [
        {
          groupId: "hemoglobin-a1c",
          patientFriendlyName: "Hemoglobin A1c",
          resourceIds: [compact[0].id],
          resourceTypes: ["Observation"],
          confidence: 0.92,
          reason: "Same code.",
          fallback: false
        }
      ],
      unassigned: []
    });

    expect(expanded.groups[0].resourceIds).toEqual(["a1c-1", "a1c-2"]);
  });
});
