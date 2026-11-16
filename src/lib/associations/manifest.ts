/**
 * Root manifest resolver for the associations artifacts hosted on
 * HuggingFace at fhir4ds/associations. The repo is organized in
 * versioned directories (graph/<release>/, crosswalks/<release>/,
 * naming/<release>/) and manifest.json at the root pins the current
 * release, so every artifact URL resolves through the manifest first.
 */

const REPO_BASE = "https://huggingface.co/fhir4ds/associations/resolve/main";

export interface AssociationsManifest {
  release: string;
  bundle_version: string;
  format: string;
}

let releasePromise: Promise<string> | null = null;

export function resolveRelease(): Promise<string> {
  if (releasePromise) return releasePromise;
  releasePromise = fetch(`${REPO_BASE}/manifest.json`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Associations manifest unavailable: ${response.status}`);
      }
      return response.json() as Promise<AssociationsManifest>;
    })
    .then((manifest) => {
      if (typeof manifest.release !== "string" || !manifest.release) {
        throw new Error("Associations manifest is missing a release");
      }
      return manifest.release;
    })
    .catch((error) => {
      releasePromise = null;
      throw error;
    });
  return releasePromise;
}

export function associationsArtifactUrl(
  kind: "graph" | "crosswalks" | "naming",
  release: string,
  file: string
): string {
  return `${REPO_BASE}/${kind}/${release}/${file}`;
}
