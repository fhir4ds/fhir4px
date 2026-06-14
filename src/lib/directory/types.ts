import type { SmartProvider } from "../smart/types";

export interface DirectoryEndpointOption {
  accessBrand: string;
  fhirBaseUrl: string;
  confidence: number;
  matchMethod: string;
  evidence: string;
  rawAccessBrand?: string;
  brandFamily?: string;
  patientDisplayPolicy?: "top_recommendation" | "alternative_option" | string;
  patientDisplayPriority?: number;
  recommendationTier?: "high_confidence_confirm" | "recommended_confirm" | "possible_confirm" | string;
  recommendationScore?: number;
  empiricalPrecisionAt1?: number;
  empiricalRecallAt3?: number;
  empiricalTop3CorrectOrPlausible?: number;
  evidencePathClass?: string;
  pathSummary?: string;
  qaFocus?: string;
  candidateRank?: number;
  candidateSetSize?: number;
}

export interface DirectorySearchRecord {
  npi: string;
  displayName: string;
  directoryStatus?: "endpoint_matched" | "provider_only" | string;
  providerType: "individual" | "organization";
  specialty: string;
  specialtyTerms: string;
  zip5: string;
  state: string;
  practiceLine1?: string;
  practiceCity?: string;
  practiceState?: string;
  practiceZip5?: string;
  practiceOrganizationNames?: string;
  lat: number | null;
  lon: number | null;
  endpointOptions: DirectoryEndpointOption[];
}

export interface DirectoryOrigin {
  lat: number;
  lon: number;
}

export type DirectorySort = "name" | "distance";

export interface DirectoryProvider extends SmartProvider {
  endpointStatus: "sandbox" | "candidate" | "verified" | "stale" | "provider_only";
  directoryStatus?: "endpoint_matched" | "provider_only" | string;
  location?: string;
  npi?: string;
  providerType?: "individual" | "organization";
  specialty?: string;
  accessBrand?: string;
  rawAccessBrand?: string;
  brandFamily?: string;
  practiceOrganizationNames?: string;
  confidence?: number;
  matchMethod?: string;
  evidence?: string;
  patientDisplayPolicy?: string;
  patientDisplayPriority?: number;
  recommendationTier?: string;
  recommendationScore?: number;
  empiricalPrecisionAt1?: number;
  empiricalRecallAt3?: number;
  empiricalTop3CorrectOrPlausible?: number;
  evidencePathClass?: string;
  pathSummary?: string;
  qaFocus?: string;
  candidateRank?: number;
  candidateSetSize?: number;
  distanceMiles?: number | null;
}
