import { neon } from '@neondatabase/serverless'
import { getAuth } from '@clerk/backend'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId } = getAuth(req)
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  const { email } = req.body || {}

  const sql = neon(process.env.DATABASE_URL)
  await sql`
    INSERT INTO users (id, email)
    VALUES (${userId}, ${email || ''})
    ON CONFLICT (id) DO NOTHING
  `
  return res.status(200).json({ ok: true })
}
