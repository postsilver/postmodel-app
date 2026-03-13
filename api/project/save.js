import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { userId, projectId, name, sceneJson } = req.body
    if (!userId || !name || !sceneJson) return res.status(400).json({ error: 'Missing required fields' })

    const sql = neon(process.env.DATABASE_URL)
    let returnedId

    if (projectId) {
      const rows = await sql`
        UPDATE projects
        SET scene_json = ${sceneJson}::jsonb, name = ${name}, updated_at = NOW()
        WHERE id = ${projectId} AND user_id = ${userId}
        RETURNING id
      `
      if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })
      returnedId = rows[0].id
    } else {
      const id = crypto.randomUUID()
      await sql`
        INSERT INTO projects (id, user_id, name, scene_json, created_at, updated_at)
        VALUES (${id}, ${userId}, ${name}, ${sceneJson}::jsonb, NOW(), NOW())
      `
      returnedId = id
    }

    // Link any orphaned blobs uploaded by this user to this project
    await sql`
      UPDATE blobs SET project_id = ${returnedId}
      WHERE user_id = ${userId} AND project_id IS NULL
    `

    // Clear expiry for all blobs in this project (saved = keep forever)
    await sql`
      UPDATE blobs SET expires_at = NULL
      WHERE project_id = ${returnedId} AND user_id = ${userId}
    `

    return res.status(200).json({ projectId: returnedId })
  } catch (err) {
    console.error('project/save error:', err)
    return res.status(500).json({ error: err.message })
  }
}
