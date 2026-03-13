import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const { userId, email } = req.body
    if (!userId) return res.status(401).json({ error: 'No userId' })

    const sql = neon(process.env.DATABASE_URL)
    await sql`
      INSERT INTO users (id, email)
      VALUES (${userId}, ${email})
      ON CONFLICT (id) DO NOTHING
    `
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('ensure-user error:', err)
    return res.status(500).json({ error: err.message })
  }
}
