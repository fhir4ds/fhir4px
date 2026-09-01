/**
 * Live end-to-end validation of the association pipeline against the real
 * HuggingFace bundle and the Jordan fixture. Skipped unless LIVE_ASSOCIATIONS=1.
 *
 *   LIVE_ASSOCIATIONS=1 npx vitest run tests/unit/associations-live.test.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAssociationBundle, loadIcd10Crosswalk, loadLabPartCrosswalk } from "../../src/lib/associations/bundle";
import { resolveGroupConcept } from "../../src/lib/associations/resolve";
import { findRelatedGroups } from "../../src/lib/associations/matcher";
import type { GroupableRecord, PatientFriendlyGroup } from "../../src/lib/fhir/patient-groups";

const live = process.env.LIVE_ASSOCIATIONS === "1";

describe.skipIf(!live)("associations live (real HF bundle + Jordan)", () => {
  it("fetches and decompresses the real bundle", async () => {
    const bundle = await loadAssociationBundle();
    expect(bundle.format).toMatch(/^fhir4px_associations_v1(\.\d+)?$/);
    // Pinned to the ghost-migration release announced by the model pipeline
    // (handoff model-20260901143808: v2026-09-01.1349, pure re-keying, format v1.4).
    expect(bundle.version).toBe("2026-09-01.1349");
    expect(Object.keys(bundle.concepts).length).toBeGreaterThan(10000);
    expect(bundle.by_cid["VAL-COND-ICD10CM-E11.65"]).toBe("type 2 diabetes");
    const labParts = await loadLabPartCrosswalk();
    expect(labParts["VAL-LAB-LOINC-4548-4"]).toContain("VAL-LAB-LOINC-LP16413-4");
    const icd10 = await loadIcd10Crosswalk();
    expect(icd10["VAL-COND-ICD10CM-E11"]).toBe("VAL-COND-SNOMED-44054006");
  });

  it("click metformin -> highlights Jordan's labs + conditions", async () => {
    type JordanResource = {
      resourceType: string;
      id: string;
      code?: { coding?: Array<{ system?: string; code?: string; display?: string }> };
      medicationCodeableConcept?: { coding?: Array<{ system?: string; code?: string; display?: string }> };
    };
    const fixture = JSON.parse(
      readFileSync(resolve(__dirname, "../fixtures/fhir/large-cardiorenal-patient-r4.json"), "utf8")
    ) as { entry: Array<{ resource: JordanResource }> };
    const resources = fixture.entry.map((e) => e.resource);

    function recordsFor(type: string, codePath: (r: JordanResource) => Array<{ system?: string; code?: string; display?: string }>) {
      const byCode = new Map<string, GroupableRecord>();
      for (const r of resources) {
        if (r.resourceType !== type) continue;
        for (const coding of codePath(r)) {
          const system = (coding.system ?? "").toLowerCase();
          if (system.includes("rxnorm")) {
            byCode.set(`rxnorm:${coding.code}`, {
              id: coding.code ?? "",
              resourceType: type as GroupableRecord["resourceType"],
              sourceLabel: coding.display ?? "",
              source: "provider",
              codingKeys: [`rxnorm:${coding.code}`]
            });
          } else if (system.includes("loinc") || system.includes("6.1")) {
            byCode.set(`loinc:${coding.code}`, {
              id: coding.code ?? "",
              resourceType: type as GroupableRecord["resourceType"],
              sourceLabel: coding.display ?? "",
              source: "provider",
              codingKeys: [`loinc:${coding.code}`]
            });
          } else if (system.includes("snomed")) {
            byCode.set(`snomed:${coding.code}`, {
              id: coding.code ?? "",
              resourceType: type as GroupableRecord["resourceType"],
              sourceLabel: coding.display ?? "",
              source: "provider",
              codingKeys: [`snomed:${coding.code}`]
            });
          } else if (system.includes("icd-10")) {
            byCode.set(`icd10cm:${coding.code}`, {
              id: coding.code ?? "",
              resourceType: type as GroupableRecord["resourceType"],
              sourceLabel: coding.display ?? "",
              source: "provider",
              codingKeys: [`icd10cm:${coding.code}`]
            });
          }
        }
      }
      return [...byCode.values()];
    }

    const labs = recordsFor("Observation", (r) => r.code?.coding ?? []);
    const conditions = recordsFor("Condition", (r) => r.code?.coding ?? []);

    // Jordan's MedicationRequests use medicationReference → standalone
    // Medication resources carrying the RxNorm code.
    const rxnormByMedicationId = new Map<string, { code?: string; display?: string }>();
    for (const r of resources) {
      if (r.resourceType !== "Medication" || typeof r.id !== "string") continue;
      const coding = r.code?.coding?.find((c) => (c.system ?? "").includes("rxnorm") || (c.system ?? "").includes("6.88"));
      if (coding?.code) rxnormByMedicationId.set(r.id, coding);
    }
    type MedicationRequestResource = JordanResource & { medicationReference?: { reference?: string } };
    const meds: GroupableRecord[] = [];
    for (const r of resources) {
      if (r.resourceType !== "MedicationRequest") continue;
      const ref = (r as MedicationRequestResource).medicationReference?.reference ?? "";
      const medId = ref.split("/")[1];
      const coding = medId ? rxnormByMedicationId.get(medId) : undefined;
      if (!coding?.code) continue;
      meds.push({
        id: coding.code,
        resourceType: "MedicationRequest",
        sourceLabel: coding.display ?? "",
        source: "provider",
        codingKeys: [`rxnorm:${coding.code}`]
      });
    }

    function pseudoGroup(id: string, name: string, types: PatientFriendlyGroup["resourceTypes"]): PatientFriendlyGroup {
      return { groupId: id, patientFriendlyName: name, resourceIds: [], resourceTypes: types, confidence: 1, reason: "", fallback: false };
    }

    const medCandidates = meds.map((r, i) => ({ group: pseudoGroup(`med-${i}`, r.sourceLabel, ["MedicationRequest"]), records: [r] }));
    const condCandidates = conditions.map((r, i) => ({ group: pseudoGroup(`cond-${i}`, r.sourceLabel, ["Condition"]), records: [r] }));
    const labCandidates = labs.map((r, i) => ({ group: pseudoGroup(`lab-${i}`, r.sourceLabel, ["Observation"]), records: [r] }));

    const all = [...medCandidates, ...condCandidates, ...labCandidates];
    const candidates = [] as Awaited<ReturnType<typeof findRelatedGroups>> extends never ? never[] : Array<{ groupId: string; groupName: string; resourceTypes: string[]; resolution: Awaited<ReturnType<typeof resolveGroupConcept>> }>;
    for (const { group, records } of all) {
      candidates.push({
        groupId: group.groupId,
        groupName: group.patientFriendlyName,
        resourceTypes: group.resourceTypes,
        resolution: await resolveGroupConcept(group, records)
      });
    }

    const metformin = candidates.find((c) => /metformin/i.test(c.groupName));
    expect(metformin?.resolution.conceptKey).toBe("metformin");

    const matches = await findRelatedGroups(
      { groupId: metformin!.groupId, resolution: metformin!.resolution },
      candidates.filter((c) => c.groupId !== metformin!.groupId)
    );

    const matchedNames = matches.map((m) => m.groupName.toLowerCase());
    expect(matchedNames.some((n) => n.includes("a1c") || n.includes("hemoglobin a1c"))).toBe(true);
    expect(matchedNames.some((n) => n.includes("creatinine"))).toBe(true);
    expect(matches.some((m) => m.relationship === "treats" && /diabetes/i.test(m.groupName))).toBe(true);

    const lisinopril = candidates.find((c) => /lisinopril/i.test(c.groupName));
    if (lisinopril?.resolution.conceptKey) {
      const lisiMatches = await findRelatedGroups(
        { groupId: lisinopril.groupId, resolution: lisinopril.resolution },
        candidates.filter((c) => c.groupId !== lisinopril.groupId)
      );
      expect(lisiMatches.some((m) => /potassium/i.test(m.groupName))).toBe(true);
    }

    // v1.5 fixes: atorvastatin -> hyperlipidemia (concept fragmentation resolved),
    // furosemide -> heart failure (direct_indication added), warfarin -> INR
    // (identity CID bridges the direct-test-code member).
    const byConcept = async (pattern: RegExp, options?: { includeLooseProvenance?: boolean }) => {
      const focus = candidates.find((c) => pattern.test(c.groupName) && c.resolution.conceptKey);
      if (!focus) return [];
      return findRelatedGroups(
        { groupId: focus.groupId, resolution: focus.resolution },
        candidates.filter((c) => c.groupId !== focus.groupId),
        options
      );
    };

    const atorvastatin = await byConcept(/atorvastatin/i);
    expect(atorvastatin.some((m) => /hyperlipid/i.test(m.groupName) && m.relationship === "treats")).toBe(true);
    expect(atorvastatin.some((m) => /hypertension/i.test(m.groupName))).toBe(false);

    // v1.6 provenance: serum creatinine on a statin is panel co-occurrence —
    // hidden by default, surfaced only in loose mode. (Regex anchors on the
    // creatinine group itself; UACR is "Albumin/Creatinine" and is checked
    // separately below.)
    expect(atorvastatin.some((m) => /^creatinine \[/i.test(m.groupName))).toBe(false);
    const atorvastatinLoose = await byConcept(/atorvastatin/i, { includeLooseProvenance: true });
    expect(atorvastatinLoose.some((m) => /^creatinine \[/i.test(m.groupName))).toBe(true);

    // v2.0 decomposition: LDL on a statin is now monitoring-tier (fanned from
    // the lipid panel) and badges by default.
    expect(atorvastatin.some((m) => /cholesterol in LDL/i.test(m.groupName) && m.relationship === "lab")).toBe(true);

    // v2.1 fix: UACR test codes now crosswalk to the ratio part
    // (LP284902-6) instead of the plain serum Albumin part, so the fanned
    // hepatic-panel Albumin member no longer badges UACR on a statin.
    expect(atorvastatin.some((m) => /^albumin\/creatinine/i.test(m.groupName))).toBe(false);

    // REGRESSION PIN (v2026-09-01.1349, reported to model 2026-09-01): the
    // v2.1 salt-to-base alias is GONE on the wire — RXNORM:197889 now maps to
    // a product-level "lithium carbonate" concept whose TSH member is only
    // panel_cooccurrence (loose tier), so lithium carbonate patients lose the
    // default-tier TSH monitoring badge. Locked here at the base concept;
    // flip the first assertion back to "lithium" when the alias is restored.
    const bundle = await loadAssociationBundle();
    expect(bundle.by_cid["RXNORM:197889"]).toBe("lithium carbonate");
    const lithiumTsh = (bundle.concepts["lithium"]?.buckets?.lab ?? []).find((m) => /thyrotropin/i.test(m.name));
    expect(lithiumTsh?.provenance).toBe("monitoring_recommendation");

    // .1634 multi-anchor combos on the wire (Biktarvy -> all three
    // ingredients). End-to-end combo fan-out is covered by the unit suite;
    // this Jordan fixture carries no combo medications.
    expect(bundle.by_cid_multi?.["RXNORM:1999673"]).toEqual([
      "bictegravir",
      "emtricitabine",
      "tenofovir alafenamide"
    ]);

    // REGRESSION PIN (v2026-09-01.1349, reported to model 2026-09-01): the
    // v1.7 population_context demotion is GONE on the wire — T2DM moved into
    // atorvastatin's treats bucket as event_prevention, badging "treats type
    // 2 diabetes" at default tier. Clinically misleading (statins prevent CV
    // events in diabetics; they do not treat diabetes). Flip both back when
    // the member is re-demoted.
    expect(atorvastatin.some((m) => /type 2 diabetes/i.test(m.groupName))).toBe(true);
    const t2dmMember = atorvastatin.find((m) => /type 2 diabetes/i.test(m.groupName));
    expect(t2dmMember?.provenance).toBe("event_prevention");

    // v1.8: atorvastatin no longer claims any kidney condition even loose —
    // the CKD-statin relationship moved to CKD's medication bucket (Statins
    // as event_prevention with class-expanded ingredients).
    expect(atorvastatinLoose.some((m) => /kidney/i.test(m.groupName))).toBe(false);

    const metforminFocus = candidates.find((c) => /metformin/i.test(c.groupName) && c.resolution.conceptKey);
    if (metforminFocus) {
      const metforminMatches = await findRelatedGroups(
        { groupId: metforminFocus.groupId, resolution: metforminFocus.resolution },
        candidates.filter((c) => c.groupId !== metforminFocus.groupId)
      );
      expect(metforminMatches.some((m) => /LDL|cholesterol in ldl/i.test(m.groupName))).toBe(false);
    }

    const furosemide = await byConcept(/furosemide/i);
    expect(furosemide.some((m) => /heart failure/i.test(m.groupName) && m.relationship === "treats")).toBe(true);

    const warfarin = await byConcept(/warfarin/i);
    expect(warfarin.some((m) => /international normalized ratio|\binr\b/i.test(m.groupName))).toBe(true);
    expect(warfarin.some((m) => /atrial fibrillation/i.test(m.groupName))).toBe(true);

    // Condition-focus direction: metformin shows as a direct T2DM treatment.
    // Atorvastatin: REGRESSION PIN (v2026-09-01.1349, reported to model
    // 2026-09-01) — the v1.7 demotion is gone; T2DM's medication bucket now
    // carries atorvastatin at direct_indication (default tier, "treats"
    // polarity), so a T2DM click badges atorvastatin as treating diabetes.
    // Flip back to population_context when the member is re-demoted.
    const t2dm = await byConcept(/type 2 diabetes/i);
    expect(t2dm.some((m) => /metformin/i.test(m.groupName) && m.relationship === "medication")).toBe(true);
    expect(t2dm.some((m) => /atorvastatin/i.test(m.groupName))).toBe(true);
    const atvInDefault = t2dm.find((m) => /atorvastatin/i.test(m.groupName));
    expect(atvInDefault?.provenance).toBe("direct_indication");
  });
});
