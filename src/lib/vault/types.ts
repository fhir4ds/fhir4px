export type VaultRecordType =
  | "smart-token"
  | "smart-session"
  | "smart-source"
  | "source-dataset"
  | "grouping-cache"
  | "classification-cache"
  | "relationship-cache"
  | "patient-patch"
  | "patient-authored-record"
  | "referral-draft"
  | "handoff-state";

export interface EncryptedEnvelope {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  aad?: string;
}

export interface VaultItem {
  id: string;
  type: VaultRecordType;
  envelope: EncryptedEnvelope;
  createdAt: number;
  updatedAt: number;
}

export interface VaultRecordRef {
  type: VaultRecordType;
  id: string;
}
