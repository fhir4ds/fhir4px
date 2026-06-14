import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerSW: vi.fn()
}));

vi.mock("virtual:pwa-register", () => ({
  registerSW: mocks.registerSW
}));

describe("service worker registration", () => {
  it("does not clear browser caches in development", async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    const keys = vi.fn().mockResolvedValue(["webllm-model-cache"]);
    const deleteCache = vi.fn().mockResolvedValue(true);

    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations }
    });
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: { keys, delete: deleteCache }
    });

    const { registerServiceWorker } = await import("../../src/lib/pwa/register-sw");

    registerServiceWorker();
    await Promise.resolve();
    await Promise.resolve();

    expect(getRegistrations).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(keys).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(mocks.registerSW).not.toHaveBeenCalled();
  });
});
