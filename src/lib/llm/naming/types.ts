import type { GroupableRecord, PatientObservationBucket } from "../../fhir/patient-groups";

export interface NamingResult {
  id: string;
  patientFriendlyName: string;
  observationBucket?: PatientObservationBucket;
  confidence: number;
  fallback: boolean;
}

export type NamingMode = "batch" | "single";

export interface NamingOptions {
  timeoutMs?: number;
  onProgress?: (message: string) => void;
  onDiagnostic?: (diagnostic: NamingDiagnostic) => void;
  namingBatchSize?: number;
  namingMode?: NamingMode;
  initialAvailableNames?: string[];
}

export interface NamingDiagnostic {
  phase: string;
  message: string;
  modelId?: string;
  affectedRecordIds?: string[];
  affectedCount?: number;
  fallbackScope?: "single-concept" | "batch" | "resource-type";
  recovered?: boolean;
}

export interface NamingIncrementalUpdate {
  result: unknown;
  completedRecords: GroupableRecord[];
  pendingRecords: GroupableRecord[];
  completedCount: number;
  totalCount: number;
  batchIndex: number;
  batchCount: number;
}

export type NamingWarmupPhase = "idle" | "loading" | "ready" | "failed" | "skipped";

export interface NamingWarmupStatus {
  phase: NamingWarmupPhase;
  message?: string;
  modelId?: string;
  updatedAt: number;
}
