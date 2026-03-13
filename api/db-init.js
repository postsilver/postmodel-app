import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL)

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      storage_used BIGINT DEFAULT 0,
      tier TEXT DEFAULT 'free',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      scene_json JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      project_id TEXT REFERENCES projects(id),
      url TEXT NOT NULL,
      filename TEXT NOT NULL,
      size BIGINT DEFAULT 0,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `

  await sql`ALTER TABLE blobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`

  return res.status(200).json({ ok: true })
}
