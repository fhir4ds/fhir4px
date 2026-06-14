const SENSITIVE_PATH_PARTS = [
  "/Patient/",
  "/Observation",
  "/Condition",
  "/MedicationRequest",
  "/MedicationStatement",
  "/AllergyIntolerance",
  "/DiagnosticReport",
  "/DocumentReference",
  "/Encounter",
  "/Procedure",
  "/Immunization",
  "/oauth",
  "/token",
  "/authorize",
  "/smart/callback"
];

export function isPublicDirectoryUrl(url: URL): boolean {
  return url.origin === selfOrigin() && url.pathname.startsWith("/directory-public/");
}

export function shouldBypassServiceWorkerCache(input: string | URL): boolean {
  const url = typeof input === "string" ? new URL(input, selfOrigin()) : input;
  if (url.searchParams.has("code") || url.searchParams.has("state")) return true;
  if (url.pathname === "/metadata" || url.pathname.endsWith("/metadata")) return true;
  if (url.pathname.endsWith("/.well-known/smart-configuration")) return true;
  return SENSITIVE_PATH_PARTS.some((part) => url.pathname.includes(part));
}

function selfOrigin(): string {
  if (typeof self !== "undefined" && "location" in self) return self.location.origin;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost";
}
