// Metering configuration, read from Vite build-time env (statically inlined).
//
// With VITE_API_BASE_URL unset, METERING_ENABLED is false: the game makes ZERO
// network calls and plays exactly like the free offline build. This is what
// ships by default — the whole metering layer is dark until you point it at a
// deployed backend. (When you enable it, also add the API origin to the CSP
// `connect-src` — see SECURITY.md / the plan.)

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';
export const FREE_LIMIT_HINT = Number(import.meta.env.VITE_FREE_LIMIT ?? '100') || 100;
export const METERING_ENABLED = API_BASE_URL.length > 0;
