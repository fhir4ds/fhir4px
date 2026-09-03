#!/usr/bin/env node
/**
 * Bundle drift-diff: compare two association bundle snapshots and report
 * every semantic delta — the instrument that caught the unannounced-change
 * classes of 2026-09-01..09-03 (member provenance flips, AE-fan drops,
 * alias waves, by_name removals) as a standing tool instead of ad-hoc SQL.
 *
 * Two modes:
 *   snapshot:  node scripts/diff_bundles.mjs data/2026-09-02.2138.json.gz data/2026-09-03.1430.json.gz
 *   wire:      node scripts/diff_bundles.mjs --wire data/2026-09-03.1430.json.gz
 *              (fetches the live bundle, diffs against the snapshot, and on
 *               --accept saves it as the new baseline)
 *
 * Snapshots live in data/bundles/ (gitignored; the raw bundle is ~160MB).
 * Save a baseline each time the live suite pins a version:
 *   node scripts/diff_bundles.mjs --wire data/bundles/<version>.json.gz --accept
 *
 * Optional manifest gate: --manifest <file.json> carries the publisher's
 * announced counts; exit code 1 when observed drift exceeds them, so
 * acceptance can fail on unannounced changes. Manifest shape:
 *   { "version": "2026-09-03.1430", "announced": {
 *       "by_cid_flips_max": 700, "member_placements_added_max": 9000,
 *       "member_placements_removed_max": 6000 } }
 *
 * Report sections (all counts + top offenders):
 *   version/format, by_cid (flips/adds/drops), by_name (adds/removes),
 *   member quint-diff (placements added/removed, provenance-only changes,
 *   rename relocations), concepts added/removed, crosswalk note.
 */
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const HF_BASE = "https://huggingface.co/fhir4ds/fhir4px/resolve/main/associations";

function usageAndExit(code = 0) {
  console.log(`usage:
  node scripts/diff_bundles.mjs <old.json.gz> <new.json.gz> [options]
  node scripts/diff_bundles.mjs --wire <baseline.json.gz> [options]
options:
  --accept            (wire mode) save the fetched bundle as a new baseline snapshot
  --manifest <file>   gate: exit 1 when observed drift exceeds announced counts
  --json              machine-readable report on stdout (human summary on stderr)
  --top <n>           offenders per section (default 8)`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { files: [], top: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wire") args.wire = true;
    else if (a === "--accept") args.accept = true;
    else if (a === "--json") args.json = true;
    else if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--top") args.top = Number(argv[++i]);
    else if (a === "--help" || a === "-h") usageAndExit();
    else if (a.startsWith("--")) { console.error(`unknown flag ${a}`); usageAndExit(2); }
    else args.files.push(a);
  }
  if (args.wire) {
    if (args.files.length !== 1) usageAndExit(2);
    [args.baseline] = args.files;
  } else if (args.files.length !== 2) usageAndExit(2);
  return args;
}

function readBundleGz(path) {
  const raw = readFileSync(path);
  const text = gunzipSync(raw).toString("utf8");
  const bundle = JSON.parse(text);
  return { bundle, md5gz: createHash("md5").update(raw).digest("hex"), md5raw: createHash("md5").update(gunzipSync(raw)).digest("hex") };
}

async function fetchWire() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${HF_BASE}/associations.json.gz`, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      gunzipSync(buf); // integrity check before parsing
      const bundle = JSON.parse(gunzipSync(buf).toString("utf8"));
      return {
        bundle,
        md5gz: createHash("md5").update(buf).digest("hex"),
        md5raw: createHash("md5").update(gunzipSync(buf)).digest("hex")
      };
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

function triples(bundle) {
  const set = new Set();
  for (const [ck, concept] of Object.entries(bundle.concepts)) {
    for (const [bucket, members] of Object.entries(concept.buckets ?? {})) {
      for (const m of members) set.add(`${ck}\u0001${bucket}\u0001${m.cid}`);
    }
  }
  return set;
}

function diff(oldB, newB, top) {
  const report = { versions: { old: oldB.version, new: newB.version }, format: { old: oldB.format, new: newB.format } };

  // by_cid
  const flips = [], adds = [], drops = [];
  const oldCids = new Set(Object.keys(oldB.by_cid));
  for (const [cid, concept] of Object.entries(newB.by_cid)) {
    if (!oldCids.has(cid)) adds.push({ cid, concept });
    else if (oldB.by_cid[cid] !== concept) flips.push({ cid, from: oldB.by_cid[cid], to: concept });
  }
  for (const cid of oldCids) if (!(cid in newB.by_cid)) drops.push({ cid, from: oldB.by_cid[cid] });
  report.by_cid = { flips: flips.length, added: adds.length, dropped: drops.length,
    flip_sample: flips.slice(0, top), drop_sample: drops.slice(0, top) };

  // by_name
  const nameRemoved = [], nameAdded = [];
  for (const k of Object.keys(oldB.by_name)) if (!(k in newB.by_name)) nameRemoved.push({ name: k, was: oldB.by_cid[oldB.by_name[k]] });
  for (const k of Object.keys(newB.by_name)) if (!(k in oldB.by_name)) nameAdded.push({ name: k, now: newB.by_cid[newB.by_name[k]] });
  report.by_name = { removed: nameRemoved.length, added: nameAdded.length,
    removed_sample: nameRemoved.slice(0, top), added_sample: nameAdded.slice(0, top) };

  // concepts
  const conceptsAdded = Object.keys(newB.concepts).filter((k) => !(k in oldB.concepts));
  const conceptsRemoved = Object.keys(oldB.concepts).filter((k) => !(k in newB.concepts));
  report.concepts = { added: conceptsAdded.length, removed: conceptsRemoved.length,
    added_sample: conceptsAdded.slice(0, top), removed_sample: conceptsRemoved.slice(0, top) };

  // member quint-diff: placements, provenance-only changes, relocations
  const tOld = triples(oldB), tNew = triples(newB);
  const lost = [...tOld].filter((t) => !tNew.has(t));
  const gained = [...tNew].filter((t) => !tOld.has(t));
  const memberIdsNew = new Set([...tNew].map((t) => t.split("\u0001").slice(1).join("\u0001")));
  let relocated = 0;
  const trulyLost = [];
  for (const t of lost) {
    const [, bucket, cid] = t.split("\u0001");
    if (memberIdsNew.has(`${bucket}\u0001${cid}`)) relocated++;
    else trulyLost.push(t);
  }
  // provenance-only changes: same placement, different provenance field
  const provChanges = [];
  const newMemberIndex = new Map(); // bucket+cid -> [{concept, provenance}]
  for (const t of tNew) {
    const [ck, bucket, cid] = t.split("\u0001");
    const m = newB.concepts[ck]?.buckets?.[bucket]?.find((x) => x.cid === cid);
    const key = `${bucket}\u0001${cid}`;
    if (!newMemberIndex.has(key)) newMemberIndex.set(key, []);
    newMemberIndex.get(key).push({ ck, provenance: m?.provenance ?? null });
  }
  for (const t of tOld) {
    if (tNew.has(t)) continue;
    const [ck, bucket, cid] = t.split("\u0001");
    const om = oldB.concepts[ck]?.buckets?.[bucket]?.find((x) => x.cid === cid);
    const twins = newMemberIndex.get(`${bucket}\u0001${cid}`) ?? [];
    // same concept key, same member, provenance moved? (lost+gained pair)
    const twin = twins.find((x) => x.ck === ck);
    if (twin && twin.provenance !== (om?.provenance ?? null)) {
      provChanges.push({ concept: ck, bucket, cid, from: om?.provenance ?? null, to: twin.provenance });
    }
  }
  const provOnly = provChanges.filter((p) => tOld.has(`${p.concept}\u0001${p.bucket}\u0001${p.cid}`) === false || true);
  // simpler count: provenance fields that changed on stable placements
  let provChangedOnStable = 0;
  const provChangedSamples = [];
  for (const t of tOld) {
    if (!tNew.has(t)) continue;
    const [ck, bucket, cid] = t.split("\u0001");
    const om = oldB.concepts[ck]?.buckets?.[bucket]?.find((x) => x.cid === cid);
    const nm = newB.concepts[ck]?.buckets?.[bucket]?.find((x) => x.cid === cid);
    if ((om?.provenance ?? null) !== (nm?.provenance ?? null)) {
      provChangedOnStable++;
      if (provChangedSamples.length < top) provChangedSamples.push({ concept: ck, bucket, cid, from: om?.provenance ?? null, to: nm?.provenance ?? null });
    }
  }
  report.members = {
    placements_added: gained.length,
    placements_removed: lost.length,
    removed_but_relocated: relocated,
    removed_fully_lost: trulyLost.length,
    fully_lost_sample: trulyLost.slice(0, top),
    provenance_changed_on_stable_placements: provChangedOnStable,
    provenance_change_sample: provChangedSamples
  };
  void provOnly;

  // by_cid_multi
  const multiOld = oldB.by_cid_multi ?? {};
  const multiNew = newB.by_cid_multi ?? {};
  report.by_cid_multi = {
    added: Object.keys(multiNew).filter((k) => !(k in multiOld)).length,
    dropped: Object.keys(multiOld).filter((k) => !(k in multiNew)).length,
    changed: Object.keys(multiNew).filter((k) => k in multiOld && JSON.stringify(multiOld[k]) !== JSON.stringify(multiNew[k])).length
  };

  return report;
}

function humanize(r) {
  const L = [];
  L.push(`bundle drift: ${r.versions.old} -> ${r.versions.new} (format ${r.format.old} -> ${r.format.new})`);
  L.push(`by_cid: ${r.by_cid.flips} flips, +${r.by_cid.added} added, -${r.by_cid.dropped} dropped`);
  L.push(`by_name: +${r.by_name.added} added, -${r.by_name.removed} removed`);
  L.push(`concepts: +${r.concepts.added} added, -${r.concepts.removed} removed`);
  L.push(`by_cid_multi: +${r.by_cid_multi.added}, -${r.by_cid_multi.dropped}, ~${r.by_cid_multi.changed} changed`);
  L.push(`members: +${r.members.placements_added} placements, -${r.members.placements_removed} (${r.members.removed_but_relocated} relocated, ${r.members.removed_fully_lost} FULLY LOST)`);
  L.push(`provenance changed on stable placements: ${r.members.provenance_changed_on_stable_placements}`);
  if (r.by_cid.flip_sample.length) L.push(`flip sample: ${r.by_cid.flip_sample.map((f) => `${f.cid}: ${f.from} -> ${f.to}`).join("; ").slice(0, 400)}`);
  if (r.by_name.removed_sample.length) L.push(`by_name removed sample: ${r.by_name.removed_sample.map((n) => n.name).join(", ")}`);
  if (r.members.fully_lost_sample.length) L.push(`fully-lost sample: ${r.members.fully_lost_sample.slice(0, 4).map((t) => t.split("\u0001").join("/")).join(" | ")}`);
  if (r.members.provenance_change_sample.length) L.push(`provenance sample: ${r.members.provenance_change_sample.slice(0, 4).map((p) => `${p.concept}/${p.bucket}: ${p.from} -> ${p.to}`).join(" | ")}`);
  return L.join("\n");
}

function gate(report, manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const a = manifest.announced ?? {};
  const violations = [];
  const check = (key, actual) => {
    if (a[key] !== undefined && actual > a[key]) violations.push(`${key}: observed ${actual} > announced ${a[key]}`);
  };
  check("by_cid_flips_max", report.by_cid.flips);
  check("by_cid_added_max", report.by_cid.added);
  check("by_cid_dropped_max", report.by_cid.dropped);
  check("member_placements_added_max", report.members.placements_added);
  check("member_placements_removed_max", report.members.placements_removed);
  check("provenance_changed_max", report.members.provenance_changed_on_stable_placements);
  if (manifest.version && manifest.version !== report.versions.new) {
    violations.push(`version: observed ${report.versions.new} != announced ${manifest.version}`);
  }
  return violations;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let oldSnap, newSnap;
  if (args.wire) {
    oldSnap = readBundleGz(resolve(args.baseline));
    console.error(`baseline: ${args.baseline} (${oldSnap.bundle.version}, gz ${oldSnap.md5gz.slice(0, 8)}, raw ${oldSnap.md5raw.slice(0, 8)})`);
    newSnap = await fetchWire();
    console.error(`wire: ${newSnap.bundle.version} (gz ${newSnap.md5gz.slice(0, 8)}, raw ${newSnap.md5raw.slice(0, 8)})`);
  } else {
    oldSnap = readBundleGz(resolve(args.files[0]));
    newSnap = readBundleGz(resolve(args.files[1]));
  }
  const report = diff(oldSnap.bundle, newSnap.bundle, args.top);
  if (args.json) console.log(JSON.stringify(report, null, 1));
  else console.log(humanize(report));

  if (args.manifest) {
    const violations = gate(report, args.manifest);
    if (violations.length) {
      console.error(`\nMANIFEST GATE FAILED (${violations.length}):`);
      for (const v of violations) console.error(`  - ${v}`);
      process.exitCode = 1;
    } else {
      console.error("\nmanifest gate: PASS");
    }
  }

  if (args.wire && args.accept) {
    const dir = dirname(resolve(args.baseline));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const out = resolve(dir, `${newSnap.bundle.version}.json.gz`);
    // fetch again to persist the exact bytes we hashed
    const res = await fetch(`${HF_BASE}/associations.json.gz`, { redirect: "follow" });
    const buf = Buffer.from(await res.arrayBuffer());
    const md5 = createHash("md5").update(buf).digest("hex");
    if (md5 !== newSnap.md5gz) {
      console.error("wire changed during accept — refetch and re-run");
      process.exitCode = 1;
      return;
    }
    writeFileSync(out, buf);
    // rotate baseline pointer by renaming baseline to versioned name if needed
    if (basename(args.baseline) !== `${newSnap.bundle.version}.json.gz` && existsSync(args.baseline)) {
      renameSync(args.baseline, resolve(dir, `${oldSnap.bundle.version}.json.gz`));
      console.error(`rotated previous baseline to ${oldSnap.bundle.version}.json.gz`);
    }
    console.error(`accepted: saved ${out}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
