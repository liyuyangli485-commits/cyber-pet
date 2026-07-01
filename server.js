import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-sonnet-4-5';

if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('在这里')) {
  console.error('\n❌ 未检测到 ANTHROPIC_API_KEY。请：');
  console.error('   1) 把 .env.example 复制一份并改名为 .env');
  console.error('   2) 在 .env 里把 ANTHROPIC_API_KEY 填成你真实的 sk-ant-... 密钥');
  console.error('   3) 重新运行 npm start\n');
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const app = express();
app.use(express.json({ limit: '1mb' }));
// 前端静态资源（chatbot.html 等）由后端同源提供 —— 这样浏览器和后端是同一个 origin，没有任何 CORS 问题
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
    const resp = await client.messages.create({
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

    // ====== 尾部杂音清洗 ======
    // 1. 去除常见尾部套话（中英文）
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
      // 2. 去除末尾多余的标点堆叠
      /([。！？.!?])\1{2,}$/g,   // "。。。" → "。", "！！！" → "！"
      // 3. 去除末尾连续的多个空行（保留最多一个换行）
      /\n{3,}$/g,
    ];
    for (const pat of trailingPatterns) {
      reply = reply.replace(pat, '');
    }
    reply = reply.trimEnd();
    // ====== 尾部杂音清洗 END ======

    res.json({
      reply,
      model: resp.model,
      stop_reason: resp.stop_reason,
      usage: resp.usage
    });
  } catch (err) {
    console.error('[Anthropic Error]', err);
    const status = err.status || 500;
    const body = {
      error: err.message || '调用失败',
      type: err.error?.type || err.name,
      status
    };
    if (status === 401) body.hint = '密钥无效。请检查 .env 中的 ANTHROPIC_API_KEY 是否正确（应以 sk-ant- 开头，无多余空格）。';
    if (status === 404) body.hint = '模型名不存在。请检查 DEFAULT_MODEL 或前端传入的 model。';
    if (status === 429) body.hint = '触发限流或额度不足，请稍后重试或检查账户余额。';
    res.status(status).json(body);
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: DEFAULT_MODEL });
});

app.listen(PORT, () => {
  console.log(`\n✅ Nova 后端已启动`);
  console.log(`   本地访问:  http://localhost:${PORT}/chatbot.html`);
  console.log(`   健康检查:  http://localhost:${PORT}/api/health`);
  console.log(`   当前模型:  ${DEFAULT_MODEL}\n`);
});
