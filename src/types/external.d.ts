declare module "@lhncbc/ucum-lhc/browser-dist/ucum-lhc.min.js" {
  export interface UcumLhcUtils {
    convertUnitTo(
      fromUnitCode: string,
      fromVal: number,
      toUnitCode: string,
      options?: { suggest?: boolean; molecularWeight?: number | null; charge?: number | null }
    ): { status: string; toVal: number | null; msg: string[] };
  }
  export interface UcumBundle {
    UcumLhcUtils: { getInstance(): UcumLhcUtils };
  }
  const bundle: UcumBundle;
  export default bundle;
}
