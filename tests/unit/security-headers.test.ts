import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production security headers", () => {
  it("ships a CSP that avoids eval and allows only public HTTPS connections", () => {
    const headers = readFileSync("public/_headers", "utf-8");

    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("default-src 'self'");
    expect(headers).toContain("script-src 'self'");
    expect(headers).toContain("connect-src 'self' https:");
    expect(headers).not.toContain("'unsafe-eval'");
    expect(headers).not.toContain("connect-src *");
  });

  it("sets browser privacy and content-sniffing headers", () => {
    const headers = readFileSync("public/_headers", "utf-8");

    expect(headers).toContain("Referrer-Policy: no-referrer");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Permissions-Policy:");
  });
});
