import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

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
      entries: ["index.html"]
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("@mlc-ai/web-llm")) return "webllm";
          }
        }
      }
    },
    plugins: [
      react(),
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
