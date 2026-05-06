import { neon } from '@neondatabase/serverless'
import { del } from '@vercel/blob'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, userId, blobUrl, url, filename, fileSize } = req.body

  try {
    const sql = neon(process.env.DATABASE_URL)

    // ── DELETE action ─────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (!url || !userId) return res.status(400).json({ error: 'Missing url or userId' })

      const rows = await sql`SELECT id, size FROM blobs WHERE url = ${url} AND user_id = ${userId}`
      if (rows.length === 0) return res.status(200).json({ success: true })

      try {
        await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN })
      } catch (e) {
        console.warn('[upload-complete/delete] Blob delete failed:', e.message)
      }

      const size = Number(rows[0].size)
      if (size > 0) {
        await sql`UPDATE users SET storage_used = GREATEST(0, storage_used - ${size}) WHERE id = ${userId}`
      }
      await sql`DELETE FROM blobs WHERE url = ${url} AND user_id = ${userId}`
      return res.status(200).json({ success: true })
    }

    // ── COMPLETE action (default) ─────────────────────────────────────────────
    if (!blobUrl) return res.status(400).json({ error: 'Missing blobUrl' })

    const id = crypto.randomUUID()

    if (userId) {
      await sql`
        INSERT INTO blobs (id, user_id, url, filename, size, expires_at)
        VALUES (${id}, ${userId}, ${blobUrl}, ${filename ?? ''}, ${fileSize ?? 0}, NOW() + INTERVAL '80 hours')
      `
      const rows = await sql`
        UPDATE users SET storage_used = storage_used + ${fileSize ?? 0}
        WHERE id = ${userId}
        RETURNING storage_used
      `
      return res.status(200).json({ success: true, newStorageUsed: rows[0] ? Number(rows[0].storage_used) : null })
    } else {
      // Guest: 72h auto-expiry, no quota tracking
      await sql`
        INSERT INTO blobs (id, user_id, url, filename, size, expires_at)
        VALUES (${id}, NULL, ${blobUrl}, ${filename ?? ''}, ${fileSize ?? 0}, NOW() + INTERVAL '72 hours')
      `
      return res.status(200).json({ success: true, newStorageUsed: null })
    }
  } catch (err) {
    console.error('[upload-complete] error:', err)
    return res.status(500).json({ error: err.message })
  }
}
