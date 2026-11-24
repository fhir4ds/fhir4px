/**
 * Which view the Quality area shows — its two second-level navigation
 * items. The app-frame navigation sets it and the Quality page reads it, so
 * it lives outside the page (which stays mounted while you are elsewhere).
 * Care gaps opens by default: it is what you want to see first.
 */

export type QualityView = "care-gaps" | "measures";

const listeners = new Set<() => void>();
let view: QualityView = "care-gaps";

export function getQualityView(): QualityView {
  return view;
}

export function setQualityView(next: QualityView): void {
  if (next === view) return;
  view = next;
  for (const listener of listeners) listener();
}

export function subscribeQualityView(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
