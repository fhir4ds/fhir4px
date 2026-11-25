import { afterEach, describe, expect, it, vi } from "vitest";

/** A minimal manifest in the shape scripts/prebuild_sql.py writes. */
const MANIFEST = {
  generator: "fhir4px-prebuild-sql",
  version: 1,
  wheel: { file: "fhir4ds_v2-0.0.26-py3-none-any.whl", sha256: "abc123" },
  yearPlaceholder: "{{YEAR}}",
  measures: { CMS125: { file: "measures/CMS125.sql" } },
  cohorts: { "t2dm-on-metformin": { file: "cohorts/t2dm-on-metformin.sql" } },
  views: {
    "uscore-patient": { file: "views/uscore-patient.json" },
    broken: { file: "views/broken.json" }
  },
  omopLibraries: {
    "condition-occurrence": { file: "omop/libraries/condition-occurrence.json" },
    orphan: { file: "omop/libraries/orphan.json" }
  },
  omopComposition: { file: "omop/composition.json" },
  inputs: []
};

type Files = Record<string, string | (() => Response)>;

/** What a dev server returns for a file that does not exist: the app page. */
const appPage = () =>
  new Response("<!doctype html><html><head><title>fhir4px</title></head></html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  });

/** Serves the given files by URL suffix; anything else is a 404. */
function fakeFetcher(files: Files): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const name = Object.keys(files).find((candidate) => url.endsWith(`/${candidate}`));
    if (name === undefined) return new Response("not found", { status: 404 });
    const file = files[name];
    return typeof file === "string" ? new Response(file, { status: 200 }) : file();
  };
  return { fetcher, calls };
}

/** A fresh module instance with the build flag set to `flag`. */
async function loadPrebuilt(flag: string) {
  vi.resetModules();
  vi.stubEnv("VITE_PREBUILT_SQL", flag);
  return import("../../src/lib/engine/prebuilt");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("prebuilt SQL in the default build", () => {
  it("answers null without fetching anything", async () => {
    const { fetcher, calls } = fakeFetcher({ "manifest.json": JSON.stringify(MANIFEST) });
    const prebuilt = await loadPrebuilt("");
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltMeasureSql("CMS125", 2025, { fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltCohortSql("t2dm-on-metformin", { fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltViewSql("uscore-patient", { fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltOmopLibrary("condition-occurrence", { fetcher })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("prebuilt SQL files", () => {
  it("reads the manifest once and fills the measurement year", async () => {
    const { fetcher, calls } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "measures/CMS125.sql": "SELECT '{{YEAR}}-01-01' AS start, '{{YEAR}}-12-31' AS end"
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toMatchObject({
      generator: "fhir4px-prebuild-sql"
    });
    await expect(prebuilt.prebuiltMeasureSql("CMS125", 2025, { fetcher })).resolves.toBe(
      "SELECT '2025-01-01' AS start, '2025-12-31' AS end"
    );
    expect(calls.filter((url) => url.endsWith("/manifest.json"))).toHaveLength(1);
  });

  it("rejects a measurement year that is not four digits", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "measures/CMS125.sql": "SELECT 1"
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltMeasureSql("CMS125", 25, { fetcher })).rejects.toThrow(/four digits/);
  });

  it("answers null for an id that was not built, without fetching it", async () => {
    const { fetcher, calls } = fakeFetcher({ "manifest.json": JSON.stringify(MANIFEST) });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltMeasureSql("CMS999", 2025, { fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltCohortSql("unknown-cohort", { fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltViewSql("unknown-view", { fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltOmopLibrary("unknown-table", { fetcher })).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("treats the dev server's HTML page as a missing file", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "measures/CMS125.sql": appPage,
      "cohorts/t2dm-on-metformin.sql": appPage,
      "views/uscore-patient.json": appPage
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltMeasureSql("CMS125", 2025, { fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltCohortSql("t2dm-on-metformin", { fetcher })).resolves.toBeNull();
    await expect(prebuilt.prebuiltViewSql("uscore-patient", { fetcher })).resolves.toBeNull();
  });

  it("returns a cohort's SQL as it was generated", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "cohorts/t2dm-on-metformin.sql": "SELECT patient_id FROM conditions"
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltCohortSql("t2dm-on-metformin", { fetcher })).resolves.toBe(
      "SELECT patient_id FROM conditions"
    );
  });

  it("returns a view's SQL together with its setup statements", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "views/uscore-patient.json": JSON.stringify({
        ok: true,
        sql: "SELECT id FROM __vd_src",
        setup_sql: ["CREATE OR REPLACE TEMP TABLE helper AS SELECT 1"]
      })
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltViewSql("uscore-patient", { fetcher })).resolves.toEqual({
      sql: "SELECT id FROM __vd_src",
      setupSql: ["CREATE OR REPLACE TEMP TABLE helper AS SELECT 1"]
    });
  });

  it("gives a view without setup statements an empty list", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "views/uscore-patient.json": JSON.stringify({ ok: true, sql: "SELECT id FROM __vd_src" })
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltViewSql("uscore-patient", { fetcher })).resolves.toEqual({
      sql: "SELECT id FROM __vd_src",
      setupSql: []
    });
  });

  it("answers null for a view whose translation failed", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "views/broken.json": JSON.stringify({ ok: false, diagnostics: [{ severity: "error" }] })
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltViewSql("broken", { fetcher })).resolves.toBeNull();
  });

  it("returns an OMOP query together with its composition", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "omop/libraries/condition-occurrence.json": JSON.stringify({ ok: true, sql: "SELECT * FROM condition_occurrence" }),
      "omop/composition.json": JSON.stringify(["CREATE VIEW omop.person AS SELECT 1", "CREATE VIEW omop.visit AS SELECT 2"])
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltOmopLibrary("condition-occurrence", { fetcher })).resolves.toEqual({
      sql: "SELECT * FROM condition_occurrence",
      composition: ["CREATE VIEW omop.person AS SELECT 1", "CREATE VIEW omop.visit AS SELECT 2"]
    });
  });

  it("answers null for an OMOP query that has no composition", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "omop/libraries/orphan.json": JSON.stringify({ ok: true, sql: "SELECT * FROM measurement" })
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltOmopLibrary("orphan", { fetcher })).resolves.toBeNull();
  });

  it("answers null when the composition contains something other than SQL text", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify(MANIFEST),
      "omop/libraries/condition-occurrence.json": JSON.stringify({ ok: true, sql: "SELECT 1" }),
      "omop/composition.json": JSON.stringify(["CREATE VIEW omop.person AS SELECT 1", 42])
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.prebuiltOmopLibrary("condition-occurrence", { fetcher })).resolves.toBeNull();
  });
});

describe("the prebuilt manifest", () => {
  it("answers null when it is missing, and does not ask again", async () => {
    const { fetcher, calls } = fakeFetcher({});
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toBeNull();
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("tries again after a load that could not be read", async () => {
    const { fetcher, calls } = fakeFetcher({ "manifest.json": appPage });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toBeNull();
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("tries again after the request itself fails", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("network down");
      return new Response(JSON.stringify(MANIFEST), { status: 200 });
    };
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toBeNull();
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toMatchObject({ version: 1 });
  });

  it("answers null for a manifest from another generator", async () => {
    const { fetcher } = fakeFetcher({
      "manifest.json": JSON.stringify({ ...MANIFEST, generator: "something-else" })
    });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toBeNull();
  });

  it("answers null for a manifest written in another version", async () => {
    const { fetcher } = fakeFetcher({ "manifest.json": JSON.stringify({ ...MANIFEST, version: 2 }) });
    const prebuilt = await loadPrebuilt("1");
    await expect(prebuilt.loadPrebuiltManifest({ fetcher })).resolves.toBeNull();
  });
});

describe("fillMeasurementYear", () => {
  it("replaces every placeholder", async () => {
    const prebuilt = await loadPrebuilt("1");
    expect(prebuilt.fillMeasurementYear("a {{YEAR}} b {{YEAR}}", "{{YEAR}}", 2031)).toBe("a 2031 b 2031");
  });

  it.each([203, 20311, Number.NaN])("throws for the year %s", async (year) => {
    const prebuilt = await loadPrebuilt("1");
    expect(() => prebuilt.fillMeasurementYear("{{YEAR}}", "{{YEAR}}", year)).toThrow(/four digits/);
  });
});
