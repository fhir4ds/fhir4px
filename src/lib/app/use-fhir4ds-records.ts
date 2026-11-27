/**
 * fhir4ds deduplication and patient matching for the loaded records, run in
 * the background worker. Both start once the page has finished its own
 * grouping, so the two do not compete for the processor while the user is
 * waiting for records to appear.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FhirResource } from "../smart/data";
import { fhir4dsDeduplicate, fhir4dsMatchPatients, type Fhir4dsPatientMatch } from "../engine/fhir4ds-client";
import { duplicateLinksFromClusters, type DuplicateLinks } from "../fhir/dedupe";

export type BackgroundStepState = "running" | "done" | "failed";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DedupInputRecord {
  /** The app's record id. */
  id: string;
  resource: FhirResource;
}

export interface DedupRun {
  state: BackgroundStepState;
  links: DuplicateLinks | null;
  /** Records that are copies of another record. */
  mergedCount: number;
  error?: string;
}

/**
 * Runs fhir4ds deduplication for `records` when `start` turns true, and
 * again whenever the set of records changes. Returns null until the run for
 * the current records has started.
 */
export function useFhir4dsDedup(records: DedupInputRecord[] | null, start: boolean): DedupRun | null {
  const signature = useMemo(() => records?.map((entry) => entry.id).sort().join("|") ?? null, [records]);
  const [run, setRun] = useState<(DedupRun & { signature: string }) | null>(null);
  const launchedFor = useRef<string | null>(null);
  const cancelCurrent = useRef<() => void>(() => {});

  useEffect(() => {
    if (!records || !signature || !start || launchedFor.current === signature) return;
    launchedFor.current = signature;
    let current = true;
    cancelCurrent.current();
    cancelCurrent.current = () => {
      current = false;
    };
    setRun({ signature, state: "running", links: null, mergedCount: 0 });
    const input = records;
    void fhir4dsDeduplicate(input.map((entry, index) => ({ ...entry.resource, id: `r${index}` })))
      .then((outcome) => {
        if (!current) return;
        const links = duplicateLinksFromClusters(
          input.map((entry) => entry.id),
          outcome.clusters.map((cluster) => cluster.map((rid) => input[Number(rid.slice(1))].id))
        );
        const mergedCount = outcome.clusters.reduce((total, cluster) => total + Math.max(0, cluster.length - 1), 0);
        setRun({ signature, state: "done", links, mergedCount });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setRun({ signature, state: "failed", links: null, mergedCount: 0, error: errorMessage(error) });
      });
  }, [records, signature, start]);

  return run && run.signature === signature ? run : null;
}

export type PatientMatchVerdict =
  | { status: "same" }
  | { status: "different"; pairs: Array<{ first: number; second: number }> }
  | { status: "unconfirmed"; pairs: Array<{ first: number; second: number }> };

/**
 * Compares every patient with every other one.
 * `different`: at least one pair is not the same person. `unconfirmed`: no
 * pair is different, but at least one pair could not be decided.
 */
/** The pairs fhir4ds reported as one person, once each, lower index first. */
export function matchedPairs(matches: Fhir4dsPatientMatch[], patientCount: number): PatientMatchPair[] {
  const pairs: PatientMatchPair[] = [];
  const seen = new Set<string>();
  for (let first = 0; first < patientCount; first += 1) {
    for (const second of matches[first]?.matched ?? []) {
      if (second <= first || second >= patientCount) continue;
      const key = `${first}:${second}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ first, second });
    }
  }
  return pairs;
}

export function patientMatchVerdict(matches: Fhir4dsPatientMatch[], patientCount: number): PatientMatchVerdict | null {
  if (patientCount < 2) return null;
  const unmatched: Array<{ first: number; second: number }> = [];
  const undecided: Array<{ first: number; second: number }> = [];
  for (let first = 0; first < patientCount; first += 1) {
    for (let second = first + 1; second < patientCount; second += 1) {
      const reportsMatch =
        matches[first]?.matched.includes(second) === true || matches[second]?.matched.includes(first) === true;
      if (reportsMatch) continue;
      const ambiguous =
        matches[first]?.outcome === "ambiguous" || matches[second]?.outcome === "ambiguous";
      (ambiguous ? undecided : unmatched).push({ first, second });
    }
  }
  if (unmatched.length > 0) return { status: "different", pairs: unmatched };
  if (undecided.length > 0) return { status: "unconfirmed", pairs: undecided };
  return { status: "same" };
}

/** Indexes of two portals whose patients fhir4ds says are the same person. */
export interface PatientMatchPair {
  first: number;
  second: number;
}

export interface PatientMatchRun {
  state: BackgroundStepState;
  verdict: PatientMatchVerdict | null;
  /** The pairs fhir4ds reported as one person, for grouping the portals. */
  matches: PatientMatchPair[];
  error?: string;
}

/** Runs fhir4ds patient matching for `patients`: one FHIR Patient resource per portal. */
export function useFhir4dsPatientMatching(patients: FhirResource[] | null, start: boolean): PatientMatchRun | null {
  const signature = useMemo(
    () => patients?.map((patient) => `${patient.id}|${patient.birthDate ?? ""}|${JSON.stringify(patient.name ?? "")}`).join("\n") ?? null,
    [patients]
  );
  const [run, setRun] = useState<(PatientMatchRun & { signature: string }) | null>(null);
  const launchedFor = useRef<string | null>(null);
  const cancelCurrent = useRef<() => void>(() => {});

  useEffect(() => {
    if (!patients || patients.length < 2 || !signature || !start || launchedFor.current === signature) return;
    launchedFor.current = signature;
    let current = true;
    cancelCurrent.current();
    cancelCurrent.current = () => {
      current = false;
    };
    setRun({ signature, state: "running", verdict: null, matches: [] });
    const input = patients;
    void fhir4dsMatchPatients(input.map((patient, index) => ({ ...patient, id: `p${index}` })))
      .then((matches) => {
        if (!current) return;
        setRun({
          signature,
          state: "done",
          verdict: patientMatchVerdict(matches, input.length),
          matches: matchedPairs(matches, input.length)
        });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setRun({ signature, state: "failed", verdict: null, matches: [], error: errorMessage(error) });
      });
  }, [patients, signature, start]);

  return run && run.signature === signature ? run : null;
}
