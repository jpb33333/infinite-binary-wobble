import type { Env } from '../env.ts';

/**
 * Free-plan play counter, stored in D1. The `UPDATE ... SET n = n + 1` is atomic
 * at the row level, so concurrent increments can't lose updates; `RETURNING`
 * gives the new value in one round trip.
 *
 * Upgrade path (optional, Workers Paid): a Durable Object `PlayCounter` serializes
 * per device and removes even rare write-contention — see wrangler.toml. The
 * route code calls these helpers, so swapping the implementation is local.
 */
interface CountRow {
  play_count: number;
}

export async function incrementPlay(env: Env, deviceId: string): Promise<number> {
  const row = await env.DB.prepare(
    `UPDATE devices SET play_count = play_count + 1, last_seen = ?2
     WHERE device_id = ?1
     RETURNING play_count`,
  )
    .bind(deviceId, Date.now())
    .first<CountRow>();
  if (!row) throw new Error('unknown_device');
  return row.play_count;
}

export async function readPlayCount(env: Env, deviceId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT play_count FROM devices WHERE device_id = ?1`)
    .bind(deviceId)
    .first<CountRow>();
  return row?.play_count ?? 0;
}

export async function isEntitled(env: Env, deviceId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT status FROM entitlements WHERE device_id = ?1`)
    .bind(deviceId)
    .first<{ status: string }>();
  return row?.status === 'unlocked';
}
