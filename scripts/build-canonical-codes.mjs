/**
 * Build script: canonical_codes.csv → 3 lazy-loaded JSON assets.
 *
 * Reads D:\medterm4ds\reports\fhir4px\canonical_codes.csv (or override via
 * CANONICAL_CODES_CSV env var), splits by category, keeps only friendly_name +
 * canonical_code, outputs to public/terminology/canonical-codes/.
 *
 *   node scripts/build-canonical-codes.mjs
 *
 * Output:
 *   public/terminology/canonical-codes/conditions.json
 *   public/terminology/canonical-codes/labs.json
 *   public/terminology/canonical-codes/medications.json
 *
 * Each file shape:
 *   { version, generatedAt, source, system, count, codes: { "<Name>": "<code>" } }
 */

import { createReadStream } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SOURCE_CSV =
  process.env.CANONICAL_CODES_CSV ||
  "/mnt/d/medterm4ds/reports/fhir4px/canonical_codes.csv";
const OUTPUT_DIR = resolve(ROOT, "public/terminology/canonical-codes");

const CATEGORY_TO_SYSTEM = {
  condition: "icd10",
  lab: "loinc",
  medication: "rxnorm"
};

const CATEGORY_TO_FILE = {
  condition: "conditions.json",
  lab: "labs.json",
  medication: "medications.json"
};

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Interim canonical-choice heuristic (until the curated CSV lands): when a
// friendly name maps to several codes, prefer the oldest-established one —
// lowest numeric code for LOINC/RxNorm, shortest then lexicographic for
// ICD-10. Deterministic and biased toward the long-standing primary code
// (e.g. "Creatinine" -> 2160-0, not 101475-2).
function preferredCode(system, a, b) {
  if (system === "icd10") {
    if (a.length !== b.length) return a.length < b.length ? a : b;
    return a < b ? a : b;
  }
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isNaN(na) !== Number.isNaN(nb)) return Number.isNaN(na) ? b : a;
  if (!Number.isNaN(na) && na !== nb) return na < nb ? a : b;
  return a < b ? a : b;
}

const FRIENDLY_SOURCES = {
  condition: { path: "public/terminology/patient_friendly_icd10cm.json", system: "icd10" },
  lab: { path: "public/terminology/patient_friendly_lnc.json", system: "loinc" },
  medication: { path: "public/terminology/patient_friendly_rxnorm.json", system: "rxnorm" }
};

async function sourceRows() {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(SOURCE_CSV);
    return { kind: "csv" };
  } catch {
    // medterm4ds CSV not built yet: fall back to inverting the app's own
    // patient-friendly terminology (code -> name becomes name -> code).
    const rows = [];
    for (const [category, src] of Object.entries(FRIENDLY_SOURCES)) {
      const raw = JSON.parse(await fs.readFile(src.path, "utf8"));
      for (const [code, entry] of Object.entries(raw)) {
        rows.push([category, entry.name, src.system, code]);
      }
    }
    return { kind: "friendly-inversion", rows };
  }
}

async function main() {
  const source = await sourceRows();
  if (source.kind === "csv") {
    console.log(`Reading ${SOURCE_CSV}`);
  } else {
    console.log(`CSV missing (${SOURCE_CSV}); inverting patient-friendly terminology instead (${source.rows.length} rows)`);
  }
  await mkdir(OUTPUT_DIR, { recursive: true });

  const maps = {
    condition: new Map(),
    lab: new Map(),
    medication: new Map()
  };

  let headerSeen = false;
  let totalRows = 0;
  let skippedNoCode = 0;
  let skippedUnknownCat = 0;

  // Minimal CSV line parser — handles quoted fields with commas
  function parseCsvLine(line) {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current);
    return fields;
  }

  const rl = source.kind === "csv"
    ? createInterface({ input: createReadStream(SOURCE_CSV, { encoding: "utf8" }), crlfDelay: Infinity })
    : null;

  if (rl) for await (const line of rl) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (!headerSeen) {
      // Verify expected header
      const expected = ["category", "friendly_name", "canonical_source", "canonical_code"];
      for (let i = 0; i < expected.length; i += 1) {
        if (fields[i] !== expected[i]) {
          throw new Error(`Unexpected header at column ${i}: got '${fields[i]}' (expected '${expected[i]}')`);
        }
      }
      headerSeen = true;
      continue;
    }
    totalRows += 1;
    const [category, friendlyName, , canonicalCode] = fields;
    if (!category || !friendlyName || !canonicalCode) {
      skippedNoCode += 1;
      continue;
    }
    const map = maps[category];
    if (!map) {
      skippedUnknownCat += 1;
      continue;
    }
    // Strict-normalized key. If two friendly names normalize to the same key
    // (e.g., "HbA1c" and "Hb A1c" both → "hba1c"), keep the first. The CSV
    // is curated so collisions are rare; preserving first-seen is deterministic.
    const key = normalizeName(friendlyName);
    if (!map.has(key)) {
      map.set(key, canonicalCode);
    }
  }

  if (source.kind === "friendly-inversion") {
    // Interim (uncurated) source: keep ONLY names that map to exactly one
    // code. Ambiguous names (e.g. "Creatinine" -> serum, urine, clearance
    // variants) are dropped rather than guessed; the curated CSV from the
    // medterm4ds pipeline is the real fix. Strict misses are safe — callers
    // fall back gracefully when lookupCanonicalCode returns undefined.
    const ambiguous = { condition: new Set(), lab: new Set(), medication: new Set() };
    for (const [category, friendlyName, , canonicalCode] of source.rows) {
      totalRows += 1;
      if (!category || !friendlyName || !canonicalCode) {
        skippedNoCode += 1;
        continue;
      }
      const map = maps[category];
      if (!map) {
        skippedUnknownCat += 1;
        continue;
      }
      const key = normalizeName(friendlyName);
      if (ambiguous[category].has(key)) continue;
      if (!map.has(key)) {
        map.set(key, canonicalCode);
      } else if (map.get(key) !== canonicalCode) {
        map.delete(key);
        ambiguous[category].add(key);
      }
    }
  }

  console.log(`  ${totalRows} rows parsed; ${skippedNoCode} skipped (missing fields); ${skippedUnknownCat} skipped (unknown category)`);

  const generatedAt = new Date().toISOString();
  for (const [category, map] of Object.entries(maps)) {
    const codes = Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const output = {
      version: 1,
      generatedAt,
      source: source.kind === "csv" ? "medterm4ds/reports/fhir4px/canonical_codes.csv" : "patient-friendly terminology inversion",
      system: CATEGORY_TO_SYSTEM[category],
      count: map.size,
      codes
    };
    const outputPath = resolve(OUTPUT_DIR, CATEGORY_TO_FILE[category]);
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    const sizeKb = Math.round(JSON.stringify(output).length / 1024);
    console.log(`  ${category}: ${map.size} entries → ${outputPath} (${sizeKb} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
