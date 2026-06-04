import type { Env } from './env.ts';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function jsonError(status: number, code: string, message?: string): Response {
  return json(message ? { error: code, message } : { error: code }, status);
}

/** Placeholder for the verification routes that need secrets/SDKs to implement. */
export function notImplemented(what: string): Response {
  return jsonError(501, 'not_implemented', `${what} — see the route source for the exact steps`);
}

/** CORS headers — echo the single allowlisted web origin only, never '*'. */
function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (origin && origin === env.WEB_ORIGIN) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Attest-Key-Id, X-Attest-Assertion',
      Vary: 'Origin',
    };
  }
  return {};
}

export function preflight(req: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req, env) });
}

export function withCors(res: Response, req: Request, env: Env): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req, env))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
