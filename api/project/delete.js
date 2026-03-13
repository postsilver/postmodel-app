import { neon } from '@neondatabase/serverless'
import { del } from '@vercel/blob'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { userId, projectId } = req.body
    if (!userId || !projectId) return res.status(400).json({ error: 'Missing required fields' })

    const sql = neon(process.env.DATABASE_URL)

    // Get blobs belonging to this project
    const blobs = await sql`
      SELECT url, size FROM blobs WHERE project_id = ${projectId} AND user_id = ${userId}
    `

    // Delete each blob from Vercel Blob storage
    for (const blob of blobs) {
      try {
        await del(blob.url, { token: process.env.BLOB_READ_WRITE_TOKEN })
      } catch (e) {
        console.warn('Failed to delete blob:', blob.url, e.message)
      }
    }

    // Subtract total freed storage from user quota
    const totalSize = blobs.reduce((sum, b) => sum + Number(b.size), 0)
    if (totalSize > 0) {
      await sql`
        UPDATE users SET storage_used = GREATEST(0, storage_used - ${totalSize}) WHERE id = ${userId}
      `
    }

    // Delete blob records
    await sql`DELETE FROM blobs WHERE project_id = ${projectId} AND user_id = ${userId}`

    // Delete the project
    const rows = await sql`
      DELETE FROM projects WHERE id = ${projectId} AND user_id = ${userId} RETURNING id
    `
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('project/delete error:', err)
    return res.status(500).json({ error: err.message })
  }
}
