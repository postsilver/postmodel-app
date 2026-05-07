export const config = {
  api: {
    bodyParser: false,
  },
};

import { handleUpload } from '@vercel/blob/client';
import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';
import { TIER_LIMITS } from '../src/config/tiers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Direct server-side upload for textures (bypasses token flow)
  if (req.url?.includes('action=texture')) {
    try {
      const contentType = req.headers['content-type'] || 'application/octet-stream';
      const rawName = req.headers['x-filename'];
      const filename = rawName ? decodeURIComponent(rawName) : `texture-${Date.now()}`;
      const fileSize = parseInt(req.headers['content-length'] || '0', 10);
      const userId = req.headers['x-user-id'] || null;

      if (userId && fileSize > 0) {
        const sql = neon(process.env.DATABASE_URL);
        const rows = await sql`SELECT storage_used, tier FROM users WHERE id = ${userId}`;
        const user = rows[0];
        if (user) {
          const limit = TIER_LIMITS[user.tier] ?? TIER_LIMITS.free;
          if (Number(user.storage_used) + fileSize > limit) {
            return res.status(403).json({
              error: 'storage_limit_exceeded',
              used: Number(user.storage_used),
              limit,
            });
          }
        }
      }

      const blob = await put(filename, req, {
        access: 'public',
        contentType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: true,
      });
      return res.status(200).json({ url: blob.url });
    } catch (err) {
      console.error('[upload/texture] error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  let quotaError = null;

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });

    const response = await handleUpload({
      body,
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let parsed = {};
        try { parsed = JSON.parse(clientPayload || '{}'); } catch {}
        const { userId, fileSize } = parsed;

        if (userId && fileSize) {
          const sql = neon(process.env.DATABASE_URL);
          const rows = await sql`SELECT storage_used, tier FROM users WHERE id = ${userId}`;
          const user = rows[0];
          if (user) {
            const limit = TIER_LIMITS[user.tier] ?? TIER_LIMITS.free;
            if (Number(user.storage_used) + fileSize > limit) {
              quotaError = { used: Number(user.storage_used), limit };
              throw new Error('storage_limit_exceeded');
            }
          }
        }

        return {
          allowedContentTypes: [
            'model/gltf-binary',
            'model/gltf+json',
            'model/obj',
            'model/stl',
            'application/octet-stream',
            'application/x-tgif',
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
            'image/bmp',
            'image/tiff',
            '',
          ],
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
          allowOverwrite: false,
          tokenPayload: clientPayload || '',
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Upload complete:', blob.url);
      },
    });

    return res.status(200).json(response);
  } catch (err) {
    if (quotaError) {
      return res.status(403).json({
        error: 'storage_limit_exceeded',
        used: quotaError.used,
        limit: quotaError.limit,
      });
    }
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
