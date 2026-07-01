import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const DEFAULT_MODEL = 'deepseek-chat';
const BASE_URL = 'https://api.deepseek.com/v1';

// 驗證 API Key
if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.includes('在这里')) {
  if (!process.env.VERCEL) {
    console.error('\n❌ 未检测到 DEEPSEEK_API_KEY。请：');
    console.error('   1) 把 .env.example 复制一份并改名为 .env');
    console.error('   2) 在 .env 里把 DEEPSEEK_API_KEY 填成你的 DeepSeek 密钥（sk-...）');
    console.error('   3) 重新运行 npm start\n');
    process.exit(1);
  } else {
    console.warn('⚠️ Vercel 環境：DEEPSEEK_API_KEY 未設置，API 調用將失敗');
  }
}

// 构造发往 DeepSeek 官方 API 的请求（OpenAI 兼容格式）
async function callDeepSeek({ model, max_tokens, temperature, system, messages }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.includes('在这里')) {
    const err = new Error('DEEPSEEK_API_KEY 未設置');
    err.status = 500;
    throw err;
  }

  const body = { model, max_tokens, temperature, messages };
  if (system) {
    body.messages = [{ role: 'system', content: system }, ...messages];
  }

  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (!resp.ok) {
      const err = new Error(`DeepSeek 返回非 JSON：${text.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }
    throw new Error('无法解析 DeepSeek 响应');
  }

  if (!resp.ok) {
    const err = new Error(data?.error?.message || data?.message || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.error = data?.error || { type: data?.type || 'api_error' };
    throw err;
  }

  return data;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
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
    const resp = await callDeepSeek({
      model,
      max_tokens,
      temperature,
      system: system || undefined,
      messages
    });

    let reply = resp.choices?.[0]?.message?.content || '';
    reply = reply.trim();

    // ====== 尾部杂音清洗 ======
    const trailingPatterns = [
      /(?:还有什么(?:我)?(?:可以|能|需要)(?:帮助|帮到|协助)(?:你|您|的)(?:吗|嘛|呢|？|\?))[\s]*[！!。.]*\s*$/g,
      /(?:希望这(?:对)?你(?:有)?(?:所)?帮助[！!。.]*\s*)$/g,
      /(?:希望(?:对)?你(?:有)?(?:所)?帮助[！!。.]*\s*)$/g,
      /(?:如果你?(?:还)?(?:有|有其它|有其他)(?:任何)?(?:问题|疑问)(?:，|,)?(?:请|欢迎|尽管)(?:随时)?(?:告诉|问|联系)(?:我|我们)?)[！!。.]*\s*$/g,
      /(?:如果你?(?:还)?(?:有|有其它|有其他)(?:任何)?(?:需要|需求)(?:，|,)?(?:请|欢迎|尽管)(?:随时)?(?:告诉|联系)(?:我|我们)?)[！!。.]*\s*$/g,
      /(?:Is there anything else (?:I can )?(?:help (?:you )?with|assist (?:you )?with)\?*\s*)$/gi,
      /(?:Hope this helps[!.]*\s*)$/gi,
      /(?:Let me know if (?:you )?(?:have|need) (?:any )?(?:questions?|help|assistance)[!.]*\s*)$/gi,
      /(?:Feel free (?:to )?(?:ask|reach out|contact)[!.]*\s*)$/gi,
      /([。！？.!?])\1{2,}$/g,
      /\n{3,}$/g,
    ];
    for (const pat of trailingPatterns) {
      reply = reply.replace(pat, '');
    }
    reply = reply.trimEnd();

    res.json({
      reply,
      model: resp.model,
      stop_reason: resp.choices?.[0]?.finish_reason,
      usage: resp.usage
    });
  } catch (err) {
    console.error('[DeepSeek Error]', err);
    const status = err.status || 500;
    const body = {
      error: err.message || '调用失败',
      type: err.error?.type || err.name,
      status
    };
    if (status === 401) body.hint = 'API Key 无效。请检查 .env 中的 DEEPSEEK_API_KEY。';
    if (status === 404) body.hint = '模型不存在。请检查 DEFAULT_MODEL。';
    if (status === 429) body.hint = '触发限流或额度不足，请稍后重试。';
    res.status(status).json(body);
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: DEFAULT_MODEL, provider: 'DeepSeek' });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✅ Nova 后端已启动`);
    console.log(`   本地访问:  http://localhost:${PORT}/chatbot.html`);
    console.log(`   健康检查:  http://localhost:${PORT}/api/health`);
    console.log(`   当前模型:  ${DEFAULT_MODEL}`);
    console.log(`   API 提供商: DeepSeek 官方\n`);
  });
}

export default app;
