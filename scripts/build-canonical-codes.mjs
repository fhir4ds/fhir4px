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

async function main() {
  console.log(`Reading ${SOURCE_CSV}`);
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Stream the CSV line by line to avoid loading 26MB into memory
  const rl = createInterface({
    input: createReadStream(SOURCE_CSV, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

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

  for await (const line of rl) {
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

  console.log(`  ${totalRows} rows parsed; ${skippedNoCode} skipped (missing fields); ${skippedUnknownCat} skipped (unknown category)`);

  const generatedAt = new Date().toISOString();
  for (const [category, map] of Object.entries(maps)) {
    const codes = Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const output = {
      version: 1,
      generatedAt,
      source: "medterm4ds/reports/fhir4px/canonical_codes.csv",
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
