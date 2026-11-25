import { Redis } from '@upstash/redis'
import { nanoid } from 'nanoid'

// Vercel rejects request bodies over 4.5 MB before this runs (413); Upstash's free
// plan rejects single requests over 10 MB. Stay well under both and say so clearly.
const MAX_SCENE_BYTES = 4 * 1024 * 1024
const TTL_SECONDS = 259200 // 72h

// Created on first use so a missing env var produces a clear error response
// instead of failing at import time.
let redis = null
function getRedis() {
  if (redis) return redis
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: message, code, ...extra })
}

// Turn an Upstash/Redis error into a reason that is safe to show the user.
// The full error is always logged server-side.
function describeStorageError(err) {
  const msg = String(err?.message || err || '')
  if (/max request size/i.test(msg)) return { code: 'scene_too_large', message: 'Scene is too large for the share storage.' }
  if (/max (daily|monthly)? ?request(s)? limit|limit exceeded|quota/i.test(msg)) return { code: 'storage_quota', message: 'Share storage has hit its usage limit. Try again later.' }
  if (/unauthori[sz]ed|WRONGPASS|invalid token|401|403/i.test(msg)) return { code: 'storage_auth', message: 'Share storage rejected the server credentials.' }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(msg)) return { code: 'storage_unreachable', message: 'Could not reach share storage.' }
  return { code: 'storage_failed', message: 'Could not store the scene.' }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return fail(res, 405, 'method_not_allowed', 'Method not allowed')
  }

  // Body is normally parsed JSON; accept a raw string too (e.g. missing Content-Type)
  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return fail(res, 400, 'invalid_json', 'Request body is not valid JSON.') }
  }
  const scene = body?.scene
  if (!scene || typeof scene !== 'string') {
    return fail(res, 400, 'missing_scene', 'Missing scene data.')
  }

  const bytes = new TextEncoder().encode(scene).length
  if (bytes > MAX_SCENE_BYTES) {
    console.warn(`[share] scene too large: ${bytes} bytes`)
    return fail(res, 413, 'scene_too_large',
      `Scene is too large to share (${(bytes / 1048576).toFixed(1)} MB, limit ${MAX_SCENE_BYTES / 1048576} MB).`,
      { bytes, limit: MAX_SCENE_BYTES })
  }

  try { JSON.parse(scene) } catch {
    return fail(res, 400, 'invalid_scene', 'Scene data is not valid JSON.')
  }

  const client = getRedis()
  if (!client) {
    console.error('[share] KV_REST_API_URL / KV_REST_API_TOKEN not set in this environment')
    return fail(res, 500, 'config_missing', 'Sharing is not configured on the server (storage credentials missing).')
  }

  try {
    const id = nanoid(8)
    await client.set(`scene:${id}`, scene, { ex: TTL_SECONDS })
    return res.status(200).json({ id })
  } catch (err) {
    const reason = describeStorageError(err)
    console.error(`[share] redis.set failed (${reason.code}, ${bytes} bytes):`, err)
    return fail(res, reason.code === 'scene_too_large' ? 413 : 502, reason.code, reason.message, { bytes })
  }
}
