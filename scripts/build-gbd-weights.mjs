/**
 * Build script: GBD disability weights → ICD-10 keyed JSON.
 *
 * Reads the IHME GBD 2023 DIRF Appendix 1 ZIP, parses S9 (sequelae with
 * disability weights) and S13 (cause → ICD-10 code list), joins them via
 * cause name, expands ICD-10 ranges, and emits a static JSON asset keyed by
 * ICD-10 code with the max DW across sequelae per cause.
 *
 * Run once after updating the source ZIP. Output is checked in.
 *
 *   node scripts/build-gbd-weights.mjs
 *
 * Output: public/terminology/gbd_disability_weights.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { unlink } from "node:fs/promises";

import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SOURCE_ZIP =
  process.env.GBD_SOURCE_ZIP ||
  resolve(ROOT, "data/IHME_GBD_2023_DIRF_1990_2023_APPENDIX_1_TABLES_0.zip");
const OUTPUT_JSON = resolve(ROOT, "public/terminology/gbd_disability_weights.json");

/**
 * S9 sequelae names are descriptive (e.g., "Symptomatic HIV with mild anemia",
 * "Asymptomatic congenital syphilis") — they don't always follow a strict
 * "<cause> - <detail>" pattern. The cause name often appears as a substring
 * with whitespace/separator boundaries.
 *
 * Strategy: longest-match-first. For each S9 row, find the longest S13 cause
 * that appears as a substring with a non-word boundary on both sides (space,
 * dash, slash, comma, or string end).
 */
function matchCause(sequelaeName, causeNamesSorted) {
  const normalized = sequelaeName.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return null;
  for (const candidateRaw of causeNamesSorted) {
    const candidate = candidateRaw.toLowerCase();
    if (!candidate) continue;
    if (normalized === candidate) return candidateRaw;
    const idx = normalized.indexOf(candidate);
    if (idx === -1) continue;
    const before = idx === 0 ? "" : normalized[idx - 1];
    const afterIdx = idx + candidate.length;
    const after = afterIdx >= normalized.length ? "" : normalized[afterIdx];
    // Acceptable boundaries: whitespace, dash, slash, comma, or end of string
    const isBoundary = (c) => !c || /[\s\-/,&]/.test(c);
    if (isBoundary(before) && isBoundary(after)) return candidateRaw;
  }
  return null;
}

/**
 * Given a cause that may lack ICD codes, find the nearest ancestor (by prefix)
 * that has codes. Cause names form a natural tree via string prefix matching:
 * "Diabetes mellitus" is an ancestor of "Diabetes mellitus type 2".
 */
function resolveCodesForCause(cause, causeToIcd, allCausesByLength) {
  if (causeToIcd.has(cause)) return causeToIcd.get(cause);
  // Walk up: find the longest other cause that's a strict prefix of this one
  for (const candidate of allCausesByLength) {
    if (candidate.length >= cause.length) continue;
    if (cause.startsWith(candidate + " ") || cause === candidate) {
      if (causeToIcd.has(candidate)) return causeToIcd.get(candidate);
    }
  }
  return null;
}

function parseIcd10Codes(rawCell) {
  if (!rawCell || typeof rawCell !== "string") return [];
  // Format: "A50-A529, I980" — comma-separated, ranges use hyphen
  return rawCell
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^[A-Z]\d/i.test(s)) // must start with letter + digit
    .map((s) => s.toUpperCase());
}

/**
 * Expand a list of ICD-10 tokens (single codes or ranges) into individual codes.
 * Tokens like "A50" produce A50 alone. Tokens like "A50-A529" produce A50,
 * A50.0–A50.9, A51, A51.0–A51.9, A52, A52.0–A52.9.
 */
function expandIcd10Tokens(tokens) {
  const codes = new Set();
  for (const token of tokens) {
    if (token.includes("-")) {
      const [start, end] = token.split("-").map((s) => s.trim());
      for (const code of expandRange(start, end)) codes.add(code);
    } else {
      codes.add(token);
    }
  }
  return [...codes];
}

function parseCodeParts(code) {
  // "A50" → { letter: "A", base: 50, subcode: undefined }
  // "A529" → { letter: "A", base: 52, subcode: 9 }
  // "A011" → { letter: "A", base: 1, subcode: 1 } (treated as A01.1)
  const m = code.match(/^([A-Z])(\d{2})(\d{1,2})?$/);
  if (!m) return null;
  return {
    letter: m[1],
    base: parseInt(m[2], 10),
    subcode: m[3] ? parseInt(m[3].padEnd(2, "0").slice(0, 2), 10) : undefined
  };
}

function expandRange(startRaw, endRaw) {
  const start = parseCodeParts(startRaw);
  const end = parseCodeParts(endRaw);
  if (!start || !end || start.letter !== end.letter) {
    // Cross-letter or unparseable — just return the two endpoints
    return [startRaw, endRaw].filter(Boolean);
  }
  const codes = [];
  const letter = start.letter;
  for (let base = start.base; base <= end.base; base += 1) {
    const baseStr = `${letter}${String(base).padStart(2, "0")}`;
    codes.push(baseStr);
    const subStart = base === start.base ? start.subcode ?? 0 : 0;
    const subEnd = base === end.base ? end.subcode ?? 9 : 9;
    for (let sub = subStart; sub <= subEnd; sub += 1) {
      // ICD-10 subcodes are 1-digit; we expand to single-digit dotted form
      // (covers the vast majority of GBD ranges). 2-digit subcodes (e.g.
      // A50.01) are rare and the patient-friendly lookup uses 3-char form.
      if (sub >= 0 && sub <= 9) codes.push(`${baseStr}.${sub}`);
    }
  }
  return codes;
}

async function unzipEntry(zipPath, entryName, destPath) {
  // Use Node's built-in (no unzip CLI) — read the central directory via XLSX? No.
  // Use the yauzl package — but that's an extra dep. Easier: shell out to
  // python's zipfile via spawn, OR use node's built-in zlib + manual ZIP parse.
  // For one-shot build scripts, simplest is to read the whole zip with the
  // `unzipper` package or call `python3 -c`. We use the latter since python
  // is already in the toolchain.
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("python3", ["-c", `
import zipfile, sys
with zipfile.ZipFile(${JSON.stringify(zipPath)}) as z:
    with z.open(${JSON.stringify(entryName)}) as f:
        sys.stdout.buffer.write(f.read())
`], { maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${entryName}: ${result.stderr?.toString() ?? "unknown"}`);
  }
  await writeFile(destPath, result.stdout);
}

async function loadSheet(zipPath, entryName) {
  const tmpPath = resolve(ROOT, `.tmp-${entryName.replace(/[/\\]/g, "_")}`);
  try {
    await unzipEntry(zipPath, entryName, tmpPath);
    const buf = await readFile(tmpPath);
    const workbook = XLSX.read(buf, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // header: 1 returns array-of-arrays
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });
  } finally {
    try { await unlink(tmpPath); } catch {}
  }
}

function pickHeaderRow(rows, requiredCols) {
  // Find the first row whose cells include all requiredCols (case-insensitive)
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? "").toLowerCase().trim());
    if (requiredCols.every((req) => cells.some((c) => c.includes(req.toLowerCase()))) ) {
      return i;
    }
  }
  return -1;
}

async function main() {
  console.log(`Reading ${SOURCE_ZIP}`);
  const zipBuffer = await readFile(SOURCE_ZIP);

  // List entries via python (one round-trip)
  const { spawnSync } = await import("node:child_process");
  const listing = spawnSync("python3", ["-c", `
import zipfile, json
with zipfile.ZipFile(${JSON.stringify(SOURCE_ZIP)}) as z:
    print(json.dumps(z.namelist()))
`]);
  if (listing.status !== 0) {
    throw new Error(`Failed to list ZIP: ${listing.stderr?.toString()}`);
  }
  const entries = JSON.parse(listing.stdout.toString());
  const s9Name = entries.find((n) => /TABLE_S9_/i.test(n));
  const s13Name = entries.find((n) => /TABLE_S13_/i.test(n));
  if (!s9Name || !s13Name) {
    throw new Error(`Could not find S9/S13 in ZIP. Entries: ${entries.join(", ")}`);
  }

  console.log(`Parsing ${s9Name}`);
  const s9Rows = await loadSheet(SOURCE_ZIP, s9Name);
  console.log(`  ${s9Rows.length} rows`);
  console.log(`Parsing ${s13Name}`);
  const s13Rows = await loadSheet(SOURCE_ZIP, s13Name);
  console.log(`  ${s13Rows.length} rows`);

  // S13 — cause hierarchy with ICD codes at leaves
  // Headers: "Cause", "ICD10 Used in Hospital/Claims Analyses", "ICD9 ..."
  // Empty ICD cells for parent rows. Take every row with a non-empty ICD-10 cell.
  const causeToIcd = new Map();
  const allCauses = new Set();
  for (const row of s13Rows) {
    const cause = String(row[0] ?? "").trim();
    if (!cause || cause.toLowerCase() === "cause") continue;
    allCauses.add(cause);
    const icd10 = String(row[1] ?? "").trim();
    if (!icd10) continue;
    const tokens = parseIcd10Codes(icd10);
    if (tokens.length === 0) continue;
    const expanded = expandIcd10Tokens(tokens);
    causeToIcd.set(cause, expanded);
  }
  console.log(`  ${causeToIcd.size} causes with ICD-10 codes (out of ${allCauses.size} total S13 causes)`);

  // Sort ALL causes by length DESC for longest-prefix matching
  const allCausesByLength = [...allCauses].sort((a, b) => b.length - a.length);

  // S9 — sequelae with DW
  // Headers row 1: "Sequelae name", "Health state name", "Health state lay description", "Disability Weight"
  // Row 2: "", "", "", "Mean", "Lower", "Upper"
  // Data from row 3 onward
  const causeToMaxDw = new Map();
  let unmatchedCount = 0;
  let matchedCount = 0;
  for (const row of s9Rows.slice(2)) {
    const sequelaeName = String(row[0] ?? "").trim();
    const meanDw = parseFloat(row[3]);
    if (!sequelaeName || !Number.isFinite(meanDw)) continue;
    // Skip combined-DW rows (those have "(combined DW)" in the health state column)
    const healthState = String(row[1] ?? "").trim();
    if (healthState.toLowerCase().includes("combined dw")) {
      // Combined DWs aren't a single cause's presentation — skip to avoid
      // double-counting multi-morbidity combos.
      continue;
    }
    const cause = matchCause(sequelaeName, allCausesByLength);
    if (!cause) {
      unmatchedCount += 1;
      continue;
    }
    matchedCount += 1;
    const current = causeToMaxDw.get(cause);
    if (current === undefined || meanDw > current) {
      causeToMaxDw.set(cause, meanDw);
    }
  }
  console.log(`  S9: ${matchedCount} matched, ${unmatchedCount} unmatched sequelae`);
  console.log(`  ${causeToMaxDw.size} causes aggregated to a max DW`);

  // Build ICD-10 → DW map
  const weights = {};
  let codeCount = 0;
  let causesWithoutCodes = 0;
  for (const [cause, dw] of causeToMaxDw) {
    // Leaf cause may lack ICD codes; walk up the prefix tree to find an ancestor with codes.
    const codes = resolveCodesForCause(cause, causeToIcd, allCausesByLength);
    if (!codes) {
      causesWithoutCodes += 1;
      continue;
    }
    for (const code of codes) {
      // If a code maps to multiple causes, keep the max DW
      const existing = weights[code];
      if (existing === undefined || dw > existing) {
        weights[code] = dw;
        if (existing === undefined) codeCount += 1;
      }
    }
  }
  console.log(`  ${causesWithoutCodes} causes had no ICD codes (direct or inherited)`);
  console.log(`  Output: ${codeCount} unique ICD-10 codes mapped to DWs`);

  const output = {
    version: 1,
    source: "IHME GBD 2023 DIRF Appendix 1 Tables S9 + S13",
    sourceFile: "data/IHME_GBD_2023_DIRF_1990_2023_APPENDIX_1_TABLES_0.zip",
    generatedAt: new Date().toISOString(),
    aggregation: "max DW across sequelae per GBD cause",
    causeCount: causeToMaxDw.size,
    codeCount,
    unmatchedSequelaeCount: unmatchedCount,
    weights
  };

  await mkdir(dirname(OUTPUT_JSON), { recursive: true });
  await writeFile(OUTPUT_JSON, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_JSON}`);

  // Sample sanity-check
  const samples = ["E11", "E11.9", "I10", "I21.4", "N18.3", "J45.909", "F32.9"];
  console.log("\nSample lookups:");
  for (const code of samples) {
    console.log(`  ${code.padEnd(10)} → ${weights[code] ?? "(missing)"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
