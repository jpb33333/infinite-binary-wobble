import type { Env } from './env.ts';
import { withCors, preflight, jsonError } from './middleware.ts';
import { handleHealth, handleStatus, handleIncrement } from './routes/play.ts';
import { handleWebSession, handleStripeCheckout, handleStripeWebhook } from './routes/web.ts';
import { handleAttestRegister, handleIapVerify, handleAppleNotifications } from './routes/ios.ts';

type Handler = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

// Exact method+path routing. Webhooks (Stripe/Apple) carry no Origin, so CORS
// simply adds nothing to their responses — server-to-server is unaffected.
const routes: Record<string, Handler> = {
  'GET /health': handleHealth,
  'GET /v1/status': handleStatus,
  'POST /v1/play/increment': handleIncrement,
  'POST /v1/web/session': handleWebSession,
  'POST /v1/stripe/checkout': handleStripeCheckout,
  'POST /v1/stripe/webhook': handleStripeWebhook,
  'POST /v1/attest/register': handleAttestRegister,
  'POST /v1/iap/verify': handleIapVerify,
  'POST /v1/apple/notifications': handleAppleNotifications,
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') return preflight(req, env);

    const url = new URL(req.url);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return withCors(jsonError(404, 'not_found'), req, env);

    try {
      return withCors(await handler(req, env, ctx), req, env);
    } catch (err) {
      console.error(`${req.method} ${url.pathname}`, err);
      return withCors(jsonError(500, 'internal_error'), req, env);
    }
  },
} satisfies ExportedHandler<Env>;
