import { put } from '@vercel/blob'

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const contentType = req.headers['content-type'] || 'application/octet-stream'
  const filename = req.headers['x-filename'] || `texture-${Date.now()}`

  try {
    const blob = await put(filename, req, {
      access: 'public',
      contentType,
      allowOverwrite: true,
    })
    return res.status(200).json({ url: blob.url })
  } catch (err) {
    console.error('Blob upload error:', err?.message ?? err)
    console.error('Blob upload error stack:', err?.stack)
    return res.status(500).json({ error: 'Upload failed', detail: err?.message })
  }
}
