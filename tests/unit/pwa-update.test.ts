import { describe, expect, it } from "vitest";
import { appUpdateHeld, holdAppUpdate } from "../../src/lib/pwa/update-hold";
import { needsIsolationReload, updateReloadAllowed } from "../../src/lib/pwa/update-reload";

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

describe("needsIsolationReload", () => {
  const visit = { hadController: false, isolated: false, smartCallback: false, alreadyReloaded: false };

  it("reloads the visit that installed the worker, once, so the page gets isolation headers", () => {
    expect(needsIsolationReload(visit)).toBe(true);
  });

  it("does nothing when the page is already isolated", () => {
    expect(needsIsolationReload({ ...visit, isolated: true })).toBe(false);
  });

  it("does nothing on the SMART callback page", () => {
    expect(needsIsolationReload({ ...visit, smartCallback: true })).toBe(false);
  });

  it("reloads at most once per tab", () => {
    expect(needsIsolationReload({ ...visit, alreadyReloaded: true })).toBe(false);
  });

  it("does nothing on a visit that already had a controller", () => {
    expect(needsIsolationReload({ ...visit, hadController: true })).toBe(false);
  });
});
