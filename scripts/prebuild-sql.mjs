#!/usr/bin/env node
/**
 * Prebuild SQL — the build step of the app's "prebuilt" mode.
 *
 * `npm run prebuild:sql` runs the fhir4ds wheel (the file the app ships)
 * once over every CQL library, view and OMOP library and writes the SQL to
 * public/fhir4ds/prebuilt/, where `vite build --mode prebuilt` picks it up.
 * The translation itself is scripts/prebuild_sql.py; this script only hands
 * it the cohort CQL, which lives in TypeScript, and runs it.
 *
 * Nothing generated is committed: the SQL is rebuilt on every prebuilt build
 * from the inputs of that commit, so it cannot go stale.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.PYTHON ?? "python3";

/**
 * The cohort CQL is authored inside src/lib/fhir/cohorts.ts. Transpile that
 * module (it has no imports) and import it, so the build reads the same
 * definitions the app runs instead of a copy.
 */
async function dumpCohortCql(directory) {
  const source = readFileSync(join(root, "src/lib/fhir/cohorts.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  });
  if (/^\s*import\b/m.test(outputText)) {
    throw new Error("src/lib/fhir/cohorts.ts gained an import; extend scripts/prebuild-sql.mjs to resolve it");
  }
  const moduleFile = join(directory, "cohorts.mjs");
  writeFileSync(moduleFile, outputText);
  const { COHORT_DEFINITIONS } = await import(pathToFileURL(moduleFile).href);
  const cohorts = COHORT_DEFINITIONS.map(({ id, cql }) => ({ id, cql }));
  const dumpFile = join(directory, "cohorts.json");
  writeFileSync(dumpFile, JSON.stringify(cohorts));
  return { dumpFile, count: cohorts.length };
}

const directory = mkdtempSync(join(tmpdir(), "fhir4px-prebuild-"));
try {
  const { dumpFile, count } = await dumpCohortCql(directory);
  if (count === 0) throw new Error("src/lib/fhir/cohorts.ts defines no cohorts");
  const result = spawnSync(python, [join(root, "scripts/prebuild_sql.py"), `--root=${root}`, `--cohorts=${dumpFile}`], {
    cwd: root,
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
