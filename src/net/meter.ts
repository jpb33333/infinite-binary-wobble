import { API_BASE_URL, METERING_ENABLED, TURNSTILE_SITE_KEY, FREE_LIMIT_HINT } from './config.ts';
import { getTurnstileToken } from './turnstile.ts';

// Read-only view the Renderer paints from.
export interface MeterView {
  enabled: boolean;
  remaining: number | null; // null = unlimited / not yet known
  unlocked: boolean;
  limit: number;
}

// Matches the Worker's GateResult (api-worker/src/lib/gate.ts).
interface GateResponse {
  plays: number;
  remaining: number | null;
  locked: boolean;
  entitled: boolean;
}

/**
 * Client-side metering. The server is the source of truth; this only caches the
 * last answer for synchronous gate decisions and is **fail-open**: disabled, or
 * any network/error, leaves the game fully playable. Only a positive
 * server "locked" (and not entitled) ever shows the paywall.
 */
export class Meter {
  private remaining: number | null = null;
  private unlocked = false;
  private locked = false;
  private sessionReady = false;

  get view(): MeterView {
    return {
      enabled: METERING_ENABLED,
      remaining: this.remaining,
      unlocked: this.unlocked,
      limit: FREE_LIMIT_HINT,
    };
  }

  /** Block a new play only when we positively know the device is out + unpaid. */
  shouldGate(): boolean {
    return METERING_ENABLED && this.locked && !this.unlocked;
  }

  /**
   * Sync status on boot — refresh-FIRST. An existing HttpOnly session cookie
   * answers /v1/status directly; Turnstile + /v1/web/session run only when the
   * server says 401 (no or expired session). So the widget appears once per
   * device, not on every page load — and an existing device's play count and
   * entitlement survive reloads. Best-effort; failure leaves metering inert.
   */
  async init(): Promise<void> {
    if (!METERING_ENABLED) return;
    try {
      const r = await this.fetchGate('/v1/status');
      if (r === 'unauthenticated') {
        await this.ensureSession();
        if (this.sessionReady) await this.refresh();
      } else if (r) {
        this.apply(r);
      }
    } catch {
      /* fail open */
    }
  }

  /** A play has begun — optimistic, fire-and-forget; never blocks the loop. */
  consumePlay(): void {
    if (!METERING_ENABLED || this.unlocked) return;
    void this.fetchGate('/v1/play/increment', { method: 'POST' })
      .then(r => {
        if (r && r !== 'unauthenticated') this.apply(r);
      })
      .catch(() => {});
  }

  async refresh(): Promise<void> {
    if (!METERING_ENABLED) return;
    const r = await this.fetchGate('/v1/status');
    if (r === 'unauthenticated') {
      // Session died (30-day cookie expired mid-visit). Un-latch the gate:
      // without this, a player parked on the paywall when the cookie lapses
      // is stuck there — a fail-closed corner in a fail-open design. The next
      // boot mints a fresh device anyway (expiry IS the meter-reset cadence).
      this.locked = false;
      return;
    }
    if (r) this.apply(r);
  }

  /** Redirect to Stripe hosted Checkout (pay-what-you-want). */
  async startCheckout(): Promise<boolean> {
    if (!METERING_ENABLED) return false;
    try {
      await this.ensureSession();
      const res = await fetch(`${API_BASE_URL}/v1/stripe/checkout`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return true;
      }
    } catch {
      /* ignore — caller stays on the paywall */
    }
    return false;
  }

  private apply(r: GateResponse): void {
    this.remaining = r.remaining;
    this.unlocked = r.entitled;
    this.locked = r.locked && !r.entitled;
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionReady) return;
    const token = await getTurnstileToken(TURNSTILE_SITE_KEY);
    if (!token) return; // no token → no session; metering stays inert
    const res = await fetch(`${API_BASE_URL}/v1/web/session`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token }),
    });
    if (res.ok) this.sessionReady = true;
  }

  /**
   * Call a metering endpoint. Distinguishes 401 ('unauthenticated' — the
   * mint-a-session signal) from every other failure (null — fail open).
   * Never rejects: network errors and malformed bodies all resolve to null.
   */
  private async fetchGate(
    path: string,
    init: RequestInit = {},
  ): Promise<GateResponse | 'unauthenticated' | null> {
    const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', ...init }).catch(
      () => null,
    );
    if (!res) return null;
    if (res.status === 401) return 'unauthenticated';
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as GateResponse | null;
  }
}
