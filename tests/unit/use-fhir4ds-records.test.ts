import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setFhir4dsWorkerForTest, type Fhir4dsPatientMatch, type Fhir4dsWorkerLike } from "../../src/lib/engine/fhir4ds-client";
import type { Fhir4dsRequest, Fhir4dsResponse } from "../../src/lib/engine/fhir4ds.worker";
import {
  patientMatchVerdict,
  useFhir4dsDedup,
  useFhir4dsPatientMatching,
  type DedupInputRecord
} from "../../src/lib/app/use-fhir4ds-records";

/** Every request is answered with `answer(request)` by the stand-in worker. */
function answerWith(answer: (request: Fhir4dsRequest) => unknown): void {
  setFhir4dsWorkerForTest({
    factory: () => {
      let reply: (response: Fhir4dsResponse) => void = () => {};
      const worker: Fhir4dsWorkerLike = {
        postMessage: (request) => {
          queueMicrotask(() => reply({ id: request.id, ok: true, result: answer(request) }));
        },
        terminate: () => {},
        onmessage: (handler) => {
          reply = handler;
        },
        onerror: () => {}
      };
      return worker;
    }
  });
}

/** The stand-in worker reports `message` as an error for every request. */
function failWith(message: string): void {
  setFhir4dsWorkerForTest({
    factory: () => {
      let fail: (text: string) => void = () => {};
      const worker: Fhir4dsWorkerLike = {
        postMessage: () => {
          setTimeout(() => fail(message), 1);
        },
        terminate: () => {},
        onmessage: () => {},
        onerror: (handler) => {
          fail = handler;
        }
      };
      return worker;
    }
  });
}

const observation = (id: string): DedupInputRecord => ({ id, resource: { resourceType: "Observation", id } });
const first = [observation("rec-0"), observation("rec-1")];
const second = [observation("rec-2"), observation("rec-3"), observation("rec-4")];

const dedupAnswer = (request: Fhir4dsRequest) => ({
  clusters: [["r0", "r1"]],
  stats: { records: request.kind === "dedup" ? request.resources.length : 0 },
  warningLines: 0
});

const matchReport = (matched: number[][]): Fhir4dsPatientMatch[] =>
  matched.map((others, index) => ({
    index,
    outcome: others.length > 0 ? "match" : "no_match",
    rule: null,
    confidence: null,
    matchType: "exact",
    matched: others,
    evidence: {}
  }));

describe("useFhir4dsDedup", () => {
  it("does nothing until it is started, then reports the clusters fhir4ds found", async () => {
    answerWith(dedupAnswer);
    const { result, rerender } = renderHook(({ start }) => useFhir4dsDedup(first, start), {
      initialProps: { start: false }
    });
    expect(result.current).toBeNull();

    rerender({ start: true });
    await waitFor(() => expect(result.current?.state).toBe("done"));
    expect(result.current?.mergedCount).toBe(1);
    expect(result.current?.links?.covered).toEqual(new Set(["rec-0", "rec-1"]));
    expect(result.current?.links?.clusterByRecordId.get("rec-1")).toBe(0);
  });

  it("reports a failed run and leaves no decisions behind", async () => {
    failWith("no DuckDB in this browser");
    const { result } = renderHook(() => useFhir4dsDedup(first, true));
    await waitFor(() => expect(result.current?.state).toBe("failed"));
    expect(result.current?.error).toBe("no DuckDB in this browser");
    expect(result.current?.links).toBeNull();
  });

  it("drops the result when the records change, and runs again for the new ones", async () => {
    answerWith(dedupAnswer);
    const { result, rerender } = renderHook(({ records }) => useFhir4dsDedup(records, true), {
      initialProps: { records: first }
    });
    await waitFor(() => expect(result.current?.state).toBe("done"));
    expect(result.current?.links?.covered.has("rec-0")).toBe(true);

    rerender({ records: second });
    expect(result.current?.links?.covered.has("rec-0") ?? false).toBe(false);
    await waitFor(() => expect(result.current?.state).toBe("done"));
    expect(result.current?.links?.covered).toEqual(new Set(["rec-2", "rec-3", "rec-4"]));
  });

  it("returns nothing for an empty record set", async () => {
    answerWith(dedupAnswer);
    const { result } = renderHook(() => useFhir4dsDedup([], true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeNull();
  });
});

describe("useFhir4dsPatientMatching", () => {
  const patient = (id: string) => ({ resourceType: "Patient", id, birthDate: "1980-01-01", name: [{ family: "Doe", given: ["Jane"] }] });

  it("compares every patient with every other one", async () => {
    answerWith(() => matchReport([[1], [0], []]));
    const { result } = renderHook(() => useFhir4dsPatientMatching([patient("a"), patient("b"), patient("c")], true));
    await waitFor(() => expect(result.current?.state).toBe("done"));
    expect(result.current?.verdict).toEqual({ status: "different", pairs: [{ first: 0, second: 2 }, { first: 1, second: 2 }] });
  });

  it("does nothing with fewer than two patients", async () => {
    answerWith(() => matchReport([[]]));
    const { result } = renderHook(() => useFhir4dsPatientMatching([patient("a")], true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeNull();
  });
});

describe("patientMatchVerdict", () => {
  it("is the same person when every pair matches", () => {
    expect(patientMatchVerdict(matchReport([[1], [0]]), 2)).toEqual({ status: "same" });
  });

  it("is a different person as soon as one pair does not match", () => {
    expect(patientMatchVerdict(matchReport([[], []]), 2)).toEqual({ status: "different", pairs: [{ first: 0, second: 1 }] });
  });

  it("accepts a match reported by either side of a pair", () => {
    expect(patientMatchVerdict(matchReport([[1], []]), 2)).toEqual({ status: "same" });
    expect(patientMatchVerdict(matchReport([[], [0]]), 2)).toEqual({ status: "same" });
  });

  it("is unconfirmed when a pair could not be decided and none is different", () => {
    const report = matchReport([[], []]);
    const undecided = report.map((entry, index): Fhir4dsPatientMatch => (index === 0 ? { ...entry, outcome: "ambiguous" } : entry));
    expect(patientMatchVerdict(undecided, 2)).toEqual({ status: "unconfirmed", pairs: [{ first: 0, second: 1 }] });
  });

  it("has nothing to say about fewer than two patients", () => {
    expect(patientMatchVerdict(matchReport([[]]), 1)).toBeNull();
  });
});
