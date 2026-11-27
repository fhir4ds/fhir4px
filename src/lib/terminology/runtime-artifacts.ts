/**
 * The terminology artifacts hosted on HuggingFace are an enrichment: the app
 * ships its own patient-friendly shards and names records from them. Waiting
 * for the enrichment is only acceptable while the network answers quickly —
 * grouping asks for it while naming records, so a slow or blocked HuggingFace
 * used to leave the page on "Applying patient-friendly terminology lookup"
 * for minutes.
 *
 * One deadline per attempt, and one switch for the rest of the session: after
 * a timeout or a failure every later request is skipped instead of retried,
 * which would add the same wait to each shard.
 */

export const RUNTIME_ARTIFACT_TIMEOUT_MS = 6000;

let unavailable = false;

export function runtimeArtifactsUnavailable(): boolean {
  return unavailable;
}

/** Called after a timeout or failure: shard naming stands for this session. */
export function markRuntimeArtifactsUnavailable(): void {
  unavailable = true;
}

export function withArtifactDeadline<T>(promise: Promise<T>, timeoutMs = RUNTIME_ARTIFACT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Runtime terminology artifact timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}
