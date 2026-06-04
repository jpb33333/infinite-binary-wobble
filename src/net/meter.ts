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

  /** Fetch current status on boot. Best-effort; failure leaves metering inert. */
  async init(): Promise<void> {
    if (!METERING_ENABLED) return;
    try {
      await this.ensureSession();
      await this.refresh();
    } catch {
      /* fail open */
    }
  }

  /** A play has begun — optimistic, fire-and-forget; never blocks the loop. */
  consumePlay(): void {
    if (!METERING_ENABLED || this.unlocked) return;
    void this.post('/v1/play/increment')
      .then(r => r && this.apply(r))
      .catch(() => {});
  }

  async refresh(): Promise<void> {
    if (!METERING_ENABLED) return;
    const r = await this.get('/v1/status').catch(() => null);
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

  private async get(path: string): Promise<GateResponse | null> {
    const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
    return res.ok ? ((await res.json()) as GateResponse) : null;
  }

  private async post(path: string): Promise<GateResponse | null> {
    const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', credentials: 'include' });
    return res.ok ? ((await res.json()) as GateResponse) : null;
  }
}
