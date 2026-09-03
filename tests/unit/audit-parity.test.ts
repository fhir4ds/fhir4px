/**
 * Parity test: scripts/audit_relationships.py must mirror matcher.ts
 * semantics. Runs the same fixture through both implementations against
 * the same bundle snapshot and diffs the match tables.
 *
 * Lives behind AUDIT_PARITY=1 (needs python3 + a local bundle dir):
 *
 *   AUDIT_PARITY=1 BUNDLE_DIR=/tmp/cid-assoc-x \
 *     npx vitest run --environment node tests/unit/audit-parity.test.ts
 *
 * The Python side is executed with --bundle-dir so no network is touched.
 * Snapshots live outside the repo (gitignored data/ or /tmp) because the
 * bundle is 160MB raw.
 */
import { execFile } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { setAssociationsForTest } from "../../src/lib/associations/bundle";
import { setRxnormDecompositionForTest } from "../../src/lib/fhir/rxnorm-decomposition";
import { findRelatedGroups } from "../../src/lib/associations/matcher";
import type { GroupableRecord, GroupableResourceType } from "../../src/lib/fhir/patient-groups";

const run = promisify(execFile);
const enabled = process.env.AUDIT_PARITY === "1";
const bundleDir = process.env.BUNDLE_DIR ?? "/tmp/cid-assoc-x";

interface PyRow {
  tier: string;
  focusId?: string;
  focusDisplay: string;
  candidateId?: string;
  candidateDisplay: string;
  bucket: string;
  matchedMember: string;
  provenance?: string;
  viaHub?: string;
}

function fixtureItems(fixturePath: string): Array<{
  id?: string;
  kind: string;
  display: string;
  codes: Array<{ system: string | null; code: string }>;
  records: GroupableRecord[];
}> {
  const data = JSON.parse(readFileSync(fixturePath, "utf8"));
  const resources: Array<Record<string, unknown>> = data.entry.map((e: { resource: Record<string, unknown> }) => e.resource);
  const rxByMedId = new Map<string, { system: string | null; code: string; display?: string }>();
  for (const r of resources) {
    if (r.resourceType !== "Medication" || typeof r.id !== "string") continue;
    for (const c of ((r.code as { coding?: Array<Record<string, string>> })?.coding) ?? []) {
      const s = (c.system ?? "").toLowerCase();
      if ((s.includes("rxnorm") || s.includes("6.88")) && c.code) rxByMedId.set(r.id, { system: "rxnorm", code: c.code, display: c.display });
    }
  }
  const items: ReturnType<typeof fixtureItems> = [];
  const push = (
    r: Record<string, unknown>,
    id: string | undefined,
    kind: string,
    display: string | undefined,
    codes: Array<{ system: string | null; code: string }>,
    codingKeys: string[]
  ) => {
    if (!codes.length) return;
    const label = display || codes[0].code;
    items.push({
      id,
      kind,
      display: label,
      codes,
      records: [
        {
          id: id ?? codes[0].code,
          resourceType: (kind === "med"
            ? "MedicationRequest"
            : kind === "cond"
              ? "Condition"
              : kind === "lab"
                ? "Observation"
                : kind === "vax"
                  ? "Immunization"
                  : "Procedure") as GroupableResourceType,
          sourceLabel: label,
          source: "provider",
          codingKeys
        }
      ]
    });
  };
  const sysOf = (s: string | undefined): string | null => {
    const t = (s ?? "").toLowerCase();
    if (t.includes("rxnorm") || t.includes("6.88")) return "rxnorm";
    if (t.includes("loinc") || t.includes("6.1")) return "loinc";
    if (t.includes("snomed")) return "snomed";
    if (t.includes("icd-10") || t.includes("icd10")) return "icd10cm";
    if (t.includes("cvx")) return "cvx";
    if (t.includes("cpt")) return "cpt";
    if (t.includes("hcpcs")) return "hcpcs";
    return null;
  };
  for (const r of resources) {
    const rt = r.resourceType as string;
    const id = typeof r.id === "string" ? r.id : undefined;
    if (rt === "MedicationRequest") {
      const mcc = ((r.medicationCodeableConcept as { coding?: Array<Record<string, string>> })?.coding) ?? [];
      const codes: Array<{ system: string | null; code: string }> = [];
      let display: string | undefined;
      for (const c of mcc) {
        if (c.code) {
          codes.push({ system: sysOf(c.system), code: c.code });
          display = display || c.display;
        }
      }
      const ref = ((r.medicationReference as { reference?: string })?.reference ?? "").split("/").pop() ?? "";
      const med = rxByMedId.get(ref);
      if (med) {
        codes.push({ system: "rxnorm", code: med.code });
        display = display || med.display;
      }
      const keys = codes.map((c) => `${c.system}:${c.code}`);
      push(r, id, "med", display, codes, keys);
    } else if (rt === "Condition" || rt === "Observation" || rt === "Procedure" || rt === "Immunization") {
      const field = rt === "Immunization" ? "vaccineCode" : "code";
      const codingsList = ((r[field] as { coding?: Array<Record<string, string>> })?.coding) ?? [];
      const codes = codingsList.filter((c) => c.code).map((c) => ({ system: sysOf(c.system), code: c.code }));
      const display =
        (r[field] as { text?: string } | undefined)?.text ??
        codingsList.find((c) => c.display)?.display;
      const kind = rt === "Condition" ? "cond" : rt === "Observation" ? "lab" : rt === "Immunization" ? "vax" : "proc";
      const keys = codes.map((c) => `${c.system}:${c.code}`);
      push(r, id, kind, display, codes, keys);
    }
  }
  return items;
}

describe.skipIf(!enabled)("audit script parity (python vs matcher.ts)", () => {
  it("produces identical match tables on the respiratory fixture", async () => {
    const fixturePath = pathResolve(__dirname, "../fixtures/fhir/large-respiratory-immune-patient-r4.json");

    // --- Python side (offline bundle dir) ---
    const { stdout } = await run(
      "python3",
      ["scripts/audit_relationships.py", fixturePath, "--json", "--bundle-dir", bundleDir],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    const pyRows: PyRow[] = JSON.parse(stdout);

    // --- TypeScript side: same fixture, same bundle ---
    const bundle = JSON.parse(gunzipSync(readFileSync(`${bundleDir}/associations.json.gz`)).toString("utf8"));
    const labParts = JSON.parse(readFileSync(`${bundleDir}/crosswalks/loinc_test_to_part.json`, "utf8"));
    const icd10 = JSON.parse(readFileSync(`${bundleDir}/crosswalks/icd10_to_snomed.json`, "utf8"));
    setAssociationsForTest({ bundle, labParts, icd10 });
    setRxnormDecompositionForTest(
      JSON.parse(readFileSync(pathResolve(__dirname, "../../public/terminology/rxnorm-ingredients.json"), "utf8"))
    );
    try {
      const items = fixtureItems(fixturePath);
      // Resolution parity is asserted implicitly through matching: the app
      // resolver runs against the injected bundle via findRelatedGroups
      // candidates built with resolveGroupConcept.
      const { resolveGroupConcept } = await import("../../src/lib/associations/resolve");
      const candidates: Array<{
        groupId: string;
        groupName: string;
        resourceTypes: string[];
        resolution: Awaited<ReturnType<typeof resolveGroupConcept>>;
      }> = [];
      for (const item of items) {
        const resolution = await resolveGroupConcept(
          {
            groupId: item.id ?? item.display,
            patientFriendlyName: item.display,
            resourceIds: [],
            resourceTypes: [item.records[0].resourceType],
            confidence: 1,
            reason: "",
            fallback: false
          },
          item.records
        );
        candidates.push({
          groupId: item.id ?? item.display,
          groupName: item.display,
          resourceTypes: [item.records[0].resourceType],
          resolution
        });
      }

      const tsRows: PyRow[] = [];
      for (const tier of ["default", "loose"] as const) {
        for (const cand of candidates) {
          if (!cand.resolution.conceptKey && !cand.resolution.labPartCids?.length) continue;
          const matches = await findRelatedGroups(
            { groupId: cand.groupId, resolution: cand.resolution },
            candidates.filter((c) => c.groupId !== cand.groupId),
            { includeLooseProvenance: tier === "loose" }
          );
          for (const m of matches) {
            const candidate = candidates.find((c) => c.groupId === m.groupId);
            tsRows.push({
              tier,
              focusId: cand.groupId,
              focusDisplay: cand.groupName,
              candidateId: candidate?.groupId,
              candidateDisplay: candidate?.groupName ?? m.groupName,
              bucket: m.relationship,
              matchedMember: m.matchedMemberName ?? candidate?.groupName ?? "",
              provenance: m.provenance ?? undefined,
              viaHub: m.viaHubName ?? undefined
            });
          }
        }
      }

      // --- Diff ---
      const key = (r: PyRow) =>
        `${r.tier}|${r.focusId}|${r.candidateId}|${r.bucket}`;
      const pyByFocus = new Map<string, PyRow>();
      for (const r of pyRows) pyByFocus.set(key(r), r);
      const tsByFocus = new Map<string, PyRow>();
      for (const r of tsRows) tsByFocus.set(key(r), r);

      const missingInTs = [...pyByFocus.keys()].filter((k) => !tsByFocus.has(k));
      const missingInPy = [...tsByFocus.keys()].filter((k) => !pyByFocus.has(k));
      const fieldDrift: string[] = [];
      const norm = (v: string | null | undefined) => (v == null ? "-" : v);
      for (const k of pyByFocus.keys()) {
        const a = pyByFocus.get(k)!;
        const b = tsByFocus.get(k);
        if (!b) continue;
        if (norm(a.provenance) !== norm(b.provenance) || norm(a.viaHub) !== norm(b.viaHub)) {
          fieldDrift.push(`${k}: py(${norm(a.provenance)},${norm(a.viaHub)}) ts(${norm(b.provenance)},${norm(b.viaHub)})`);
        }
      }

      expect(
        {
          pyRows: pyRows.length,
          tsRows: tsRows.length,
          missingInTs: missingInTs.slice(0, 10),
          missingInPy: missingInPy.slice(0, 10),
          fieldDrift: fieldDrift.slice(0, 10)
        },
        `parity drift — missingInTs=${missingInTs.length} missingInPy=${missingInPy.length} fieldDrift=${fieldDrift.length}`
      ).toEqual({
        pyRows: pyRows.length,
        tsRows: pyRows.length,
        missingInTs: [],
        missingInPy: [],
        fieldDrift: []
      });
    } finally {
      setAssociationsForTest(null);
      setRxnormDecompositionForTest(null);
    }
  }, 300_000);
});
