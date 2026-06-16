import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebLlmIncrementalGroupingUpdate } from "../../src/lib/llm/webllm";

const mocks = vi.hoisted(() => ({
  createCompletion: vi.fn(),
  createEngine: vi.fn()
}));

vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: mocks.createEngine
}));

describe("WebLLM grouping adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createCompletion.mockReset();
    mocks.createEngine.mockReset();
    window.sessionStorage.clear();
    Object.defineProperty(window.navigator, "gpu", {
      configurable: true,
      value: {}
    });
  });

  it("selects the model at engine creation and requests JSON-schema structured output", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"groups":[],"unassigned":[]}' } }]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlm, WEBLLM_GROUPING_CUSTOM_MODEL } = await import("../../src/lib/llm/webllm");

    await groupWithWebLlm(
      [
        {
          id: "obs-a1c",
          resourceType: "Observation",
          sourceLabel: "Hemoglobin A1c",
          valueKind: "quantity",
          unit: "%",
          source: "provider"
        }
      ],
      { modelPreference: "custom" }
    );

    expect(mocks.createEngine).toHaveBeenCalledWith(WEBLLM_GROUPING_CUSTOM_MODEL, expect.any(Object));
    expect(mocks.createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 900,
        temperature: 0
      })
    );
    expect(mocks.createCompletion.mock.calls[0][0]).not.toHaveProperty("model");
    expect(mocks.createCompletion.mock.calls[0][0]).toHaveProperty("response_format");
    expect(WEBLLM_GROUPING_CUSTOM_MODEL).toBe("fhir4px-q4f16_1-MLC");
  });

  it("does not download non-default models unless explicitly enabled", async () => {
    mocks.createEngine.mockRejectedValueOnce(new Error("custom model unavailable"));

    const { warmWebLlmGroupingModel, WEBLLM_GROUPING_CUSTOM_MODEL } = await import("../../src/lib/llm/webllm");

    await expect(warmWebLlmGroupingModel({ modelPreference: "custom" })).resolves.toBe(false);

    expect(mocks.createEngine).toHaveBeenCalledTimes(1);
    expect(mocks.createEngine).toHaveBeenCalledWith(WEBLLM_GROUPING_CUSTOM_MODEL, expect.any(Object));
  });

  it("can opt in to the custom fhir4px model", async () => {
    window.sessionStorage.setItem("fhir4px_use_custom_webllm_model", "1");
    const engine = {
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    };
    mocks.createEngine.mockResolvedValueOnce(engine);

    const { warmWebLlmGroupingModel, WEBLLM_GROUPING_CUSTOM_MODEL } = await import("../../src/lib/llm/webllm");

    await expect(warmWebLlmGroupingModel()).resolves.toBe(true);

    expect(mocks.createEngine).toHaveBeenCalledTimes(1);
    expect(mocks.createEngine).toHaveBeenCalledWith(WEBLLM_GROUPING_CUSTOM_MODEL, expect.any(Object));
    expect(mocks.createEngine.mock.calls[0][1].appConfig.model_list[0]).toMatchObject({
      model_id: WEBLLM_GROUPING_CUSTOM_MODEL,
      model: expect.stringContaining("joelmontavon/fhir4px-model-webllm"),
      model_lib: expect.stringContaining("fhir4px-q4f16_1-webgpu.wasm")
    });
    expect(mocks.createEngine.mock.calls[0][1].appConfig.cacheBackend).toBe("indexeddb");
  });

  it("ignores the old stock fallback model flag so default-model failures stay visible", async () => {
    window.sessionStorage.setItem("fhir4px_enable_webllm_fallback_models", "1");
    mocks.createEngine.mockRejectedValueOnce(new Error("custom model unavailable"));

    const { warmWebLlmGroupingModel, WEBLLM_GROUPING_CUSTOM_MODEL } = await import("../../src/lib/llm/webllm");

    await expect(warmWebLlmGroupingModel({ modelPreference: "custom" })).resolves.toBe(false);

    expect(mocks.createEngine).toHaveBeenCalledTimes(1);
    expect(mocks.createEngine.mock.calls[0][0]).toBe(WEBLLM_GROUPING_CUSTOM_MODEL);
  });

  it("can explicitly select the 3B model for local comparison", async () => {
    const engine = {
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    };
    mocks.createEngine.mockResolvedValueOnce(engine);

    const { warmWebLlmGroupingModel, WEBLLM_GROUPING_FALLBACK_MODEL } = await import("../../src/lib/llm/webllm");

    await expect(warmWebLlmGroupingModel({ modelPreference: "three-b" })).resolves.toBe(true);

    expect(mocks.createEngine).toHaveBeenCalledTimes(1);
    expect(mocks.createEngine).toHaveBeenCalledWith(WEBLLM_GROUPING_FALLBACK_MODEL, expect.any(Object));
  });


  it("adds resource-specific guidance and medication route hints to the structured request", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"groups":[],"unassigned":[]}' } }]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlm } = await import("../../src/lib/llm/webllm");

    await groupWithWebLlm([
      {
        id: "medreq-metformin-er",
        resourceType: "MedicationRequest",
        sourceLabel: "Metformin 500 mg extended release tablet",
        codingKeys: ["rxnorm:861007"],
        groupingText: "Metformin 500 mg extended release tablet Metformin Extended release tablet rxnorm:861007",
        ingredients: ["Metformin"],
        dosageForm: "Extended release tablet",
        route: "Oral",
        source: "provider"
      }
    ]);

    const request = mocks.createCompletion.mock.calls[0][0];
    const userMessage = JSON.parse(request.messages[1].content);
    expect(userMessage.resourceGuidance.medicationGrouping).toContain(
      "Prefer ingredient plus route."
    );
    expect(userMessage.records[0]).toMatchObject({
      ingredients: ["Metformin"],
      dosageForm: "Extended release tablet",
      route: "Oral"
    });
  });

  it("does not offer unrelated cached names to medication naming and rejects ingredient mismatches", async () => {
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);
      expect(parsed.availableNames).toEqual([]);
      expect(JSON.stringify(input)).not.toContain("Hydroxychloroquine Oral");
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                patientFriendlyName: "Hydroxychloroquine Oral",
                confidence: 0.91,
                fallback: false
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncremental } = await import("../../src/lib/llm/webllm");

    await expect(
      groupWithWebLlmIncremental(
        [
          {
            id: "medreq-albuterol",
            resourceType: "MedicationRequest",
            sourceLabel: "Albuterol sulfate inhalation solution",
            ingredients: ["Albuterol"],
            dosageForm: "Inhalation solution",
            source: "provider"
          }
        ],
        { initialAvailableNames: ["Hydroxychloroquine Oral"] }
      )
    ).resolves.toMatchObject({
      groups: [
        expect.objectContaining({
          patientFriendlyName: "Albuterol sulfate inhalation solution",
          resourceIds: ["medreq-albuterol"],
          fallback: true
        })
      ],
      unassigned: []
    });
  });

  it("adds compact observation category guidance only for categories in the batch", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"groups":[],"unassigned":[]}' } }]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlm } = await import("../../src/lib/llm/webllm");

    await groupWithWebLlm([
      {
        id: "obs-sbp",
        resourceType: "Observation",
        sourceLabel: "Systolic blood pressure by Noninvasive",
        codingKeys: ["loinc:76534-7"],
        category: "Vital Signs",
        categoryCode: "vital-signs",
        source: "provider"
      }
    ]);

    const request = mocks.createCompletion.mock.calls[0][0];
    const systemMessage = request.messages[0].content;
    const userMessage = JSON.parse(request.messages[1].content);
    expect(systemMessage).toContain("Resource-specific task: Observation grouping.");
    expect(systemMessage).toContain("Do not group Observations by diagnosis");
    expect(systemMessage).toContain("4548-4 Hemoglobin A1c");
    expect(systemMessage).not.toContain("E11.65 Type 2 diabetes mellitus");
    expect(userMessage.resourceGuidance.observationGrouping).toContain(
      "Use category only as context."
    );
    expect(userMessage.resourceGuidance.observationCategoryGuide).toEqual({
      "vital-signs": "Vital sign"
    });
    expect(userMessage.resourceGuidance.patientFriendlyNameSeeds).toHaveProperty("vital-signs");
    expect(userMessage.resourceGuidance.patientFriendlyNameSeeds).not.toHaveProperty("laboratory");
  });

  it("uses condition-specific diagnosis examples only for Condition batches", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"groups":[],"unassigned":[]}' } }]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlm } = await import("../../src/lib/llm/webllm");

    await groupWithWebLlm([
      {
        id: "cond-diabetes",
        resourceType: "Condition",
        sourceLabel: "Type 2 diabetes mellitus with hyperglycemia",
        codingKeys: ["icd10:E11.65"],
        source: "provider"
      }
    ]);

    const request = mocks.createCompletion.mock.calls[0][0];
    expect(request.messages[0].content).toContain("Resource-specific task: Condition grouping.");
    expect(request.messages[0].content).toContain("E11.65 Type 2 diabetes mellitus");
  });

  it("adds immunization guidance that asks for vaccine-family groups", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"groups":[],"unassigned":[]}' } }]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlm } = await import("../../src/lib/llm/webllm");

    await groupWithWebLlm([
      {
        id: "imm-mmr",
        resourceType: "Immunization",
        sourceLabel: "MMR II",
        codingKeys: ["cvx:03"],
        source: "provider"
      }
    ]);

    const request = mocks.createCompletion.mock.calls[0][0];
    const userMessage = JSON.parse(request.messages[1].content);
    expect(userMessage.resourceGuidance.immunizationGrouping).toContain(
      "Group by vaccine family, not broad Vaccines."
    );
  });

  it("sends minimized prompt records instead of full resources or repeated schema", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"groups":[],"unassigned":[]}' } }]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlm } = await import("../../src/lib/llm/webllm");

    await groupWithWebLlm([
      {
        id: "cluster:Observation:abc",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c/Hemoglobin.total in Blood".repeat(10),
        codeTexts: ["Hemoglobin A1c/Hemoglobin.total in Blood".repeat(10)],
        codeCodings: [
          { code: "4548-4", display: "Hemoglobin A1c/Hemoglobin.total in Blood".repeat(10) },
          { code: "17856-6", display: "Hemoglobin A1c/Hemoglobin.total in Blood by HPLC" },
          { code: "x1", display: "Extra 1" },
          { code: "x2", display: "Extra 2" },
          { code: "x3", display: "Extra 3" },
          { code: "x4", display: "Extra 4" },
          { code: "x5", display: "Extra 5" }
        ],
        groupingText: "Long source text ".repeat(100),
        sourceLabels: ["A1c", "HbA1c", "Hemoglobin A1c", "Hemoglobin A1c/Hemoglobin.total in Blood", "Extra"],
        codingKeys: ["loinc:4548-4", "loinc:17856-6", "extra:1", "extra:2", "extra:3", "extra:4", "extra:5"],
        displayValue: "7.1 %",
        canonicalValue: 7.1,
        canonicalUnit: "%",
        resourceCount: 42,
        categoryCode: "laboratory",
        source: "provider"
      }
    ]);

    const request = mocks.createCompletion.mock.calls[0][0];
    const userMessage = JSON.parse(request.messages[1].content);
    expect(userMessage).not.toHaveProperty("schema");
    expect(userMessage.outputShape).toContain("groups");
    expect(userMessage.records[0]).not.toHaveProperty("sourceLabel");
    expect(userMessage.records[0]).not.toHaveProperty("groupingText");
    expect(userMessage.records[0]).not.toHaveProperty("sourceLabels");
    expect(userMessage.records[0]).not.toHaveProperty("codingKeys");
    expect(userMessage.records[0].concept.text[0].length).toBeLessThanOrEqual(500);
    expect(userMessage.records[0].concept.coding).toHaveLength(6);
    expect(userMessage.records[0].concept.coding[0].display.length).toBeLessThanOrEqual(350);
    expect(userMessage.records[0]).not.toHaveProperty("displayValue");
    expect(userMessage.records[0]).not.toHaveProperty("canonicalValue");
    expect(userMessage.records[0]).not.toHaveProperty("canonicalUnit");
  });

  it("names compact records in small batches and offers earlier batch names in the next schema", async () => {
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);

      if (parsed.records[0].id === "imm-mmr-1") {
        expect(parsed.availableNames).toEqual([]);
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    { id: "imm-mmr-1", patientFriendlyName: "MMR", confidence: 0.9, fallback: false },
                    { id: "imm-dtap-1", patientFriendlyName: "DTaP", confidence: 0.91, fallback: false },
                    { id: "imm-flu-1", patientFriendlyName: "Flu", confidence: 0.92, fallback: false }
                  ]
                })
              }
            }
          ]
        };
      }

      expect(parsed.availableNames).toEqual(["MMR", "DTaP", "Flu"]);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  { id: "imm-covid-1", patientFriendlyName: "COVID-19", confidence: 0.93, fallback: false },
                  { id: "imm-mmr-2", patientFriendlyName: "MMR", confidence: 0.88, fallback: false },
                  { id: "imm-flu-2", patientFriendlyName: "Flu", confidence: 0.87, fallback: false }
                ]
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncremental } = await import("../../src/lib/llm/webllm");

    await expect(
      groupWithWebLlmIncremental([
        {
          id: "imm-mmr-1",
          resourceType: "Immunization",
          sourceLabel: "Measles, mumps and rubella virus vaccine",
          source: "provider"
        },
        {
          id: "imm-dtap-1",
          resourceType: "Immunization",
          sourceLabel: "Diphtheria, tetanus toxoids and acellular pertussis vaccine",
          source: "provider"
        },
        {
          id: "imm-flu-1",
          resourceType: "Immunization",
          sourceLabel: "Influenza seasonal injectable",
          source: "provider"
        },
        {
          id: "imm-covid-1",
          resourceType: "Immunization",
          sourceLabel: "COVID-19 mRNA vaccine",
          source: "provider"
        },
        {
          id: "imm-mmr-2",
          resourceType: "Immunization",
          sourceLabel: "MMR II",
          source: "provider"
        },
        {
          id: "imm-flu-2",
          resourceType: "Immunization",
          sourceLabel: "Influenza vaccine quadrivalent",
          source: "provider"
        }
      ])
    ).resolves.toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({
          groupId: "immunization-mmr",
          patientFriendlyName: "MMR",
          resourceIds: ["imm-mmr-1", "imm-mmr-2"],
          confidence: 0.88
        }),
        expect.objectContaining({
          groupId: "immunization-flu",
          patientFriendlyName: "Flu",
          resourceIds: ["imm-flu-1", "imm-flu-2"],
          confidence: 0.87
        })
      ]),
      unassigned: []
    });
    expect(mocks.createCompletion).toHaveBeenCalledTimes(2);
    const batchSizes = mocks.createCompletion.mock.calls.map((call) => JSON.parse(call[0].messages[1].content).records.length);
    expect(batchSizes).toEqual([3, 3]);
    expect(mocks.createCompletion.mock.calls[0][0]).toMatchObject({ max_tokens: 540 });
  });

  it("parses observation bucket classifications from incremental naming results", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                {
                  id: "obs-a1c",
                  patientFriendlyName: "Hemoglobin A1c",
                  observationBucket: "labs",
                  confidence: 0.91,
                  fallback: false
                },
                {
                  id: "obs-sbp",
                  patientFriendlyName: "Systolic Blood Pressure",
                  observationBucket: "vitals",
                  confidence: 0.9,
                  fallback: false
                }
              ]
            })
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncremental } = await import("../../src/lib/llm/webllm");

    await expect(
      groupWithWebLlmIncremental([
        {
          id: "obs-a1c",
          resourceType: "Observation",
          sourceLabel: "Hemoglobin A1c/Hemoglobin.total in Blood",
          source: "provider"
        },
        {
          id: "obs-sbp",
          resourceType: "Observation",
          sourceLabel: "Systolic blood pressure",
          source: "provider"
        }
      ])
    ).resolves.toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({
          groupId: "observation-labs-hemoglobin-a1c",
          patientFriendlyName: "Hemoglobin A1c",
          observationBucket: "labs"
        }),
        expect.objectContaining({
          groupId: "observation-vitals-systolic-blood-pressure",
          patientFriendlyName: "Systolic Blood Pressure",
          observationBucket: "vitals"
        })
      ])
    });
  });

  it("accepts alternate batch naming response shapes when ids match", async () => {
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: parsed.records.map((record: { id: string }) => ({
                  recordId: record.id,
                  patientFriendlyName: "Glucose",
                  observationBucket: "labs",
                  confidence: 0.88,
                  fallback: false
                }))
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncremental } = await import("../../src/lib/llm/webllm");

    await expect(
      groupWithWebLlmIncremental([
        {
          id: "obs-glucose-a",
          resourceType: "Observation",
          sourceLabel: "Glucose",
          categoryCode: "laboratory",
          source: "provider"
        },
        {
          id: "obs-glucose-b",
          resourceType: "Observation",
          sourceLabel: "Blood glucose",
          categoryCode: "laboratory",
          source: "provider"
        },
        {
          id: "obs-glucose-c",
          resourceType: "Observation",
          sourceLabel: "Glucose lab",
          categoryCode: "laboratory",
          source: "provider"
        }
      ])
    ).resolves.toMatchObject({
      groups: [
        expect.objectContaining({
          patientFriendlyName: "Glucose",
          resourceIds: ["obs-glucose-a", "obs-glucose-b", "obs-glucose-c"],
          observationBucket: "labs"
        })
      ],
      unassigned: []
    });
    expect(mocks.createCompletion).toHaveBeenCalledTimes(1);
  });

  it("streams an incremental grouping update after each naming batch", async () => {
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: parsed.records.map((record: { id: string }) => ({
                  id: record.id,
                  patientFriendlyName: record.id,
                  confidence: 0.82,
                  fallback: false
                }))
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncrementalStream } = await import("../../src/lib/llm/webllm");
    const records = Array.from({ length: 6 }, (_value, index) => ({
      id: `obs-${index}`,
      resourceType: "Observation" as const,
      sourceLabel: `Observation ${index}`,
      source: "provider" as const
    }));
    const updates: WebLlmIncrementalGroupingUpdate[] = [];

    for await (const update of groupWithWebLlmIncrementalStream(records)) {
      updates.push(update);
    }

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      completedCount: 3,
      totalCount: 6,
      batchIndex: 1,
      batchCount: 2
    });
    expect(updates[0].completedRecords.map((record) => record.id)).toEqual(["obs-0", "obs-1", "obs-2"]);
    expect(updates[0].pendingRecords.map((record) => record.id)).toEqual(["obs-3", "obs-4", "obs-5"]);
    expect(updates[1]).toMatchObject({
      completedCount: 6,
      totalCount: 6,
      batchIndex: 2,
      batchCount: 2
    });
    expect(mocks.createCompletion).toHaveBeenCalledTimes(2);
  });


  it("marks recovered batch-to-single naming fallback diagnostics as recovered", async () => {
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);
      if (parsed.records?.length === 3) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({ items: [] })
              }
            }
          ]
        };
      }
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                patientFriendlyName: parsed.record?.concept?.text?.[0] ?? "Glucose",
                observationBucket: "labs",
                confidence: 0.84,
                fallback: false
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncremental } = await import("../../src/lib/llm/webllm");
    const onDiagnostic = vi.fn();

    await expect(
      groupWithWebLlmIncremental(
        [
          {
            id: "obs-a1c",
            resourceType: "Observation",
            sourceLabel: "Hemoglobin A1c",
            categoryCode: "laboratory",
            source: "provider"
          },
          {
            id: "obs-glucose",
            resourceType: "Observation",
            sourceLabel: "Glucose",
            categoryCode: "laboratory",
            source: "provider"
          },
          {
            id: "obs-vitamin-d",
            resourceType: "Observation",
            sourceLabel: "Vitamin D",
            categoryCode: "laboratory",
            source: "provider"
          }
        ],
        { onDiagnostic }
      )
    ).resolves.toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({ resourceIds: ["obs-a1c"] }),
        expect.objectContaining({ resourceIds: ["obs-glucose"] }),
        expect.objectContaining({ resourceIds: ["obs-vitamin-d"] })
      ])
    });

    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "batch record naming",
        fallbackScope: "batch",
        recovered: true
      })
    );
    expect(mocks.createCompletion).toHaveBeenCalledTimes(4);
  });

  it("falls back to source concept names when local naming returns non-JSON", async () => {
    mocks.createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: "I cannot produce that output."
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncremental } = await import("../../src/lib/llm/webllm");

    await expect(
      groupWithWebLlmIncremental([
        {
          id: "cluster-a1c",
          resourceType: "Observation",
          sourceLabel: "Hemoglobin A1c",
          categoryCode: "laboratory",
          source: "provider"
        },
        {
          id: "cluster-sbp",
          resourceType: "Observation",
          sourceLabel: "Systolic blood pressure",
          categoryCode: "vital-signs",
          source: "provider"
        }
      ])
    ).resolves.toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({
          patientFriendlyName: "Hemoglobin A1c",
          resourceIds: ["cluster-a1c"],
          fallback: true,
          observationBucket: "labs"
        }),
        expect.objectContaining({
          patientFriendlyName: "Systolic blood pressure",
          resourceIds: ["cluster-sbp"],
          fallback: true,
          observationBucket: "vitals"
        })
      ]),
      unassigned: []
    });
    expect(mocks.createCompletion).toHaveBeenCalledTimes(6);
  });

  it("offers cached names to the first incremental naming batch", async () => {
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);
      expect(parsed.availableNames).toEqual(["Hemoglobin A1c"]);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                patientFriendlyName: "Hemoglobin A1c",
                confidence: 0.9,
                fallback: false
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncremental } = await import("../../src/lib/llm/webllm");

    await expect(
      groupWithWebLlmIncremental(
        [
          {
            id: "obs-a1c-alt",
            resourceType: "Observation",
            sourceLabel: "HbA1c",
            source: "provider"
          }
        ],
        { initialAvailableNames: ["Hemoglobin A1c"] }
      )
    ).resolves.toMatchObject({
      groups: [expect.objectContaining({ patientFriendlyName: "Hemoglobin A1c" })]
    });
  });

  it("keeps relevant existing names in the schema when available names exceed the cap", async () => {
    const olderRelevantName = "Glucose";
    const fillerNames = Array.from({ length: 40 }, (_value, index) => `Unrelated Name ${index}`);
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);
      expect(parsed.availableNames.length).toBeLessThanOrEqual(30);
      expect(parsed.availableNames).toContain(olderRelevantName);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                patientFriendlyName: olderRelevantName,
                observationBucket: "labs",
                confidence: 0.9,
                fallback: false
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmIncremental } = await import("../../src/lib/llm/webllm");

    await expect(
      groupWithWebLlmIncremental(
        [
          {
            id: "obs-glucose-text",
            resourceType: "Observation",
            sourceLabel: "Blood glucose lab",
            categoryCode: "laboratory",
            source: "provider"
          }
        ],
        { initialAvailableNames: [olderRelevantName, ...fillerNames] }
      )
    ).resolves.toMatchObject({
      groups: [expect.objectContaining({ patientFriendlyName: olderRelevantName, observationBucket: "labs" })]
    });
  });

  it("batches larger local grouping requests before calling WebLLM", async () => {
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                groups: parsed.records.map((record: { id: string; resourceType: string; concept?: { text?: string[] } }) => ({
                  groupId: record.id,
                  patientFriendlyName: record.concept?.text?.[0] ?? record.id,
                  resourceIds: [record.id],
                  resourceTypes: [record.resourceType],
                  confidence: 0.8,
                  fallback: false
                })),
                unassigned: []
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmBatched } = await import("../../src/lib/llm/webllm");
    const records = Array.from({ length: 25 }, (_value, index) => ({
      id: `obs-${index}`,
      resourceType: "Observation" as const,
      sourceLabel: `Observation ${index}`,
      categoryCode: index < 15 ? "laboratory" : "vital-signs",
      source: "provider" as const
    }));

    await expect(groupWithWebLlmBatched(records)).resolves.toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({ resourceIds: ["obs-0"] }),
        expect.objectContaining({ resourceIds: ["obs-24"] })
      ])
    });
    expect(mocks.createCompletion).toHaveBeenCalledTimes(5);
    const batchSizes = mocks.createCompletion.mock.calls.map((call) => JSON.parse(call[0].messages[1].content).records.length);
    expect(batchSizes).toEqual([6, 6, 3, 6, 4]);
  });

  it("splits batches when WebLLM reports a context-window error", async () => {
    mocks.createCompletion.mockImplementation(async (input) => {
      const parsed = JSON.parse(input.messages[1].content);
      if (parsed.records.length > 1) {
        throw new Error(
          "Prompt tokens exceed context window size: number of prompt tokens: 5386; context window size: 4096"
        );
      }
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                groups: parsed.records.map((record: { id: string; resourceType: string }) => ({
                  groupId: record.id,
                  patientFriendlyName: record.id,
                  resourceIds: [record.id],
                  resourceTypes: [record.resourceType],
                  confidence: 0.7,
                  fallback: false
                })),
                unassigned: []
              })
            }
          }
        ]
      };
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlmBatched } = await import("../../src/lib/llm/webllm");
    const onProgress = vi.fn();
    const records = Array.from({ length: 3 }, (_value, index) => ({
      id: `obs-${index}`,
      resourceType: "Observation" as const,
      sourceLabel: `Observation ${index}`,
      categoryCode: "laboratory",
      source: "provider" as const
    }));

    await expect(groupWithWebLlmBatched(records, { onProgress })).resolves.toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({ resourceIds: ["obs-0"] }),
        expect.objectContaining({ resourceIds: ["obs-2"] })
      ])
    });
    expect(onProgress).toHaveBeenCalledWith("Prompt too large; splitting 3 records into smaller local batches");
    expect(mocks.createCompletion).toHaveBeenCalledTimes(5);
  });

  it("parses JSON returned inside a Markdown code fence", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: [
              "```json",
              "{",
              '  "groups": [',
              '    {',
              '      "groupId": "mmr",',
              '      "patientFriendlyName": "MMR",',
              '      "resourceIds": ["imm-mmr"],',
              '      "resourceTypes": ["Immunization"],',
              '      "confidence": 0.95,',
              '      "reason": "Same vaccine label.",',
              '      "fallback": false',
              "    }",
              "  ],",
              '  "unassigned": []',
              "}",
              "```"
            ].join("\n")
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlm } = await import("../../src/lib/llm/webllm");
    const result = await groupWithWebLlm([
      {
        id: "imm-mmr",
        resourceType: "Immunization",
        sourceLabel: "MMR II",
        groupingText: "MMR II cvx:03",
        source: "provider"
      }
    ]);

    expect(result).toEqual({
      groups: [
        {
          groupId: "mmr",
          patientFriendlyName: "MMR",
          resourceIds: ["imm-mmr"],
          resourceTypes: ["Immunization"],
          confidence: 0.95,
          reason: "Same vaccine label.",
          fallback: false
        }
      ],
      unassigned: []
    });
  });

  it("extracts JSON when the model adds text around the object", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              'Here is the grouping, not this example {groups}:\n{"groups":[],"unassigned":["obs-a1c"]}\nThis keeps unmatched records visible.'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { groupWithWebLlm } = await import("../../src/lib/llm/webllm");
    await expect(
      groupWithWebLlm([
        {
          id: "obs-a1c",
          resourceType: "Observation",
          sourceLabel: "Hemoglobin A1c",
          source: "provider"
        }
      ])
    ).resolves.toEqual({ groups: [], unassigned: ["obs-a1c"] });
  });

  it("identifies a direct lab-condition target without passing condition choices or full records", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[{"conditionName":"Type 2 Diabetes","confidence":"high"}]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    const associations = await associateLabGroupWithConditionsWithWebLlm(
      {
        groupId: "observation-glucose",
        patientFriendlyName: "Glucose",
        resourceIds: ["obs-lab-1"],
        resourceTypes: ["Observation"],
        observationBucket: "labs",
        confidence: 0.9,
        reason: "test",
        fallback: false
      },
      [
        {
          id: "obs-lab-1",
          resourceType: "Observation",
          sourceLabel: "Glucose",
          codeTexts: ["Glucose"],
          source: "provider"
        }
      ],
      [
        {
          conditionGroupId: "Condition:condition-1",
          name: "Type 2 Diabetes"
        }
      ]
    );

    expect(associations).toEqual([
      {
        conditionGroupId: "Condition:condition-1",
        relationship: "monitoring_marker",
        confidence: 0.95,
        fallback: false
      }
    ]);
    const systemMessage = mocks.createCompletion.mock.calls[0][0].messages[0].content;
    expect(systemMessage).toContain("Return an empty associations array or one association object.");
    expect(systemMessage).toContain(
      "Rank relevance as: high direct monitoring or diagnosis, medium indirect or missing context, low possible or weak."
    );
    expect(systemMessage).toContain("High: INR with Long-term Anticoagulant Therapy.");
    expect(systemMessage).toContain("Medium: Ferritin with Anemia when iron deficiency is not explicit.");
    expect(systemMessage).toContain("Low: Body weight with Heart Failure when no fluid-status context is present.");
    expect(systemMessage).toContain("High: Hemoglobin A1c with Diabetes Type 2.");
    expect(systemMessage).not.toContain("Do not just choose the closest available condition");
    expect(systemMessage).not.toContain("confidence 0.98");
    const userMessage = JSON.parse(mocks.createCompletion.mock.calls[0][0].messages[1].content);
    expect(userMessage).toEqual({
      outputShape:
        'Return JSON with an "associations" array. Each item must have "conditionName" and "confidence". The confidence value must be one of: high, medium, low.',
      measurement: {
        groupId: "observation-glucose",
        name: "Glucose"
      },
      conditionChoices: [
        {
          conditionGroupId: "Condition:condition-1",
          name: "Type 2 Diabetes"
        }
      ],
      referenceContext: []
    });
    expect(JSON.stringify(userMessage)).not.toContain("snomed");
    expect(JSON.stringify(userMessage)).not.toContain("records");
  });

  it("returns no association when the model returns no scored associations", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    const associations = await associateLabGroupWithConditionsWithWebLlm(
      {
        groupId: "observation-cholesterol",
        patientFriendlyName: "Cholesterol",
        resourceIds: ["obs-cholesterol"],
        resourceTypes: ["Observation"],
        observationBucket: "labs",
        confidence: 0.9,
        reason: "test",
        fallback: false
      },
      [
        {
          id: "obs-general-lab",
          resourceType: "Observation",
          sourceLabel: "Cholesterol",
          codeTexts: ["Cholesterol"],
          source: "provider"
        }
      ],
      [
        {
          conditionGroupId: "Condition:condition-1",
          name: "High Blood Pressure"
        }
      ]
    );

    expect(associations).toEqual([]);
  });

  it("rejects low-confidence lab-condition associations", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[{"conditionName":"Type 2 Diabetes","confidence":"medium"}]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    const associations = await associateLabGroupWithConditionsWithWebLlm(
      {
        groupId: "observation-low-confidence",
        patientFriendlyName: "Glucose",
        resourceIds: ["obs-glucose"],
        resourceTypes: ["Observation"],
        observationBucket: "labs",
        confidence: 0.9,
        reason: "test",
        fallback: false
      },
      [
        {
          id: "obs-glucose",
          resourceType: "Observation",
          sourceLabel: "Glucose",
          codeTexts: ["Glucose"],
          source: "provider"
        }
      ],
      [
        {
          conditionGroupId: "Condition:condition-1",
          name: "Type 2 Diabetes"
        }
      ]
    );

    expect(associations).toEqual([]);
  });

  it("returns no association when the local model returns an empty association list", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    await expect(
      associateLabGroupWithConditionsWithWebLlm(
        {
          groupId: "observation-triglyceride",
          patientFriendlyName: "Triglyceride",
          resourceIds: ["obs-triglyceride"],
          resourceTypes: ["Observation"],
          observationBucket: "labs",
          confidence: 0.9,
          reason: "test",
          fallback: false
        },
        [
          {
            id: "obs-triglyceride",
            resourceType: "Observation",
            sourceLabel: "Triglyceride",
            codeTexts: ["Triglyceride"],
            source: "provider"
          }
        ],
        [
          {
            conditionGroupId: "Condition:hypertension",
            name: "High Blood Pressure"
          }
        ]
      )
    ).resolves.toEqual([]);
  });

  it("returns no association when the model returns no direct association", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    const associations = await associateLabGroupWithConditionsWithWebLlm(
      {
        groupId: "observation-a1c",
        patientFriendlyName: "Hemoglobin A1c",
        resourceIds: ["obs-a1c"],
        resourceTypes: ["Observation"],
        observationBucket: "labs",
        confidence: 0.9,
        reason: "test",
        fallback: false
      },
      [
        {
          id: "obs-a1c",
          resourceType: "Observation",
          sourceLabel: "Hemoglobin A1c",
          codeTexts: ["Hemoglobin A1c"],
          source: "provider"
        }
      ],
      [
        {
          conditionGroupId: "Condition:diabetes",
          name: "Type 2 Diabetes"
        },
        {
          conditionGroupId: "Condition:hypertension",
          name: "High Blood Pressure"
        }
      ],
      {},
      { explicitRelatedContext: ["Referenced condition candidate: Diabetes Type 2"] }
    );

    expect(associations).toEqual([]);
  });

  it("rejects lab-condition targets that are not in the patient condition choices", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[{"conditionName":"Kidney Disease","confidence":0.99}]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    await expect(
      associateLabGroupWithConditionsWithWebLlm(
        {
          groupId: "observation-glucose",
          patientFriendlyName: "Glucose",
          resourceIds: ["obs-glucose"],
          resourceTypes: ["Observation"],
          observationBucket: "labs",
          confidence: 0.9,
          reason: "test",
          fallback: false
        },
        [
          {
            id: "obs-glucose",
            resourceType: "Observation",
            sourceLabel: "Glucose",
            codeTexts: ["Glucose"],
            source: "provider"
          }
        ],
        [
          {
            conditionGroupId: "Condition:diabetes",
            name: "Type 2 Diabetes"
          }
        ]
      )
    ).resolves.toEqual([]);
  });

  it("matches only one patient condition for a valid direct target", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[{"conditionName":"Type 2 Diabetes","confidence":0.9}]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    const associations = await associateLabGroupWithConditionsWithWebLlm(
      {
        groupId: "observation-glucose",
        patientFriendlyName: "Glucose",
        resourceIds: ["obs-glucose"],
        resourceTypes: ["Observation"],
        observationBucket: "labs",
        confidence: 0.9,
        reason: "test",
        fallback: false
      },
      [
        {
          id: "obs-glucose",
          resourceType: "Observation",
          sourceLabel: "Glucose",
          codeTexts: ["Glucose"],
          source: "provider"
        }
      ],
      [
        {
          conditionGroupId: "Condition:diabetes",
          name: "Type 2 Diabetes"
        },
        {
          conditionGroupId: "Condition:hypertension",
          name: "High Blood Pressure"
        }
      ]
    );

    expect(associations).toEqual([
      {
        conditionGroupId: "Condition:diabetes",
        relationship: "monitoring_marker",
        confidence: 0.9,
        fallback: false
      }
    ]);
  });

  it("passes explicit related record context and accepts direct lab-condition evidence", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[{"conditionName":"Type 2 Diabetes","confidence":0.9}]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    const associations = await associateLabGroupWithConditionsWithWebLlm(
      {
        groupId: "observation-a1c",
        patientFriendlyName: "Hemoglobin A1c",
        resourceIds: ["obs-a1c"],
        resourceTypes: ["Observation"],
        observationBucket: "labs",
        confidence: 0.9,
        reason: "test",
        fallback: false
      },
      [
        {
          id: "obs-a1c",
          resourceType: "Observation",
          sourceLabel: "Hemoglobin A1c",
          codeTexts: ["Hemoglobin A1c"],
          source: "provider"
        }
      ],
      [
        {
          conditionGroupId: "Condition:diabetes",
          name: "Type 2 Diabetes"
        },
        {
          conditionGroupId: "Condition:hypertension",
          name: "High Blood Pressure"
        }
      ],
      {},
      { explicitRelatedContext: ["Report result: Reports: Diabetes monitoring lab report"] }
    );

    expect(associations).toEqual([
      {
        conditionGroupId: "Condition:diabetes",
        relationship: "monitoring_marker",
        confidence: 0.9,
        fallback: false
      }
    ]);
    const userMessage = JSON.parse(mocks.createCompletion.mock.calls[0][0].messages[1].content);
    expect(userMessage.referenceContext).toContain("Report result: Reports: Diabetes monitoring lab report");
    expect(userMessage.conditionChoices).toEqual([
      {
        conditionGroupId: "Condition:diabetes",
        name: "Type 2 Diabetes"
      },
      {
        conditionGroupId: "Condition:hypertension",
        name: "High Blood Pressure"
      }
    ]);
    expect(userMessage.validConditionGroupIds).toBeUndefined();
  });

  it("builds local playground cases with editable messages and constrained schemas", async () => {
    const { webLlmPlaygroundCases } = await import("../../src/lib/llm/webllm");
    const cases = webLlmPlaygroundCases();
    const labCase = cases.find((item) => item.id === "lab-condition-glucose");

    expect(labCase).toBeTruthy();
    expect(labCase?.messages.map((message) => message.role)).toEqual(["system", "user"]);
    const labCasePayload = JSON.parse(labCase?.messages[1].content ?? "{}");
    expect(labCasePayload.measurement.name).toBe("Glucose");
    expect(labCasePayload.conditionChoices).toHaveLength(2);
    expect(labCasePayload.conditionChoices).toEqual([
      {
        conditionGroupId: "Condition:condition-type-2-diabetes",
        name: "Type 2 Diabetes"
      },
      {
        conditionGroupId: "Condition:condition-high-blood-pressure",
        name: "High Blood Pressure"
      }
    ]);
    const schema = JSON.parse(labCase?.schemaText ?? "{}");
    expect(schema.properties.associations.type).toBe("array");
    expect(schema.properties.associations.items.properties.conditionName.enum).toEqual([
      "Type 2 Diabetes",
      "High Blood Pressure"
    ]);
    expect(schema.properties.associations.items.properties.confidence.enum).toEqual(["high", "medium", "low"]);
  });

  it("runs lab-condition eval suites against the shared matcher and confidence gate", async () => {
    mocks.createCompletion
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '{"associations":[{"conditionName":"Type 2 Diabetes","confidence":"high"}]}'
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '{"associations":[{"conditionName":"High Blood Pressure","confidence":"medium"}]}'
            }
          }
        ]
      });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { runLabAssociationEvalSuite } = await import("../../src/lib/llm/webllm");
    const conditionChoices = [
      {
        conditionGroupId: "Condition:diabetes",
        name: "Type 2 Diabetes"
      },
      {
        conditionGroupId: "Condition:hypertension",
        name: "High Blood Pressure"
      }
    ];

    const result = await runLabAssociationEvalSuite({
      cases: [
        {
          id: "glucose",
          labName: "Glucose",
          conditionChoices,
          expectedAcceptedConditionGroupIds: ["Condition:diabetes"]
        },
        {
          id: "vitamin-d",
          labName: "Vitamin D",
          conditionChoices,
          expectedAcceptedConditionGroupIds: []
        }
      ]
    });

    expect(result).toMatchObject({
      caseCount: 2,
      passedCount: 2,
      failedCount: 0,
      errorCount: 0
    });
    expect(result.results[0]).toMatchObject({
      caseId: "glucose",
      confidenceLabels: ["high"],
      acceptedAssociations: [
        {
          conditionGroupId: "Condition:diabetes",
          confidence: 0.95
        }
      ],
      passed: true
    });
    expect(result.results[1]).toMatchObject({
      caseId: "vitamin-d",
      confidenceLabels: ["medium"],
      acceptedAssociations: [],
      rejectedReasons: {
        not_high_confidence: 1
      },
      passed: true
    });

    const firstRequest = mocks.createCompletion.mock.calls[0][0];
    expect(firstRequest.max_tokens).toBe(180);
  });

  it("allows lab-condition eval suites to override payload templates and schemas", async () => {
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"decision":"diabetes","confidence":"high"}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { runLabAssociationEvalSuite } = await import("../../src/lib/llm/webllm");
    const schemaText = JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["decision", "confidence"],
      properties: {
        decision: { type: "string" },
        confidence: { type: "string", enum: ["high", "none"] }
      }
    });

    const result = await runLabAssociationEvalSuite({
      systemPrompt: "Return a compact decision.",
      userPromptTemplate: {
        measurementName: "{{labName}}",
        measurementId: "{{labGroupId}}",
        choices: "{{conditionChoices}}"
      },
      schemaText,
      maxTokens: 44,
      cases: [
        {
          id: "custom-glucose",
          labName: "Glucose",
          labGroupId: "Observation:glucose",
          conditionChoices: [
            {
              conditionGroupId: "Condition:hypertension",
              name: "High Blood Pressure"
            },
            {
              conditionGroupId: "Condition:diabetes",
              name: "Type 2 Diabetes"
            }
          ]
        }
      ]
    });

    expect(result.results[0].parsed).toEqual({
      decision: "diabetes",
      confidence: "high"
    });
    const request = mocks.createCompletion.mock.calls[0][0];
    expect(request.max_tokens).toBe(44);
    expect(request.messages[0].content).toBe("Return a compact decision.");
    expect(JSON.parse(request.messages[1].content)).toEqual({
      measurementName: "Glucose",
      measurementId: "Observation:glucose",
      choices: JSON.stringify([
        {
          conditionGroupId: "Condition:hypertension",
          name: "High Blood Pressure"
        },
        {
          conditionGroupId: "Condition:diabetes",
          name: "Type 2 Diabetes"
        }
      ])
    });
  });

  it("uses a live system prompt override for lab-condition association", async () => {
    window.sessionStorage.setItem("fhir4px_webllm_lab_condition_system_prompt", "OVERRIDE_SYS_PROMPT");
    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    await associateLabGroupWithConditionsWithWebLlm(
      {
        groupId: "observation-a1c",
        patientFriendlyName: "Hemoglobin A1c",
        resourceIds: ["obs-a1c"],
        resourceTypes: ["Observation"],
        observationBucket: "labs",
        confidence: 0.9,
        reason: "test",
        fallback: false
      },
      [
        {
          id: "obs-a1c",
          resourceType: "Observation",
          sourceLabel: "Hemoglobin A1c",
          codeTexts: ["Hemoglobin A1c"],
          source: "provider"
        }
      ],
      [
        {
          conditionGroupId: "Condition:diabetes",
          name: "Type 2 Diabetes"
        }
      ]
    );

    expect(mocks.createCompletion.mock.calls[0][0].messages[0].content).toBe("OVERRIDE_SYS_PROMPT");
  });

  it("applies lab-condition user prompt patch overrides", async () => {
    window.sessionStorage.setItem(
      "fhir4px_webllm_lab_condition_user_payload",
      JSON.stringify({
        outputShape: "PATCHED_OUTPUT_SHAPE",
        lab: {
          name: "Patched Lab Name"
        },
        referenceContext: ["Override context 1", "Override context 2"],
        conditionChoices: [
          {
            conditionGroupId: "Condition:custom",
            name: "Custom Condition"
          }
        ]
      })
    );

    mocks.createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"associations":[]}'
          }
        }
      ]
    });
    mocks.createEngine.mockResolvedValueOnce({
      chat: {
        completions: {
          create: mocks.createCompletion
        }
      }
    });

    const { associateLabGroupWithConditionsWithWebLlm } = await import("../../src/lib/llm/webllm");

    await associateLabGroupWithConditionsWithWebLlm(
      {
        groupId: "observation-bp",
        patientFriendlyName: "Blood Pressure",
        resourceIds: ["obs-bp"],
        resourceTypes: ["Observation"],
        observationBucket: "vitals",
        confidence: 0.9,
        reason: "test",
        fallback: false
      },
      [
        {
          id: "obs-bp",
          resourceType: "Observation",
          sourceLabel: "Blood Pressure",
          codeTexts: ["Blood Pressure"],
          source: "provider"
        }
      ],
      [
        {
          conditionGroupId: "Condition:hypertension",
          name: "High Blood Pressure"
        }
      ]
    );

    const userPrompt = JSON.parse(mocks.createCompletion.mock.calls[0][0].messages[1].content);
    expect(userPrompt.outputShape).toBe("PATCHED_OUTPUT_SHAPE");
    expect(userPrompt.lab.name).toBe("Patched Lab Name");
    expect(userPrompt.measurement.name).toBe("Patched Lab Name");
    expect(userPrompt.referenceContext).toEqual(["Override context 1", "Override context 2"]);
    expect(userPrompt.conditionChoices).toEqual([
      {
        conditionGroupId: "Condition:custom",
        name: "Custom Condition"
      }
    ]);
  });
});
