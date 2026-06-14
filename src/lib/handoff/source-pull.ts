import type { SmartSessionInfo } from "../smart/types";

export interface SourcePullInstruction {
  kind: "fhir4px.source-pull";
  version: 1;
  fhirBaseUrl: string;
  vendor: SmartSessionInfo["vendor"];
  createdAt: string;
  note: string;
}

export function createSourcePullInstruction(session: SmartSessionInfo): SourcePullInstruction {
  return {
    kind: "fhir4px.source-pull",
    version: 1,
    fhirBaseUrl: session.fhirBaseUrl,
    vendor: session.vendor,
    createdAt: new Date().toISOString(),
    note: "Patient-mediated source access. No fhir4px server hosts this payload."
  };
}
