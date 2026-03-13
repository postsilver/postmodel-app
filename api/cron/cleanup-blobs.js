import { neon } from '@neondatabase/serverless'
import { del } from '@vercel/blob'

export default async function handler(req, res) {
  const auth = req.headers['authorization']
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const sql = neon(process.env.DATABASE_URL)

  const expired = await sql`
    SELECT id, url, size, user_id FROM blobs WHERE expires_at < NOW()
  `

  let deleted = 0
  for (const blob of expired) {
    try {
      await del(blob.url, { token: process.env.BLOB_READ_WRITE_TOKEN })
    } catch (e) {
      console.warn('Failed to delete blob from storage:', blob.url, e.message)
    }

    await sql`
      UPDATE users SET storage_used = GREATEST(0, storage_used - ${Number(blob.size)}) WHERE id = ${blob.user_id}
    `
    await sql`DELETE FROM blobs WHERE id = ${blob.id}`
    deleted++
  }

  return res.status(200).json({ deleted })
}
