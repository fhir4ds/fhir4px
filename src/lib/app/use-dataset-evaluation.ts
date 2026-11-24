/**
 * The shared dataset evaluation's results for one page (Quality, Cohorts).
 *
 * Loads on mount and again when the page is revisited after the dataset
 * changed: these pages stay mounted while you are elsewhere, so there is no
 * remount to trigger a reload. The evaluation itself runs once per dataset
 * (see quality-run.ts); this only reads it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { qualityDatasetVersion, runQualityEvaluation, type QualityEvaluation } from "../fhir/quality-run";
import { completeConnection, publishUsCore } from "./connection-status";

type LoadResult<T> = { value: T; error: null } | { value: null; error: string };

export function useDatasetEvaluation<T>(path: string, select: (evaluation: QualityEvaluation) => T) {
  const location = useLocation();
  const active = matchPath(path, location.pathname) !== null;
  const [result, setResult] = useState<LoadResult<T> | null>(null);
  const [busy, setBusy] = useState(false);
  const seenVersion = useRef<number | null>(null);

  // The selector is read through a ref so `load` stays stable.
  const selectRef = useRef(select);
  selectRef.current = select;

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const evaluation = await runQualityEvaluation();
      // The connection menu summarizes these; the Records page publishes
      // them too when it is open, which is not the case after a reload here.
      publishUsCore(evaluation.checks);
      completeConnection({ patient: evaluation.patient, recordCount: evaluation.resourceCount });
      setResult({ value: selectRef.current(evaluation), error: null });
    } catch (caught) {
      setResult({ value: null, error: caught instanceof Error ? caught.message : "Evaluation failed" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!active) return;
    const version = qualityDatasetVersion();
    if (seenVersion.current !== null && version !== seenVersion.current) void load();
    seenVersion.current = version;
  }, [active, load]);

  return { result, busy };
}
