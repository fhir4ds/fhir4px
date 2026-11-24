import { describe, expect, it } from "vitest";
import {
  completeConnection,
  getConnectionStatus,
  publishConnectionStatus,
  publishConnections,
  sourceChipLabel
} from "../../src/lib/app/connection-status";

describe("sourceChipLabel", () => {
  it("adds the record count to the connection label", () => {
    expect(sourceChipLabel({ label: "SMART Dev Sandbox · Grace Mensah", recordCount: 29 })).toBe(
      "SMART Dev Sandbox · Grace Mensah · 29 records"
    );
  });

  it("uses the singular for one record", () => {
    expect(sourceChipLabel({ label: "Portal", recordCount: 1 })).toBe("Portal · 1 record");
  });

  it("shows the label alone while the record count is unknown", () => {
    expect(sourceChipLabel({ label: "SMART Dev Sandbox · Grace Mensah" })).toBe("SMART Dev Sandbox · Grace Mensah");
  });
});

describe("publishConnections", () => {
  const disconnected = () =>
    publishConnectionStatus({ phase: "disconnected" as const, label: "No portal connected", sources: [] });

  it("makes the stored connections known before the Records page has", () => {
    disconnected();

    publishConnections([{ id: "s1", label: "Portal · Pat", status: "ready", recordCount: 29 }]);

    expect(getConnectionStatus()).toMatchObject({
      phase: "connected",
      label: "Portal · Pat · 29 records",
      sources: [{ id: "s1" }]
    });
  });

  it("leaves alone what the Records page published", () => {
    // That page's view is the live one.
    publishConnections([{ id: "s2", label: "Other portal", status: "ready" }]);

    expect(getConnectionStatus().sources.map((source) => source.id)).toEqual(["s1"]);
  });

  it("changes nothing when there are no stored connections", () => {
    publishConnectionStatus({ phase: "connected" as const, label: "Portal · Pat · 29 records", sources: [{ id: "s1", label: "Portal · Pat", status: "ready", recordCount: 29 }] });

    publishConnections([]);

    expect(getConnectionStatus().phase).toBe("connected");
  });
});

describe("completeConnection", () => {
  it("adds the patient and record count a stored connection did not have yet", () => {
    publishConnectionStatus({
      phase: "disconnected" as const,
      label: "No portal connected",
      sources: []
    });
    publishConnections([{ id: "s1", label: "SMART Dev Sandbox", status: "connected" }]);

    completeConnection({ patientName: "Pat Explorer", recordCount: 12 });

    expect(getConnectionStatus()).toMatchObject({
      label: "SMART Dev Sandbox · Pat Explorer · 12 records",
      sources: [{ id: "s1", label: "SMART Dev Sandbox · Pat Explorer", recordCount: 12 }]
    });
  });

  it("keeps what the Records page already knows", () => {
    // The live fetch result wins over the evaluation's count.
    completeConnection({ patientName: "Someone Else", recordCount: 99 });

    expect(getConnectionStatus().sources[0]).toMatchObject({ label: "SMART Dev Sandbox · Pat Explorer", recordCount: 12 });
  });

  it("does not spread one dataset over several connections", () => {
    publishConnectionStatus({
      phase: "connected" as const,
      label: "2 portals connected",
      sources: [
        { id: "s1", label: "Portal A", status: "connected" },
        { id: "s2", label: "Portal B", status: "connected" }
      ]
    });

    completeConnection({ patientName: "Pat Explorer", recordCount: 12 });

    expect(getConnectionStatus().sources.map((source) => source.label)).toEqual(["Portal A", "Portal B"]);
  });
});
