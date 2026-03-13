import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { userId, blobUrl, filename, fileSize } = req.body
    if (!userId || !blobUrl) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const sql = neon(process.env.DATABASE_URL)
    const id = crypto.randomUUID()

    await sql`
      INSERT INTO blobs (id, user_id, url, filename, size, expires_at)
      VALUES (${id}, ${userId}, ${blobUrl}, ${filename}, ${fileSize ?? 0}, NOW() + INTERVAL '80 hours')
    `

    const rows = await sql`
      UPDATE users SET storage_used = storage_used + ${fileSize ?? 0}
      WHERE id = ${userId}
      RETURNING storage_used
    `

    const newStorageUsed = rows[0] ? Number(rows[0].storage_used) : null
    return res.status(200).json({ success: true, newStorageUsed })
  } catch (err) {
    console.error('upload-complete error:', err)
    return res.status(500).json({ error: err.message })
  }
}
