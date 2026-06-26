/// <reference types="vite/client" />

// Build-time config for the (optional) metering backend + analytics. All
// optional: with none set, metering and analytics are OFF and the game behaves
// exactly as the offline build.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_FREE_LIMIT?: string;
  // GA4 Measurement ID (G-XXXXXXXXXX). Unset → analytics layer stays inert.
  readonly VITE_GA_MEASUREMENT_ID?: string;
}
