import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { userId, projectId } = req.body
    if (!userId || !projectId) return res.status(400).json({ error: 'Missing required fields' })

    const sql = neon(process.env.DATABASE_URL)
    const rows = await sql`
      SELECT scene_json, name FROM projects WHERE id = ${projectId} AND user_id = ${userId}
    `
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })

    return res.status(200).json({ sceneJson: rows[0].scene_json, name: rows[0].name })
  } catch (err) {
    console.error('project/load error:', err)
    return res.status(500).json({ error: err.message })
  }
}
