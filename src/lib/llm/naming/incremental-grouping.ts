import type { GroupableRecord } from "../../fhir/patient-groups";
import type { NamingResult, NamingOptions, NamingIncrementalUpdate } from "./types";
import { nameRecords } from "./naming-engine";
import { incrementalNamingBatchSize, canonicalName, slug } from "./shared-helpers";

interface GroupAccumulator {
  patientFriendlyName: string;
  resourceIds: string[];
  resourceTypes: string[];
  observationBucket?: string;
  confidence: number;
  fallback: boolean;
}

function groupingKey(name: string, bucket?: string): string {
  return `${canonicalName(name)}|${bucket ?? ""}`;
}

export async function* groupWithNamingIncrementalStream(
  records: GroupableRecord[],
  options: NamingOptions = {}
): AsyncGenerator<NamingIncrementalUpdate, void, void> {
  if (records.length === 0) return;

  const batchSize = incrementalNamingBatchSize(options);
  const batches: GroupableRecord[][] = [];
  for (let i = 0; i < records.length; i += batchSize) {
    batches.push(records.slice(i, i + batchSize));
  }

  let availableNames = [...(options.initialAvailableNames ?? [])];
  const groupsByName = new Map<string, GroupAccumulator>();
  const completedRecords: GroupableRecord[] = [];
  let completedCount = 0;

  console.info("[fhir4px:naming]", {
    event: "naming-stream-start",
    totalRecords: records.length,
    batchCount: batches.length,
    batchSize,
    initialAvailableNames: availableNames.length,
    timestamp: new Date().toISOString()
  });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    options.onProgress?.(`Naming records... ${completedCount + 1}/${records.length}`);

    // Yield to the event loop before each batch so pending UI events (tab
    // clicks, scroll, state updates) can process. Inference itself still
    // blocks the calling thread, but between batches the UI catches up.
    await new Promise((resolve) => setTimeout(resolve, 0));

    console.info("[fhir4px:naming]", {
      event: "naming-batch-start",
      batchIndex: batchIndex + 1,
      batchCount: batches.length,
      recordCount: batch.length,
      completedBeforeBatch: completedCount,
      timestamp: new Date().toISOString()
    });

    const results = await nameRecords(batch, availableNames, options);

    for (const result of results) {
      const key = groupingKey(result.patientFriendlyName, result.observationBucket);
      const existing = groupsByName.get(key);
      const record = records.find((r) => r.id === result.id);
      if (!record) continue;

      if (existing) {
        existing.resourceIds.push(result.id);
        existing.confidence = Math.max(existing.confidence, result.confidence);
        existing.fallback = existing.fallback || result.fallback;
      } else {
        groupsByName.set(key, {
          patientFriendlyName: result.patientFriendlyName,
          resourceIds: [result.id],
          resourceTypes: [record.resourceType],
          observationBucket: result.observationBucket,
          confidence: result.confidence,
          fallback: result.fallback
        });
      }

      completedRecords.push(record);
      if (!availableNames.includes(result.patientFriendlyName)) {
        availableNames.push(result.patientFriendlyName);
      }
    }

    completedCount += batch.length;

    console.info("[fhir4px:naming]", {
      event: "naming-batch-complete",
      batchIndex: batchIndex + 1,
      batchCount: batches.length,
      completedCount,
      totalCount: records.length,
      groupCount: groupsByName.size,
      names: results.map((r) => r.patientFriendlyName),
      timestamp: new Date().toISOString()
    });
    const pendingRecords = records.filter((r) => !completedRecords.includes(r));

    const groups = [...groupsByName.values()].map((g) => ({
      groupId: `${slug(g.patientFriendlyName)}-${g.resourceIds.length}`,
      patientFriendlyName: g.patientFriendlyName,
      resourceIds: g.resourceIds,
      resourceTypes: [...new Set(g.resourceTypes)],
      observationBucket: g.observationBucket,
      confidence: g.confidence,
      reason: g.fallback ? "source-label-fallback" : "llm-naming",
      fallback: g.fallback
    }));

    yield {
      result: { groups, unassigned: [] },
      completedRecords: [...completedRecords],
      pendingRecords,
      completedCount,
      totalCount: records.length,
      batchIndex: batchIndex + 1,
      batchCount: batches.length
    };
  }
}
