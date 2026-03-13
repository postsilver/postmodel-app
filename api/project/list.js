import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { userId } = req.body
    if (!userId) return res.status(401).json({ error: 'No userId' })

    const sql = neon(process.env.DATABASE_URL)
    const projects = await sql`
      SELECT id, name, created_at, updated_at
      FROM projects
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
    `

    return res.status(200).json({ projects })
  } catch (err) {
    console.error('project/list error:', err)
    return res.status(500).json({ error: err.message })
  }
}
