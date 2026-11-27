/*
 * Cross-origin isolation on a host that cannot set headers.
 *
 * The analysis engine needs SharedArrayBuffer (DuckDB-WASM), which a browser
 * exposes only to a cross-origin isolated document. The dev server sends COOP
 * and COEP headers; GitHub Pages cannot. This worker — imported by the
 * generated service worker — answers navigation requests with those headers,
 * so the app document and the /engine.html iframe it hosts are isolated in
 * production too.
 *
 * COEP stays "credentialless", as in development: the public terminology and
 * model fetches are cross-origin and carry no credentials, so they keep
 * working; browsers without credentialless support simply stay unisolated and
 * the engine reports itself unavailable.
 */

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless"
};

function withIsolation(response) {
  if (!response || !response.body) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function shellResponse() {
  // Workbox stores precached files under "?__WB_REVISION__=…", so the search
  // has to ignore the query or the shell is never found.
  const fromScope = new URL("index.html", self.registration.scope).href;
  return (
    (await caches.match(fromScope, { ignoreSearch: true })) ||
    (await caches.match("/index.html", { ignoreSearch: true })) ||
    null
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isDocument = request.mode === "navigate";
  // A worker script of an isolated page needs the same headers, even from the
  // same origin: the engine's DuckDB worker is otherwise refused with
  // ERR_BLOCKED_BY_RESPONSE. The dev server does the same for /vendor/fhir4ds/.
  const isEngineWorker = sameOrigin && (request.destination === "worker" || url.pathname.startsWith("/vendor/fhir4ds/"));
  if (!isDocument && !isEngineWorker) return;

  event.respondWith(
    (async () => {
      let response = null;
      try {
        response = await fetch(request);
      } catch {
        response = null;
      }
      if (isDocument) {
        // Offline, or the host answered an SPA route with its 404 page: serve
        // the cached shell, as the navigation fallback would have.
        if (!response || response.status === 404) {
          const shell = await shellResponse();
          if (shell) response = shell;
        }
      } else if (!response) {
        response = await caches.match(request, { ignoreSearch: true });
      }
      return withIsolation(response);
    })()
  );
});
