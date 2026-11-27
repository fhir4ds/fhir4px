import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "vite";
import { defineConfig, type Plugin } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Cross-origin isolation for DuckDB-WASM (threaded build needs
 * SharedArrayBuffer via COOP/COEP).
 *
 * Isolation only works document-tree-wide, so the headers apply to the app
 * itself, not just the engine iframe. COEP is CREDENTIALLESS: our
 * cross-origin fetches (HuggingFace terminology/associations) carry no
 * credentials, which credentialless permits without CORP — require-corp
 * would break them. Browsers without credentialless support (Safari)
 * simply stay unisolated; the engine client detects that via its ping and
 * the feature degrades to unavailable.
 */
function engineIsolationHeaders(): Plugin {
  const isolationHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless"
  };
  const middleware = () => (req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    const path = (req.url ?? "").split("?")[0];
    // HTML documents (SPA routes carry no extension) AND the engine's worker
    // script: a worker only joins the isolated agent cluster when its own
    // script response carries COOP/COEP.
    const isDocument = !/\.[a-z0-9]+$/i.test(path) || path.endsWith(".html");
    const isEngineAsset = path.startsWith("/vendor/fhir4ds/");
    if (isDocument || isEngineAsset) {
      for (const [key, value] of Object.entries(isolationHeaders)) {
        res.setHeader(key, value);
      }
    }
    next();
  };
  return {
    name: "fhir4px-engine-isolation",
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    }
  };
}

/**
 * Dev-only reverse proxy for the medterm4ds terminology server
 * (<base>/terminology-proxy/* -> Space). The Space's origin allow-list
 * gates browser Origin headers; server-side forwards carry none and pass
 * unfettered (rate-limited only). This is the interim workaround while the
 * Space's 10-origin image fails to deploy — the app points its terminology
 * base at the proxy in dev (VITE_TERMINOLOGY_SERVER_URL).
 */
function terminologyProxy(): Plugin {
  const upstream = "https://fhir4ds-terminology-demo-server.hf.space";
  const prefix = "/terminology-proxy/";
  return {
    name: "fhir4px-terminology-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(prefix)) {
          next();
          return;
        }
        const path = req.url.slice(prefix.length - 1);
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          void fetch(`${upstream}${path}`, {
            method: req.method,
            headers: {
              "Content-Type": req.headers["content-type"] ?? "application/fhir+json",
              Accept: req.headers.accept ?? "application/fhir+json"
              // No Origin header — server-side calls bypass the allow-list.
            },
            body: body
          })
            .then(async (upstreamResponse) => {
              res.statusCode = upstreamResponse.status;
              res.setHeader("Content-Type", upstreamResponse.headers.get("content-type") ?? "application/fhir+json");
              res.setHeader("Access-Control-Allow-Origin", "*");
              const retryAfter = upstreamResponse.headers.get("retry-after");
              if (retryAfter) res.setHeader("Retry-After", retryAfter);
              res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
            })
            .catch((error) => {
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ detail: `terminology proxy failed: ${String(error)}` }));
            });
        });
      });
    }
  };
}

const localhostCert =
  existsSync(".cert/localhost-key.pem") && existsSync(".cert/localhost-cert.pem")
    ? {
        key: readFileSync(".cert/localhost-key.pem"),
        cert: readFileSync(".cert/localhost-cert.pem")
      }
    : undefined;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publicEnv = {
    "import.meta.env.VITE_EPIC_CLIENT_ID": JSON.stringify(
      env.VITE_EPIC_CLIENT_ID || env.EPIC_NON_PROD_CLIENT_ID || ""
    ),
    "import.meta.env.VITE_CERNER_CLIENT_ID": JSON.stringify(env.VITE_CERNER_CLIENT_ID || env.CERNER_CLIENT_ID || ""),
    "import.meta.env.VITE_EPIC_SANDBOX_BASE_URL": JSON.stringify(
      env.VITE_EPIC_SANDBOX_BASE_URL || env.EPIC_SANDBOX_BASE_URL || ""
    ),
    "import.meta.env.VITE_EPIC_SANDBOX_REDIRECT_URI": JSON.stringify(env.VITE_EPIC_SANDBOX_REDIRECT_URI || ""),
    "import.meta.env.VITE_CERNER_SANDBOX_BASE_URL": JSON.stringify(
      env.VITE_CERNER_SANDBOX_BASE_URL || env.CERNER_SANDBOX_BASE_URL || ""
    )
  };

  return {
    define: publicEnv,
    server: {
      host: "localhost",
      port: 3000,
      strictPort: true,
      https: env.VITE_DEV_HTTPS === "true" ? localhostCert : undefined
    },
    optimizeDeps: {
      entries: ["index.html", "engine.html"]
    },
    build: {
      rollupOptions: {
        input: {
          main: "index.html",
          engine: "engine.html"
        },
        output: {
          manualChunks(id) {
            if (id.includes("@mlc-ai/web-llm")) return "webllm";
          }
        }
      }
    },
    plugins: [
      react(),
      engineIsolationHeaders(),
      terminologyProxy(),
      VitePWA({
        // A new version takes over as soon as it installs (this adds
        // skipWaiting and clientsClaim to the generated service worker). The
        // page then reloads itself once, to run the new version; the reload is
        // ours (src/lib/pwa/register-sw.ts), so it never lands on the SMART
        // callback page or in the middle of an export.
        registerType: "autoUpdate",
        injectRegister: null,
        strategies: "generateSW",
        manifest: {
          name: "fhir4px",
          short_name: "fhir4px",
          description: "Browser-only SMART on FHIR referral handoff",
          theme_color: "#0d1b2a",
          background_color: "#0d1b2a",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "/pwa.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any"
            }
          ]
        },
        workbox: {
          // Loaded before the generated worker's own routes: answers navigation
          // requests with the COOP/COEP headers a static host cannot send, so the
          // page and its engine iframe are cross-origin isolated in production.
          importScripts: ["/coi-headers.js"],
          cleanupOutdatedCaches: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
          // cicada.js (CDC immunization forecast, ~4.8 MB) exceeds Workbox's
          // 2 MiB precache limit; like the WebLLM bundles it is fetched on
          // first use rather than precached.
          globIgnores: ["**/assets/webllm-*.js", "**/vendor/cicada/**"],
          navigateFallback: "/index.html",
          runtimeCaching: [
            {
              urlPattern: ({ sameOrigin, url }) =>
                sameOrigin && url.pathname.startsWith("/directory-public/"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "fhir4px-public-directory",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60
                }
              }
            }
          ]
        }
      })
    ],
    test: {
      environment: "jsdom",
      setupFiles: "./vitest.setup.ts",
      globals: true,
      restoreMocks: true,
      exclude: ["node_modules", "dist", "tests/e2e/**"]
    }
  };
});
