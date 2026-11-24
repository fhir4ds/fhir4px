import { describe, expect, it } from "vitest";
import {
  completeConnection,
  getConnectionStatus,
  publishConnectionStatus,
  publishConnections,
  publishPatient,
  sourceChipLabel
} from "../../src/lib/app/connection-status";
import type { PatientHeaderInfo } from "../../src/lib/fhir/patient-header";

function patient(name: string): PatientHeaderInfo {
  return { name, telecoms: [], profileCount: 1, otherPatients: 0 };
}

function disconnect(): void {
  publishPatient(null);
  publishConnectionStatus({ phase: "disconnected", label: "No portal connected", sources: [] });
}

describe("sourceChipLabel", () => {
  it("adds the record count to the portal name", () => {
    expect(sourceChipLabel({ label: "SMART Dev Sandbox", recordCount: 29 })).toBe("SMART Dev Sandbox · 29 records");
  });

  it("uses the singular for one record", () => {
    expect(sourceChipLabel({ label: "Portal", recordCount: 1 })).toBe("Portal · 1 record");
  });

  it("shows the label alone while the record count is unknown", () => {
    expect(sourceChipLabel({ label: "SMART Dev Sandbox" })).toBe("SMART Dev Sandbox");
  });
});

describe("publishConnections", () => {
  it("makes the stored connections known before the Records page has", () => {
    disconnect();

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
    publishConnectionStatus({
      phase: "connected" as const,
      label: "Portal · Pat · 29 records",
      sources: [{ id: "s1", label: "Portal · Pat", status: "ready", recordCount: 29 }]
    });

    publishConnections([]);

    expect(getConnectionStatus().phase).toBe("connected");
  });
});

describe("completeConnection", () => {
  it("adds the record count and the patient a stored connection did not have yet", () => {
    disconnect();
    publishConnections([{ id: "s1", label: "SMART Dev Sandbox", status: "connected" }]);

    completeConnection({ patient: patient("Pat Explorer"), recordCount: 12 });

    expect(getConnectionStatus()).toMatchObject({
      label: "SMART Dev Sandbox · 12 records",
      sources: [{ id: "s1", label: "SMART Dev Sandbox", recordCount: 12 }],
      patient: { name: "Pat Explorer" }
    });
  });

  it("keeps what the Records page already knows", () => {
    // The live fetch result and its patient win over the evaluation's.
    completeConnection({ patient: patient("Someone Else"), recordCount: 99 });

    expect(getConnectionStatus().sources[0]).toMatchObject({ recordCount: 12 });
    expect(getConnectionStatus().patient?.name).toBe("Pat Explorer");
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

    completeConnection({ patient: patient("Pat Explorer"), recordCount: 12 });

    expect(getConnectionStatus().sources.map((source) => source.label)).toEqual(["Portal A", "Portal B"]);
  });
});

describe("the header patient", () => {
  it("is cleared at once when the next dataset starts loading", () => {
    disconnect();
    publishPatient(patient("Pat Explorer"));

    publishPatient(null);

    expect(getConnectionStatus().patient).toBeNull();
  });

  it("survives a status publish that does not speak to it", () => {
    publishPatient(patient("Pat Explorer"));

    publishConnectionStatus({
      phase: "loading" as const,
      label: "Searching patient-friendly names...",
      sources: [{ id: "s1", label: "SMART Dev Sandbox · Pat Explorer", status: "ready", recordCount: 12 }]
    });

    expect(getConnectionStatus().patient?.name).toBe("Pat Explorer");
  });
});
