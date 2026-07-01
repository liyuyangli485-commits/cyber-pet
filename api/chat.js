const DEFAULT_MODEL = 'deepseek-chat';
const BASE_URL = 'https://api.deepseek.com/v1';

// Edge TTS 配置
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'; // 曉曉 - 高質量中文女聲

// 构造发往 DeepSeek 官方 API 的请求
async function callDeepSeek({ model, max_tokens, temperature, system, messages }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.includes('在这里')) {
    const err = new Error('DEEPSEEK_API_KEY 未設置');
    err.status = 500;
    throw err;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    const err = new Error('messages 数组为空或格式无效');
    err.status = 400;
    throw err;
  }

  const body = { model, max_tokens, temperature, messages: [] };

  if (system && system.trim()) {
    body.messages.push({ role: 'system', content: system });
  }

  body.messages.push(...messages);

  console.log('[DeepSeek Request]', JSON.stringify({ model, messageCount: body.messages.length }));

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

// Edge TTS 语音合成（完全免费，无需 API Key）
async function callEdgeTTS(text, voice) {
  try {
    console.log('[Edge TTS] 開始 TTS 合成', { textLength: text.length, voice });

    // 動態導入 edge-tts（避免 Vercel 構建時問題）
    const { EdgeTTS } = await import('edge-tts');
    const tts = new EdgeTTS();

    // 生成音頻（返回 ArrayBuffer）
    const audioBuffer = await tts.tts(text, voice || DEFAULT_VOICE);

    // 轉換為 base64
    const base64 = Buffer.from(audioBuffer).toString('base64');

    console.log('[Edge TTS] TTS 成功', { audioSize: base64.length });
    return {
      audio: base64,
      audioFormat: 'audio/mpeg' // Edge TTS 返回 MP3 格式
    };
  } catch (err) {
    console.error('[Edge TTS] TTS 異常:', err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    messages = [],
    system = '',
    model = DEFAULT_MODEL,
    max_tokens = 1024,
    temperature = 0.7,
    voice
  } = req.body || {};

  console.log('[Request Received]', { messageCount: messages.length, hasSystem: !!system, voice });

  if (!Array.isArray(messages) || messages.length === 0) {
    console.error('[Validation Failed] messages is empty or not an array');
    return res.status(400).json({ error: 'messages 不能为空', received: messages });
  }

  try {
    // 1. 調用 DeepSeek 獲取文字回應
    const resp = await callDeepSeek({
      model,
      max_tokens,
      temperature,
      system: system || undefined,
      messages
    });

    let reply = resp.choices?.[0]?.message?.content || '';
    reply = reply.trim();

    // 尾部雜音清洗
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

    // 2. 調用 Edge TTS 生成語音（完全免費）
    const ttsResult = await callEdgeTTS(reply, voice);

    // 3. 返回文字 + 音頻
    res.status(200).json({
      reply,
      model: resp.model || model,
      stop_reason: resp.choices?.[0]?.finish_reason || 'stop',
      usage: resp.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      ...(ttsResult && {
        audio: ttsResult.audio,
        audioFormat: ttsResult.audioFormat
      })
    });
  } catch (err) {
    console.error('[DeepSeek Error]', err);
    const status = err.status || 500;
    const body = {
      error: err.message || '调用失败',
      type: err.error?.type || err.name,
      status
    };
    if (status === 401) body.hint = 'API Key 无效。请检查 Vercel 环境变量中的 DEEPSEEK_API_KEY。';
    if (status === 404) body.hint = '模型不存在。请检查 DEFAULT_MODEL。';
    if (status === 429) body.hint = '触发限流或额度不足，请稍后重试。';
    res.status(status).json(body);
  }
}
