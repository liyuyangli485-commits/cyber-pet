const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-sonnet-4-5';

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    model: DEFAULT_MODEL,
    timestamp: new Date().toISOString()
  });
}
