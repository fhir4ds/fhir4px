function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return error ? String(error) : "unknown fetch error";
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the configured endpoint";
  }
}

export function contextualizeFetchFailure(error: unknown, action: string, url: string): Error {
  const message = errorMessage(error);
  return new Error(
    `${action} failed before an HTTP response from ${hostFromUrl(url)}. Browser reported "${message}". ` +
      "Check the endpoint URL, CORS policy, network reachability, and TLS certificate."
  );
}

export async function fetchWithContext(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  action: string
): Promise<Response> {
  try {
    return await fetcher(url, init);
  } catch (error) {
    throw contextualizeFetchFailure(error, action, url);
  }
}
