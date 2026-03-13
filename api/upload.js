import { handleUpload } from '@vercel/blob/client'

export const config = { api: { bodyParser: true } }

export default async function handler(req, res) {
  try {
    const body = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: [],
        tokenPayload: pathname,
      }),
      onUploadCompleted: async () => {},
    })
    return res.json(body)
  } catch (err) {
    console.error('Upload token error:', err?.message ?? err)
    return res.status(500).json({ error: 'Token generation failed', detail: err?.message })
  }
}
