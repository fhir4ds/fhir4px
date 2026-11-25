import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Only meaningful after `npm run prebuild:sql`: the generated files are not
 * committed, so this file is skipped in a plain checkout.
 */
interface GeneratedManifest {
  generator: string;
  inputs: Array<{ path: string; sha256: string }>;
}

const ROOT = resolve(__dirname, "../..");
const MANIFEST = resolve(ROOT, "public/fhir4ds/prebuilt/manifest.json");

describe.skipIf(!existsSync(MANIFEST))("generated SQL against its inputs", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as GeneratedManifest;
  const paths = manifest.inputs.map((input) => input.path);

  it("records a checksum for every input it was generated from", () => {
    expect(manifest.generator).toBe("fhir4px-prebuild-sql");
    expect(paths).toContain("src/lib/fhir/cohorts.ts");
    expect(paths.some((path) => /^public\/vendor\/fhir4ds\/fhir4ds_v2-.*\.whl$/.test(path))).toBe(true);
    // 8 measure libraries plus the libraries they include (FHIRHelpers, ...)
    expect(paths.filter((path) => path.endsWith(".cql")).length).toBeGreaterThanOrEqual(18);
  });

  it("is up to date: no input changed since it was generated", () => {
    const stale = manifest.inputs
      .filter(
        ({ path, sha256 }) =>
          createHash("sha256").update(readFileSync(resolve(ROOT, path))).digest("hex") !== sha256
      )
      .map((input) => input.path);
    expect(stale).toEqual([]);
  });
});
