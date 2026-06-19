/**
 * UCUM unit conversion wrapper around @lhncbc/ucum-lhc.
 *
 * The browser bundle (browser-dist/ucum-lhc.min.js, ~290KB / ~80KB gzip) is a
 * self-contained UMD build that includes the UCUM definitions table inline.
 * We import it dynamically so it doesn't block initial app load — the first
 * call pays the import + table-init cost (~50–100ms), subsequent calls reuse
 * the cached singleton.
 *
 * Cross-dimension conversions (e.g., mg/dL ↔ mmol/L) require a molecular
 * weight, which the caller must supply. See reference-ranges.ts for the
 * per-lab molecular weights we use for chemistry conversions.
 */

interface UcumConvertResult {
  status: "succeeded" | "failed" | "error";
  toVal: number | null;
  msg: string[];
}

interface UcumLhcUtils {
  convertUnitTo(
    fromUnitCode: string,
    fromVal: number,
    toUnitCode: string,
    options?: { suggest?: boolean; molecularWeight?: number | null; charge?: number | null }
  ): UcumConvertResult;
}

interface UcumBundle {
  UcumLhcUtils: { getInstance(): UcumLhcUtils };
}

let utilsPromise: Promise<UcumLhcUtils> | null = null;

function loadUtils(): Promise<UcumLhcUtils> {
  if (utilsPromise) return utilsPromise;
  utilsPromise = (async () => {
    const mod = (await import("@lhncbc/ucum-lhc/browser-dist/ucum-lhc.min.js")) as
      | { default?: UcumBundle } & UcumBundle;
    const bundle = mod.default ?? mod;
    return bundle.UcumLhcUtils.getInstance();
  })();
  return utilsPromise;
}

export interface ConvertUnitOptions {
  molecularWeight?: number;
  charge?: number;
}

/**
 * Convert a numeric value from one UCUM unit to another. Returns null if the
 * units are not commensurable or the conversion fails — callers should treat
 * null as "hide the range / don't compare."
 *
 * For same-dimension conversions (e.g., mg/dL → g/L), no options are needed.
 * For mass↔amount-of-substance conversions (e.g., mg/dL → mmol/L), pass the
 * substance's molecular weight in g/mol.
 */
export async function convertUnit(
  value: number,
  fromUnit: string,
  toUnit: string,
  options: ConvertUnitOptions = {}
): Promise<number | null> {
  if (!fromUnit || !toUnit) return null;
  if (fromUnit === toUnit) return value;
  const utils = await loadUtils();
  const result = utils.convertUnitTo(fromUnit, value, toUnit, {
    molecularWeight: options.molecularWeight ?? null,
    charge: options.charge ?? null
  });
  if (result.status === "succeeded" && typeof result.toVal === "number" && Number.isFinite(result.toVal)) {
    return result.toVal;
  }
  return null;
}

/**
 * Pre-warm the UCUM singleton. Call during idle time to avoid latency on
 * first reference-range resolution.
 */
export async function preloadUcum(): Promise<void> {
  await loadUtils();
}
