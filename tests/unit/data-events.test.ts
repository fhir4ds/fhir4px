import { describe, expect, it, vi } from "vitest";
import { LOCAL_DATA_CHANGED_EVENT, notifyLocalDataChanged } from "../../src/lib/app/data-events";

describe("notifyLocalDataChanged", () => {
  it("tells the mounted pages that the vault changed", () => {
    const listener = vi.fn();
    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, listener);

    notifyLocalDataChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(LOCAL_DATA_CHANGED_EVENT, listener);
  });
});
