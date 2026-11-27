import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeConnection,
  connectionChipText,
  getConnectionStatus,
  publishConnectionStatus,
  publishConnections,
  publishPatient,
  publishPatientSelection,
  publishRecordChecks,
  sourceChipLabel,
  subscribeConnectionStatus,
  type RecordChecks
} from "../../src/lib/app/connection-status";
import type { PatientHeaderInfo } from "../../src/lib/fhir/patient-header";

function patient(name: string): PatientHeaderInfo {
  return { name, contacts: [], profileCount: 1 };
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

// Keep this describe LAST in the file: the latch keeps module-level time state.
describe("connectionChipText", () => {
  const source = (id: string, recordCount?: number) => ({
    id,
    label: `SMART Dev Sandbox · Patient ${id}`,
    providerLabel: "SMART Dev Sandbox",
    status: "ready",
    recordCount
  });

  it("keeps one portal's name and count", () => {
    expect(connectionChipText([source("a", 9)], null)).toBe("SMART Dev Sandbox · 9 records");
  });

  it("leaves the count off one portal that has not delivered yet", () => {
    expect(connectionChipText([source("a")], null)).toBe("SMART Dev Sandbox");
  });

  it("collapses several portals to a count, with the record count on screen", () => {
    expect(connectionChipText([source("a", 250), source("b", 9)], 252)).toBe("2 portals · 252 records");
  });

  it("uses the singular for one record on screen", () => {
    expect(connectionChipText([source("a", 2), source("b", 1)], 1)).toBe("2 portals · 1 record");
  });

  it("counts portals alone when no page has published a record count", () => {
    expect(connectionChipText([source("a", 250), source("b", 9)], null)).toBe("2 portals");
  });

  it("calls them sources once a received file is among them", () => {
    const received = { ...source("c", 40), kind: "bundle" as const, label: "Received bundle · file.json" };
    expect(connectionChipText([source("a", 250), received], 290)).toBe("2 sources · 290 records");
  });
});

describe("record checks", () => {
  it("reach the listeners and survive a status publish that does not mention them", () => {
    disconnect();
    const checks: RecordChecks = { dedup: { state: "done", merged: 26 }, patientMatch: null };
    const seen: Array<RecordChecks | null | undefined> = [];
    const unsubscribe = subscribeConnectionStatus((state) => seen.push(state.recordChecks));

    publishRecordChecks(checks);
    expect(getConnectionStatus().recordChecks).toEqual(checks);
    expect(seen.at(-1)).toEqual(checks);

    // The Records page publishes its settled state once grouping is over.
    publishConnectionStatus({ phase: "connected", label: "SMART Dev Sandbox · 282 records", sources: [] });
    expect(getConnectionStatus().recordChecks).toEqual(checks);
    unsubscribe();
  });

  it("can be cleared for the next patient", () => {
    publishRecordChecks(null);
    expect(getConnectionStatus().recordChecks).toBeNull();
  });
});

describe("the patient switcher", () => {
  it("reaches the listeners and survives a status publish that does not mention it", () => {
    disconnect();
    const selection = {
      choices: [
        { id: "portal-a", label: "Grace Mensah", detail: "SMART Dev Sandbox" },
        { id: "portal-b", label: "Linda Ross", detail: "SMART Dev Sandbox" }
      ],
      selectedId: "portal-b"
    };
    publishPatientSelection(selection);
    expect(getConnectionStatus().patientSelection).toEqual(selection);

    publishConnectionStatus({ phase: "connected", label: "SMART Dev Sandbox · 250 records", sources: [] });
    expect(getConnectionStatus().patientSelection).toEqual(selection);
  });

  it("goes away when the portals turn out to be one person", () => {
    publishPatientSelection(null);
    expect(getConnectionStatus().patientSelection).toBeNull();
  });
});

describe("the working latch", () => {
  const sources = [{ id: "s1", label: "Portal", status: "ready", recordCount: 9 }];
  afterEach(() => {
    // Let a held state out and stop the fake clock.
    if (vi.isFakeTimers()) {
      vi.advanceTimersByTime(6000);
      vi.useRealTimers();
    }
  });

  it("publishes a settled state that arrives inside the window once the window ends", () => {
    vi.useFakeTimers();
    publishConnectionStatus({ phase: "evaluating", label: "Evaluating quality measures", sources });
    vi.advanceTimersByTime(1000);
    publishConnectionStatus({ phase: "connected", label: "Portal · 9 records", sources });

    // Inside the window the working label stays, so the chip does not flicker.
    expect(getConnectionStatus().phase).toBe("evaluating");
    vi.advanceTimersByTime(2999);
    expect(getConnectionStatus().phase).toBe("evaluating");
    vi.advanceTimersByTime(2);
    expect(getConnectionStatus().phase).toBe("connected");
    expect(getConnectionStatus().label).toBe("Portal · 9 records");
  });

  it("replaces a held state with a newer working state", () => {
    vi.useFakeTimers();
    publishConnectionStatus({ phase: "loading", label: "Downloading medical records...", sources });
    vi.advanceTimersByTime(500);
    publishConnectionStatus({ phase: "connected", label: "Portal · 9 records", sources });
    vi.advanceTimersByTime(500);
    publishConnectionStatus({ phase: "loading", label: "Organizing medical records...", sources });

    expect(getConnectionStatus().label).toBe("Organizing medical records...");
    // The held "connected" state must not appear behind the new work.
    vi.advanceTimersByTime(5000);
    expect(getConnectionStatus().phase).toBe("loading");
    expect(getConnectionStatus().label).toBe("Organizing medical records...");
  });

  it("publishes at once outside the window", () => {
    vi.useFakeTimers();
    publishConnectionStatus({ phase: "loading", label: "Organizing medical records...", sources });
    vi.advanceTimersByTime(4000);
    publishConnectionStatus({ phase: "connected", label: "Portal · 9 records", sources });
    expect(getConnectionStatus().phase).toBe("connected");
  });

  it("keeps the patient that was published while a state was held", () => {
    vi.useFakeTimers();
    publishPatient(patient("Pat"));
    publishConnectionStatus({ phase: "evaluating", label: "Evaluating quality measures", sources });
    publishConnectionStatus({ phase: "connected", label: "Portal · 9 records", sources });
    publishPatient(patient("Robin"));
    vi.advanceTimersByTime(4000);

    expect(getConnectionStatus().phase).toBe("connected");
    expect(getConnectionStatus().patient?.name).toBe("Robin");
  });
});
