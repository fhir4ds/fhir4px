import type { FhirResource } from "../smart/data";
import type { NormalizedObservationValue } from "./observation-values";

export interface DisplayMedication {
  id: string;
  label: string;
  status: string;
  codingKeys?: string[];
  codeSummary?: DisplayCodeSummary;
  ingredients?: string[];
  dosageForm?: string;
  route?: string;
  groupingText?: string;
  source: "provider" | "patient";
  authoredAt?: string;
  note?: string;
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface DisplayAllergy {
  id: string;
  label: string;
  clinicalStatus?: string;
  criticality?: string;
  codingKeys?: string[];
  codeSummary?: DisplayCodeSummary;
  authoredAt?: string;
  source: "provider" | "patient";
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface DisplayCondition {
  id: string;
  label: string;
  clinicalStatus?: string;
  codingKeys?: string[];
  codeSummary?: DisplayCodeSummary;
  source: "provider" | "patient";
  authoredAt?: string;
  note?: string;
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface DisplayObservation {
  id: string;
  label: string;
  value: string;
  normalizedValue: NormalizedObservationValue;
  status: string;
  category?: string;
  categoryCode?: string;
  codingKeys?: string[];
  codeSummary?: DisplayCodeSummary;
  effectiveDate?: string;
  interpretation?: string;
  abnormal?: boolean;
  referenceRange?: ExtractedReferenceRange;
  source: "provider" | "patient";
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface ExtractedReferenceRange {
  low?: number;
  high?: number;
  unit?: string;
  ucumCode?: string;
  text?: string;
}

export interface DisplayImmunization {
  id: string;
  label: string;
  codes?: string[];
  codeSummary?: DisplayCodeSummary;
  status?: string;
  occurrenceDate?: string;
  source: "provider" | "patient";
  authoredAt?: string;
  note?: string;
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface DisplayEncounter {
  id: string;
  label: string;
  status?: string;
  classLabel?: string;
  codeSummary?: DisplayCodeSummary;
  reasonSummary?: DisplayCodeSummary;
  codingKeys?: string[];
  periodStart?: string;
  periodEnd?: string;
  serviceProvider?: string;
  source: "provider" | "patient";
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface DisplayProcedure {
  id: string;
  label: string;
  status?: string;
  category?: string;
  codeSummary?: DisplayCodeSummary;
  reasonSummary?: DisplayCodeSummary;
  codingKeys?: string[];
  performedDate?: string;
  source: "provider" | "patient";
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface DisplayDiagnosticReport {
  id: string;
  label: string;
  status?: string;
  category?: string;
  codeSummary?: DisplayCodeSummary;
  codingKeys?: string[];
  effectiveDate?: string;
  issued?: string;
  resultCount?: number;
  conclusion?: string;
  source: "provider" | "patient";
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface DisplayDocument {
  id: string;
  label: string;
  status?: string;
  /** Document type (type coding text, e.g. "Summary of episode note"). */
  docType?: string;
  category?: string;
  categoryCode?: string;
  codeSummary?: DisplayCodeSummary;
  codingKeys?: string[];
  docDate?: string;
  custodian?: string;
  /** Format of the first content element (format.display or contentType). */
  format?: string;
  /** First content attachment — metadata only; fetched on explicit selection. */
  attachmentUrl?: string;
  attachmentTitle?: string;
  attachmentSize?: number;
  attachmentContentType?: string;
  source: "provider" | "patient";
  portalSourceId?: string;
  portalSourceName?: string;
}

export interface DisplayCodingSummary {
  code?: string;
  display?: string;
}

export interface DisplayCodeSummary {
  text?: string;
  codings?: DisplayCodingSummary[];
}

export interface ReferralSummary {
  patient: FhirResource | null;
  medications: DisplayMedication[];
  allergies: DisplayAllergy[];
  conditions: DisplayCondition[];
  observations: DisplayObservation[];
  immunizations: DisplayImmunization[];
  encounters: DisplayEncounter[];
  procedures: DisplayProcedure[];
  diagnosticReports: DisplayDiagnosticReport[];
  documents: DisplayDocument[];
  generatedAt: string;
}
