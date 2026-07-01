const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-sonnet-4-5';
const BASE_URL = process.env.AICODEMIRROR_BASE_URL || 'https://api.aicodemirror.com/api/claudecode';

// 构造发往 AICodeMirror 中转网关的请求
async function callAICodeMirror({ model, max_tokens, temperature, system, messages }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('在这里')) {
    const err = new Error('ANTHROPIC_API_KEY 未設置');
    err.status = 500;
    throw err;
  }

  const body = { model, max_tokens, temperature, messages };
  if (system) body.system = system;

  const resp = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'ANTHROPIC_AUTH_TOKEN': apiKey,
      'ANTHROPIC_API_KEY': apiKey
    },
    body: JSON.stringify(body)
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (!resp.ok) {
      const err = new Error(`AICodeMirror 返回非 JSON：${text.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }
    throw new Error('无法解析 AICodeMirror 响应');
  }

  if (!resp.ok) {
    const err = new Error(data?.error?.message || data?.message || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.error = data?.error || { type: data?.type || 'api_error' };
    throw err;
  }

  return data;
}

export default async function handler(req, res) {
  // 只允許 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    messages = [],
    system = '',
    model = DEFAULT_MODEL,
    max_tokens = 1024,
    temperature = 0.7
  } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 不能为空' });
  }

  try {
    const resp = await callAICodeMirror({
      model,
      max_tokens,
      temperature,
      system: system || undefined,
      messages
    });

    let reply = (resp.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    // 尾部雜音清洗
    const trailingPatterns = [
      /(?:还有什么(?:我)?(?:可以|能|需要)(?:帮助|帮到|协助)(?:你|您|的)(?:吗|嘛|呢|？|\?))[\s]*[！!。.]*\s*$/g,
      /(?:希望这(?:对)?你(?:有)?(?:所)?帮助[！!。.]*\s*)$/g,
      /(?:希望(?:对)?你(?:有)?(?:所)?帮助[！!。.]*\s*)$/g,
      /(?:如果你?(?:还)?(?:有|有其它|有其他)(?:任何)?(?:问题|疑问)(?:，|,)?(?:请|欢迎|尽管)(?:随时)?(?:告诉|问|联系)(?:我|我们)?)[！!。.]*\s*$/g,
      /(?:如果你?(?:还)?(?:有|有其它|有其他)(?:任何)?(?:需要|需求)(?:，|,)?(?:请|欢迎|尽管)(?:随时)?(?:告诉|联系)(?:我|我们)?)[！!。.]*\s*$/g,
      /(?:Is there anything else (?:I can )?(?:help (?:you )?with|assist (?:you )?with)\?*\s*)$/gi,
      /(?:Hope this helps[!!.]*\s*)$/gi,
      /(?:Let me know if (?:you )?(?:have|need) (?:any )?(?:questions?|help|assistance)[!!.]*\s*)$/gi,
      /(?:Feel free (?:to )?(?:ask|reach out|contact)[!!.]*\s*)$/gi,
      /([。！？.!?])\1{2,}$/g,
      /\n{3,}$/g,
    ];
    for (const pat of trailingPatterns) {
      reply = reply.replace(pat, '');
    }
    reply = reply.trimEnd();

    res.status(200).json({
      reply,
      model: resp.model,
      stop_reason: resp.stop_reason,
      usage: resp.usage
    });
  } catch (err) {
    console.error('[AICodeMirror Error]', err);
    const status = err.status || 500;
    const body = {
      error: err.message || '调用失败',
      type: err.error?.type || err.name,
      status
    };
    if (status === 401) body.hint = '中转密钥无效。请检查 Vercel 环境变量中的 ANTHROPIC_API_KEY 是否为 AICodeMirror 发放的密钥。';
    if (status === 404) body.hint = '模型名不存在。请检查 DEFAULT_MODEL。';
    if (status === 429) body.hint = '触发限流或额度不足，请稍后重试。';
    res.status(status).json(body);
  }
}
