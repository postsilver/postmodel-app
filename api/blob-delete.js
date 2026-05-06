import { del } from '@vercel/blob'
import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, userId } = req.body
  if (!url || !userId) return res.status(400).json({ error: 'Missing url or userId' })

  try {
    const sql = neon(process.env.DATABASE_URL)

    // Verify the user owns this blob before deleting
    const rows = await sql`SELECT id, size FROM blobs WHERE url = ${url} AND user_id = ${userId}`
    if (rows.length === 0) {
      // Already deleted or not tracked — silently succeed
      return res.status(200).json({ success: true })
    }

    try {
      await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN })
    } catch (e) {
      console.warn('[blob-delete] Vercel Blob delete failed:', e.message)
      // Still clean up DB record even if the storage delete fails
    }

    const size = Number(rows[0].size)
    if (size > 0) {
      await sql`UPDATE users SET storage_used = GREATEST(0, storage_used - ${size}) WHERE id = ${userId}`
    }
    await sql`DELETE FROM blobs WHERE url = ${url} AND user_id = ${userId}`

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('[blob-delete] error:', err)
    return res.status(500).json({ error: err.message })
  }
}
