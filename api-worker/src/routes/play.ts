import type { Env } from '../env.ts';
import { json, jsonError } from '../middleware.ts';
import { evaluateGate } from '../lib/gate.ts';
import { incrementPlay, readPlayCount, isEntitled } from '../lib/counter.ts';
import { authenticate } from './auth.ts';

export async function handleHealth(): Promise<Response> {
  return json({ ok: true });
}

export async function handleStatus(req: Request, env: Env): Promise<Response> {
  const auth = await authenticate(req, env);
  if (!auth) return jsonError(401, 'unauthenticated');
  const [count, entitled] = await Promise.all([
    readPlayCount(env, auth.deviceId),
    isEntitled(env, auth.deviceId),
  ]);
  return json(evaluateGate({ playCount: count, freeLimit: freeLimit(env), entitled }));
}

export async function handleIncrement(req: Request, env: Env): Promise<Response> {
  const auth = await authenticate(req, env);
  if (!auth) return jsonError(401, 'unauthenticated');

  // Entitled (paid) devices never touch the counter.
  if (await isEntitled(env, auth.deviceId)) {
    const count = await readPlayCount(env, auth.deviceId);
    return json(evaluateGate({ playCount: count, freeLimit: freeLimit(env), entitled: true }));
  }
  const count = await incrementPlay(env, auth.deviceId);
  return json(evaluateGate({ playCount: count, freeLimit: freeLimit(env), entitled: false }));
}

function freeLimit(env: Env): number {
  const n = Number(env.FREE_PLAY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 100;
}
