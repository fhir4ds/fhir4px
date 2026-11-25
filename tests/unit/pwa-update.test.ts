import { describe, expect, it } from "vitest";
import { appUpdateHeld, holdAppUpdate } from "../../src/lib/pwa/update-hold";
import { updateReloadAllowed } from "../../src/lib/pwa/update-reload";

describe("holdAppUpdate", () => {
  it("holds the update until the job releases it", () => {
    expect(appUpdateHeld()).toBe(false);
    const release = holdAppUpdate();
    expect(appUpdateHeld()).toBe(true);
    release();
    expect(appUpdateHeld()).toBe(false);
  });

  it("keeps the update waiting while one of several jobs still runs", () => {
    const first = holdAppUpdate();
    const second = holdAppUpdate();
    first();
    expect(appUpdateHeld()).toBe(true);
    second();
    expect(appUpdateHeld()).toBe(false);
  });

  it("does not go negative when a hold is released twice", () => {
    const release = holdAppUpdate();
    release();
    release();
    expect(appUpdateHeld()).toBe(false);
  });
});

describe("updateReloadAllowed", () => {
  const allowed = { hadController: true, smartCallback: false, held: false };

  it("reloads a returning page when the new version has taken over", () => {
    expect(updateReloadAllowed(allowed)).toBe(true);
  });

  it("does not reload the visit that installed the worker", () => {
    expect(updateReloadAllowed({ ...allowed, hadController: false })).toBe(false);
  });

  it("does not reload the SMART callback page", () => {
    expect(updateReloadAllowed({ ...allowed, smartCallback: true })).toBe(false);
  });

  it("waits for a running job", () => {
    expect(updateReloadAllowed({ ...allowed, held: true })).toBe(false);
  });
});
