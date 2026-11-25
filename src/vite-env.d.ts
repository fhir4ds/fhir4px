/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_WEBLLM_ENABLE_FALLBACK_MODELS?: string;
  readonly VITE_WEBLLM_USE_CUSTOM_MODEL?: string;
  /** "1" in a prebuilt build: use SQL translated at build time (see .env.prebuilt). */
  readonly VITE_PREBUILT_SQL?: string;
}
