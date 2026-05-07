import { neon } from '@neondatabase/serverless'
import { del } from '@vercel/blob'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { urls, userId } = req.body || {}
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(200).json({ deleted: 0 })
  }

  const sql = neon(process.env.DATABASE_URL)
  let deleted = 0

  for (const url of urls) {
    if (!url || typeof url !== 'string' || !url.startsWith('https://')) continue
    try {
      // Only delete blobs that have not been linked to a saved project
      const rows = await sql`SELECT id, size, project_id FROM blobs WHERE url = ${url}`
      if (rows.length === 0) continue
      const blob = rows[0]
      if (blob.project_id) continue // Saved to a project — leave it alone

      try {
        await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN })
      } catch (e) {
        console.warn('[cleanup-session] del failed:', url, e.message)
      }

      await sql`DELETE FROM blobs WHERE id = ${blob.id}`

      if (userId && Number(blob.size) > 0) {
        await sql`
          UPDATE users SET storage_used = GREATEST(0, storage_used - ${Number(blob.size)})
          WHERE id = ${userId}
        `
      }
      deleted++
    } catch (e) {
      console.error('[cleanup-session] error for url', url, e)
    }
  }

  return res.status(200).json({ deleted })
}
