// Usage 端點 - 返回 API 使用情況統計
export default function handler(req, res) {
  // 這裡可以實現實際的 usage 追蹤邏輯
  // 目前返回基本的 usage 信息
  res.status(200).json({
    ok: true,
    usage: {
      total_requests: 0,
      total_tokens: 0,
      model: process.env.DEFAULT_MODEL || 'claude-sonnet-4-5'
    },
    message: 'Usage tracking endpoint'
  });
}
