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
      VitePWA({
        registerType: "prompt",
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
          cleanupOutdatedCaches: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
          globIgnores: ["**/assets/webllm-*.js"],
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
