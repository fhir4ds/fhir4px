import { describe, expect, it, vi } from "vitest";
import {
  fhir4dsDeduplicate,
  fhir4dsMatchPatients,
  setFhir4dsWorkerForTest,
  type Fhir4dsWorkerLike
} from "../../src/lib/engine/fhir4ds-client";
import type { Fhir4dsRequest, Fhir4dsResponse } from "../../src/lib/engine/fhir4ds.worker";

/** Stands in for the real worker: tests answer each request by hand. */
class FakeWorker implements Fhir4dsWorkerLike {
  posted: Fhir4dsRequest[] = [];
  terminated = false;
  onPost: ((request: Fhir4dsRequest) => void) | null = null;
  private reply: (response: Fhir4dsResponse) => void = () => {};
  private fail: (message: string) => void = () => {};

  postMessage(message: Fhir4dsRequest): void {
    this.posted.push(message);
    this.onPost?.(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  onmessage(handler: (response: Fhir4dsResponse) => void): void {
    this.reply = handler;
  }
  onerror(handler: (message: string) => void): void {
    this.fail = handler;
  }
  resolve(request: Fhir4dsRequest, result: unknown): void {
    this.reply({ id: request.id, ok: true, result });
  }
  reject(request: Fhir4dsRequest, error: string): void {
    this.reply({ id: request.id, ok: false, error });
  }
  crash(message = "worker crashed"): void {
    this.fail(message);
  }
}

const resources = [
  { resourceType: "Observation", id: "r0" },
  { resourceType: "Observation", id: "r1" }
];
const outcome = { clusters: [["r0", "r1"]], stats: { records: 2 }, warningLines: 3 };
const matchReport = [
  { index: 0, outcome: "match", rule: "03", confidence: 0.99, matchType: "fuzzy", matched: [1], evidence: {} },
  { index: 1, outcome: "match", rule: "03", confidence: 0.99, matchType: "fuzzy", matched: [0], evidence: {} }
];

/** Every worker the client creates from now on is recorded in `workers`. */
function install(timeoutMs?: number): FakeWorker[] {
  const workers: FakeWorker[] = [];
  setFhir4dsWorkerForTest({
    factory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  });
  return workers;
}

describe("fhir4ds background worker client", () => {
  it("sends the records to the worker and resolves with its result", async () => {
    const workers = install();
    const promise = fhir4dsDeduplicate(resources);
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(1));
    const request = workers[0].posted[0];
    expect(request.kind).toBe("dedup");
    expect(request.kind === "dedup" ? request.resources : null).toEqual(resources);
    workers[0].resolve(request, outcome);
    await expect(promise).resolves.toEqual(outcome);
  });

  it("rejects when the worker fails the request", async () => {
    const workers = install();
    const promise = fhir4dsDeduplicate(resources);
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(1));
    workers[0].reject(workers[0].posted[0], "no DuckDB in this browser");
    await expect(promise).rejects.toThrow("no DuckDB in this browser");
  });

  it("rejects a reply that is not a deduplication result", async () => {
    const workers = install();
    const promise = fhir4dsDeduplicate(resources);
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(1));
    workers[0].resolve(workers[0].posted[0], { clusters: [["r0", 7]], stats: {} });
    await expect(promise).rejects.toThrow("unexpected result");
  });

  it("rejects when the worker does not answer in time", async () => {
    const workers = install(20);
    const promise = fhir4dsDeduplicate(resources);
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(1));
    await expect(promise).rejects.toThrow("did not finish in time");
  });

  it("rejects every waiting request when the worker crashes, and starts a fresh one next time", async () => {
    const workers = install();
    const first = fhir4dsDeduplicate(resources);
    const second = fhir4dsDeduplicate(resources);
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(2));
    workers[0].crash();
    await expect(first).rejects.toThrow("worker crashed");
    await expect(second).rejects.toThrow("worker crashed");
    expect(workers[0].terminated).toBe(true);

    const third = fhir4dsDeduplicate(resources);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await vi.waitFor(() => expect(workers[1].posted).toHaveLength(1));
    workers[1].resolve(workers[1].posted[0], outcome);
    await expect(third).resolves.toEqual(outcome);
  });

  it("returns the patient matching report and checks it", async () => {
    const workers = install();
    const promise = fhir4dsMatchPatients([{ resourceType: "Patient", id: "p0" }, { resourceType: "Patient", id: "p1" }]);
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(1));
    const request = workers[0].posted[0];
    expect(request.kind).toBe("matchPatients");
    workers[0].resolve(request, matchReport);
    await expect(promise).resolves.toEqual(matchReport);

    const broken = fhir4dsMatchPatients([{ resourceType: "Patient", id: "p0" }]);
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(2));
    workers[0].resolve(workers[0].posted[1], [{ ...matchReport[0], outcome: "perhaps" }]);
    await expect(broken).rejects.toThrow("unexpected result");
  });
});
