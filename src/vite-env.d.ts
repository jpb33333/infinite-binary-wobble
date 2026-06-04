/// <reference types="vite/client" />

// Build-time config for the (optional) metering backend. All optional: with
// none set, metering is OFF and the game behaves exactly as the offline build.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_FREE_LIMIT?: string;
}
