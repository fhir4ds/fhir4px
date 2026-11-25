import { describe, expect, it } from "vitest";
import { dedupeGroupedRecords, duplicateLinksFromClusters } from "../../src/lib/fhir/dedupe";
import type { GroupableRecord } from "../../src/lib/fhir/patient-groups";

function record(overrides: Partial<GroupableRecord> & Pick<GroupableRecord, "id" | "resourceType" | "sourceLabel">): GroupableRecord {
  return {
    source: "provider",
    portalSourceId: "portal-a",
    portalSourceName: "Portal A",
    ...overrides
  };
}

/** Two of these from different portals are copies under the local rule (same code, time and value). */
function a1c(id: string, portal: string): GroupableRecord {
  return record({
    id,
    resourceType: "Observation",
    sourceLabel: "Hemoglobin A1c",
    portalSourceId: portal,
    portalSourceName: portal,
    codingKeys: ["loinc:4548-4"],
    codeTexts: ["Hemoglobin A1c"],
    date: "2024-01-01T09:30:15Z",
    displayValue: "7.2 %",
    canonicalValue: 7.2,
    canonicalUnit: "%"
  });
}

describe("duplicateLinksFromClusters", () => {
  it("marks every examined record and maps the copies to their cluster", () => {
    const links = duplicateLinksFromClusters(["a", "b", "c", "d"], [["a", "b"], ["c", "d"]]);
    expect([...links.covered].sort()).toEqual(["a", "b", "c", "d"]);
    expect(links.clusterByRecordId.get("a")).toBe(0);
    expect(links.clusterByRecordId.get("b")).toBe(0);
    expect(links.clusterByRecordId.get("d")).toBe(1);
    expect(links.clusterByRecordId.has("e")).toBe(false);
  });
});

describe("dedupeGroupedRecords with fhir4ds decisions", () => {
  it("merges copies inside one portal when fhir4ds put them in one cluster", () => {
    const links = duplicateLinksFromClusters(["a1", "a2"], [["a1", "a2"]]);
    const clusters = dedupeGroupedRecords([a1c("a1", "portal-a"), a1c("a2", "portal-a")], links);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records.map((entry) => entry.id).sort()).toEqual(["a1", "a2"]);
    expect(clusters[0].matchReason).toBe("Copies of one record, found by fhir4ds deduplication.");
  });

  it("keeps apart records the local rule would merge when fhir4ds found no copy", () => {
    const links = duplicateLinksFromClusters(["a1", "b1"], []);
    const clusters = dedupeGroupedRecords([a1c("a1", "portal-a"), a1c("b1", "portal-b")], links);
    expect(clusters).toHaveLength(2);
  });

  it("never joins records from two different fhir4ds clusters", () => {
    const links = duplicateLinksFromClusters(["a1", "a2", "b1", "b2"], [["a1", "b1"], ["a2", "b2"]]);
    const clusters = dedupeGroupedRecords(
      [a1c("a1", "portal-a"), a1c("a2", "portal-a"), a1c("b1", "portal-b"), a1c("b2", "portal-b")],
      links
    );
    expect(clusters.map((cluster) => cluster.records.map((entry) => entry.id).sort())).toEqual([
      ["a1", "b1"],
      ["a2", "b2"]
    ]);
  });

  it("still uses the local rule for a record fhir4ds did not examine", () => {
    const links = duplicateLinksFromClusters(["a1"], []);
    const clusters = dedupeGroupedRecords([a1c("a1", "portal-a"), a1c("b1", "portal-b")], links);
    expect(clusters).toHaveLength(1);
  });

  it("is unchanged when fhir4ds has not reported", () => {
    const records = [a1c("a1", "portal-a"), a1c("a2", "portal-a"), a1c("b1", "portal-b")];
    expect(dedupeGroupedRecords(records, null)).toEqual(dedupeGroupedRecords(records));
    expect(dedupeGroupedRecords(records)).toHaveLength(2);
  });
});
