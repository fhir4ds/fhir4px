import QRCode from "qrcode";
import type { ReferralSummary } from "../fhir/types";

const SCANNER_SAFE_QR_BYTES = 1800;

export interface QrSummaryEnvelope {
  kind: "fhir4px.qr-summary";
  version: 1;
  createdAt: string;
  summary: ReferralSummary;
}

export function createQrSummaryEnvelope(summary: ReferralSummary): QrSummaryEnvelope {
  return {
    kind: "fhir4px.qr-summary",
    version: 1,
    createdAt: new Date().toISOString(),
    summary
  };
}

export function estimateUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function isScannerSafeQrPayload(value: unknown, maxBytes = SCANNER_SAFE_QR_BYTES): boolean {
  return estimateUtf8Bytes(value) <= maxBytes;
}

export async function qrSummaryToDataUrl(envelope: QrSummaryEnvelope): Promise<string> {
  if (!isScannerSafeQrPayload(envelope)) {
    throw new Error("QR summary payload is too large; use local encrypted Bundle instead");
  }
  return QRCode.toDataURL(JSON.stringify(envelope), {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 384
  });
}
