#!/usr/bin/env python3
"""Audit CID-association relationships for a test patient fixture.

Mirrors src/lib/associations matcher semantics exactly:
- provenance tier filtering (loose = population_context, comorbidity_section,
  panel_cooccurrence; untagged = class-expansion ingredients, default-on)
- identity CID synthesis for labs/vitals (VAL-LAB-LOINC-{code},
  VAL-VIT-LOINC-{code} alongside LP parts)
- concept-level member resolution (dual-coded conditions match regardless
  of bucket CID system)
- by_name fallback on display text (mirrors the app's BM25-named groups)

Usage: python3 scripts/audit_relationships.py tests/fixtures/fhir/X.json
Outputs a markdown report to stdout.
"""

import gzip
import json
import os
import sys
import urllib.request

BUNDLE_DIR = "/tmp/cid-assoc"
BASE = "https://huggingface.co/fhir4ds/fhir4px/resolve/main/associations"
RXNORM_INGREDIENTS = os.path.join(os.path.dirname(__file__), "..", "public", "terminology", "rxnorm-ingredients.json")

LOOSE = {"population_context", "comorbidity_section", "panel_cooccurrence"}
BUCKETS = ["lab", "vital", "procedure", "medication", "vaccine", "condition", "treats"]


def ensure_file(name):
    path = os.path.join(BUNDLE_DIR, name)
    os.makedirs(os.path.dirname(path) or BUNDLE_DIR, exist_ok=True)
    # Always re-fetch: the corpus updates in place (same URL, new version
    # field) and a cached copy silently audits the wrong release.
    gz_path = path + ".gz"
    urllib.request.urlretrieve(f"{BASE}/{name}.gz", gz_path)
    with gzip.open(gz_path, "rb") as f_in, open(path, "wb") as f_out:
        f_out.write(f_in.read())
    return path


def load_bundle():
    with open(ensure_file("associations.json")) as f:
        bundle = json.load(f)
    with open(ensure_file("crosswalks/loinc_test_to_part.json")) as f:
        lab_parts = json.load(f)
    with open(ensure_file("crosswalks/icd10_to_snomed.json")) as f:
        icd_xwalk = json.load(f)
    with open(RXNORM_INGREDIENTS) as f:
        raw = json.load(f)
        ingredients = {k: v for k, v in raw.items() if k != "_meta"}
    return bundle, lab_parts, icd_xwalk, ingredients


def codings(resource, field):
    concept = resource.get(field) or {}
    return concept.get("coding") or []


def system_of(coding):
    s = (coding.get("system") or "").lower()
    if "rxnorm" in s or "6.88" in s:
        return "rxnorm"
    if "loinc" in s or "6.1" in s.rstrip(".") or s.endswith("6.1"):
        return "loinc"
    if "snomed" in s:
        return "snomed"
    if "icd-10" in s or "icd10" in s:
        return "icd10"
    if "cvx" in s:
        return "cvx"
    return None


class Patient:
    def __init__(self, fixture_path, bundle, lab_parts, icd_xwalk, ingredients):
        self.bundle = bundle
        self.by_cid = bundle["by_cid"]
        self.by_name = bundle["by_name"]
        self.concepts = bundle["concepts"]
        self.lab_parts = lab_parts
        self.icd_xwalk = icd_xwalk
        self.ingredients = ingredients
        with open(fixture_path) as f:
            data = json.load(f)
        entries = data.get("entry", [])
        # Bundled/contained Medication resources referenced by MedicationRequest
        self.resources = [e.get("resource", {}) for e in entries]
        rx_by_med_id = {}
        for r in self.resources:
            if r.get("resourceType") == "Medication":
                for c in codings(r, "code"):
                    if system_of(c) == "rxnorm" and c.get("code"):
                        rx_by_med_id[r["id"]] = c
        self.items = []  # {id, kind, display, codes: [(system, code)], resolution}
        for r in self.resources:
            rt = r.get("resourceType")
            if rt == "MedicationRequest":
                display = None
                codes = []
                for c in codings(r, "medicationCodeableConcept"):
                    if c.get("code"):
                        codes.append((system_of(c), c["code"]))
                        display = display or c.get("display")
                ref = (r.get("medicationReference") or {}).get("reference") or ""
                med = rx_by_med_id.get(ref.split("/")[-1])
                if med:
                    codes.append(("rxnorm", med["code"]))
                    display = display or med.get("display")
                if codes:
                    self.items.append({"id": r.get("id"), "kind": "med", "display": display or codes[0][1],
                                       "codes": codes, "resolution": self.resolve_med(codes, display)})
            elif rt == "Condition":
                codes = [(system_of(c), c["code"]) for c in codings(r, "code") if c.get("code")]
                display = (r.get("code") or {}).get("text") or next(
                    (c.get("display") for c in codings(r, "code") if c.get("display")), None)
                if codes:
                    self.items.append({"id": r.get("id"), "kind": "cond", "display": display or codes[0][1],
                                       "codes": codes, "resolution": self.resolve_cond(codes, display)})
            elif rt == "Observation":
                codes = [(system_of(c), c["code"]) for c in codings(r, "code") if c.get("code")]
                if codes:
                    display = next((c.get("display") for c in codings(r, "code") if c.get("display")), codes[0][1])
                    self.items.append({"id": r.get("id"), "kind": "lab", "display": display, "codes": codes,
                                       "resolution": self.resolve_lab(codes)})
            elif rt == "Immunization":
                codes = [(system_of(c), c["code"]) for c in codings(r, "vaccineCode") if c.get("code")]
                if codes:
                    display = next((c.get("display") for c in codings(r, "vaccineCode") if c.get("display")), codes[0][1])
                    self.items.append({"id": r.get("id"), "kind": "vax", "display": display, "codes": codes,
                                       "resolution": self.resolve_anchor(codes, "VAL-VAX-CVX-", display)})
            elif rt == "Procedure":
                codes = [(system_of(c), c["code"]) for c in codings(r, "code") if c.get("code")]
                if codes:
                    display = next((c.get("display") for c in codings(r, "code") if c.get("display")), codes[0][1])
                    self.items.append({"id": r.get("id"), "kind": "proc", "display": display, "codes": codes,
                                       "resolution": self.resolve_anchor(codes, "VAL-PROC-SNOMED-", display)})

    def by_name_fallback(self, display):
        if not display:
            return None
        cid = self.by_name.get(display.lower())
        if cid:
            concept = self.by_cid.get(cid)
            if concept:
                return {"conceptKey": concept, "via": f"by_name:{cid}"}
        return None

    def resolve_med(self, codes, display):
        for system, code in codes:
            if system == "rxnorm":
                concept = self.by_cid.get(f"RXNORM:{code}")
                if concept:
                    return {"conceptKey": concept, "via": f"RXNORM:{code}"}
        # Multi-anchor combos (by_cid_multi) — mirrors the app matcher.
        multi = self.bundle.get("by_cid_multi") or {}
        for system, code in codes:
            if system == "rxnorm":
                keys = [k for k in multi.get(f"RXNORM:{code}", []) if k in self.concepts]
                if keys:
                    return {"conceptKey": keys[0], "conceptKeys": keys, "via": f"by_cid_multi:RXNORM:{code}"}
        for system, code in codes:
            if system == "rxnorm":
                keys = []
                for ing in self.ingredients.get(code, []):
                    concept = self.by_cid.get(f"VAL-MED-RXNORM-{ing.get('c')}")
                    if concept and concept not in keys:
                        keys.append(concept)
                if keys:
                    return {"conceptKey": keys[0], "conceptKeys": keys, "via": f"VAL-MED-RXNORM"} if len(keys) == 1 else {"conceptKey": keys[0], "conceptKeys": keys, "via": f"ingredients:RXNORM:{code}"}
        return self.by_name_fallback(display)

    def resolve_cond(self, codes, display):
        for system, code in codes:
            if system == "snomed":
                concept = self.by_cid.get(f"VAL-COND-SNOMED-{code}")
                if concept:
                    return {"conceptKey": concept, "via": f"VAL-COND-SNOMED-{code}"}
        for system, code in codes:
            if system == "icd10":
                concept = self.by_cid.get(f"VAL-COND-ICD10CM-{code}")
                if concept:
                    return {"conceptKey": concept, "via": f"VAL-COND-ICD10CM-{code}"}
                anchor = self.icd_xwalk.get(f"VAL-COND-ICD10CM-{code}")
                if anchor:
                    concept = self.by_cid.get(anchor)
                    if concept:
                        return {"conceptKey": concept, "via": f"xwalk:{anchor}"}
                if len(code) > 3:
                    cat = code[:3]
                    for cid in (f"VAL-COND-ICD10CM-{cat}", self.icd_xwalk.get(f"VAL-COND-ICD10CM-{cat}")):
                        concept = self.by_cid.get(cid) if cid else None
                        if concept:
                            return {"conceptKey": concept, "via": f"category:{cid}"}
        return self.by_name_fallback(display)

    def resolve_lab(self, codes):
        parts = set()
        for system, code in codes:
            if system == "loinc":
                parts.update(self.lab_parts.get(f"VAL-LAB-LOINC-{code}", []))
                parts.add(f"VAL-LAB-LOINC-{code}")
                parts.add(f"VAL-VIT-LOINC-{code}")
        return {"labPartCids": sorted(parts)} if parts else None

    def resolve_anchor(self, codes, prefix, display):
        for system, code in codes:
            concept = self.by_cid.get(f"{prefix}{code}")
            if concept:
                return {"conceptKey": concept, "via": f"{prefix}{code}"}
        return self.by_name_fallback(display)

    def index_concept(self, concept_key, include_loose):
        concept = self.concepts.get(concept_key)
        if not concept:
            return None
        index = {}
        for bucket in BUCKETS:
            members = concept.get("buckets", {}).get(bucket) or []
            indexed = {}
            concepts = set()
            for m in members:
                prov = m.get("provenance")
                if not include_loose and prov in LOOSE:
                    continue
                indexed[m["cid"]] = (m["name"], prov, None)
                member_concept = self.by_cid.get(m["cid"])
                if member_concept:
                    concepts.add(member_concept)
            if indexed:
                index[bucket] = (indexed, concepts)
        # Parent (hub) union — monitor buckets only, per the IS_A allowlist.
        for parent_cid in concept.get("parent_cids") or []:
            parent_key = self.by_cid.get(parent_cid)
            parent = self.concepts.get(parent_key) if parent_key else None
            if not parent:
                continue
            for bucket in ("lab", "vital", "procedure"):
                for m in parent.get("buckets", {}).get(bucket) or []:
                    prov = m.get("provenance")
                    if not include_loose and prov in LOOSE:
                        continue
                    entry = index.setdefault(bucket, ({}, set()))
                    if m["cid"] in entry[0]:
                        continue
                    entry[0][m["cid"]] = (m["name"], prov, parent.get("name"))
                    member_concept = self.by_cid.get(m["cid"])
                    if member_concept:
                        entry[1].add(member_concept)
        return index

    def _match_focus_against(self, fk, cand, cres, cand_keys, include_loose):
        """One best match for a single focus concept key against a candidate
        (any-of ingredient keys for combo candidates)."""
        index = self.index_concept(fk, include_loose)
        if not index:
            return None
        cand_parts = cres.get("labPartCids")
        for bucket in BUCKETS:
            entry = index.get(bucket)
            if not entry:
                continue
            members, concepts = entry
            mk = next((k for k in cand_keys if k in concepts), None)
            if mk:
                name = prov = hub = None
                for cid, (n, p, h) in members.items():
                    if self.by_cid.get(cid) == mk:
                        name, prov, hub = n, p, h
                        break
                return (cand, bucket, name or cand["display"], prov, hub)
            if cand_parts and bucket in ("lab", "vital"):
                for part in cand_parts:
                    if part in members:
                        n, p, h = members[part]
                        return (cand, bucket, n, p, h)
        return None

    def match(self, focus_item, include_loose):
        """Mirror matcher.ts: one best match per candidate item."""
        res = focus_item.get("resolution") or {}
        results = []
        for cand in self.items:
            if cand is focus_item:
                continue
            cres = cand.get("resolution") or {}
            if res.get("conceptKey"):
                # Combos fan across every ingredient concept; first hit wins.
                focus_keys = res.get("conceptKeys") or [res["conceptKey"]]
                cand_keys = cres.get("conceptKeys") or ([cres["conceptKey"]] if cres.get("conceptKey") else [])
                matched = None
                for fk in focus_keys:
                    matched = self._match_focus_against(fk, cand, cres, cand_keys, include_loose)
                    if matched:
                        break
                if matched:
                    results.append(matched)
                continue
            if res.get("conceptKey"):
                index = self.index_concept(res["conceptKey"], include_loose)
                if not index:
                    continue
                cand_concept = cres.get("conceptKey")
                cand_parts = cres.get("labPartCids")
                for bucket in BUCKETS:
                    entry = index.get(bucket)
                    if not entry:
                        continue
                    members, concepts = entry
                    if cand_concept and cand_concept in concepts:
                        name = prov = hub = None
                        for cid, (n, p, h) in members.items():
                            if self.by_cid.get(cid) == cand_concept:
                                name, prov, hub = n, p, h
                                break
                        results.append((cand, bucket, name or cand["display"], prov, hub))
                        break
                    if cand_parts and bucket in ("lab", "vital"):
                        for part in cand_parts:
                            if part in members:
                                n, p, h = members[part]
                                results.append((cand, bucket, n, p, h))
                                break
                        else:
                            continue
                        break
            elif res.get("labPartCids"):
                cand_concept = cres.get("conceptKey")
                if not cand_concept:
                    continue
                index = self.index_concept(cand_concept, include_loose)
                if not index:
                    continue
                for bucket in ("lab", "vital"):
                    entry = index.get(bucket)
                    if not entry:
                        continue
                    members, _ = entry
                    for part in res["labPartCids"]:
                        if part in members:
                            n, p, h = members[part]
                            results.append((cand, bucket, n, p, h))
                            break
                    else:
                        continue
                    break
        return results

    def report(self, fixture_name):
        lines = [f"# {fixture_name}", ""]
        for kind, label in [("med", "Medications"), ("cond", "Conditions"), ("lab", "Labs/vitals"),
                            ("vax", "Immunizations"), ("proc", "Procedures")]:
            items = [i for i in self.items if i["kind"] == kind]
            if not items:
                continue
            lines.append(f"## {label} ({len(items)})")
            for item in items:
                res = item.get("resolution") or {}
                if res.get("conceptKeys") and len(res["conceptKeys"]) > 1:
                    via = f" -> {' + '.join(res['conceptKeys'])} [{res['via']}]"
                elif res.get("conceptKey"):
                    via = f" -> {res['conceptKey']} [{res['via']}]"
                elif res.get("labPartCids"):
                    via = f" -> {len(res['labPartCids'])} candidate CIDs"
                else:
                    via = " -> UNRESOLVED"
                lines.append(f"- **{item['display']}**{via}")
                codes = ", ".join(f"{s}:{c}" for s, c in item["codes"][:4])
                lines.append(f"  codes: {codes}")
                if not res or (not res.get("conceptKey") and not res.get("labPartCids")):
                    continue
                default = self.match(item, include_loose=False)
                loose = self.match(item, include_loose=True)
                default_keys = {(c["id"], b) for c, b, _, _, _ in default}
                if default:
                    lines.append("  related (default tier):")
                    for cand, bucket, name, prov, hub in default:
                        lines.append(f"    [{bucket}] {cand['display']} (via \"{name}\"{f', {prov}' if prov else ''}{f', hub: {hub}' if hub else ''})")
                else:
                    lines.append("  related (default tier): NONE")
                extra = [(c, b, n, p, h) for c, b, n, p, h in loose if (c["id"], b) not in default_keys]
                if extra:
                    lines.append("  loose-only:")
                    for cand, bucket, name, prov, hub in extra:
                        lines.append(f"    [{bucket}] {cand['display']} (via \"{name}\"{f', {prov}' if prov else ''}{f', hub: {hub}' if hub else ''})")
            lines.append("")
        return "\n".join(lines)


def main():
    fixture = sys.argv[1]
    bundle, lab_parts, icd_xwalk, ingredients = load_bundle()
    patient = Patient(fixture, bundle, lab_parts, icd_xwalk, ingredients)
    print(patient.report(os.path.basename(fixture)))


if __name__ == "__main__":
    main()
