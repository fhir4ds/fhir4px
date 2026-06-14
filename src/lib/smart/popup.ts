import { SMART_AUTH_CHANNEL } from "./transient-state";

export const SMART_AUTH_POPUP_EVENT = "fhir4px:smart-auth-complete";

export interface SmartAuthPopupMessage {
  type: "fhir4px.smartAuth.complete" | "fhir4px.smartAuth.error";
  sourceId?: string;
  error?: string;
}

export function isSmartAuthPopupMessage(value: unknown): value is SmartAuthPopupMessage {
  const candidate = value as SmartAuthPopupMessage | undefined;
  return candidate?.type === "fhir4px.smartAuth.complete" || candidate?.type === "fhir4px.smartAuth.error";
}

export function publishSmartAuthPopupMessage(message: SmartAuthPopupMessage): void {
  if (typeof window === "undefined") return;

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(SMART_AUTH_CHANNEL);
    channel.postMessage(message);
    channel.close();
  }

  window.opener?.postMessage(message, window.location.origin);
}

export function dispatchSmartAuthPopupEvent(message: SmartAuthPopupMessage): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SMART_AUTH_POPUP_EVENT, { detail: message }));
}
