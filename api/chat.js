const DEFAULT_MODEL = 'deepseek-chat';
const BASE_URL = 'https://api.deepseek.com/v1';

// Fish Audio TTS（高擬真語音合成）
const FISH_AUDIO_URL = 'https://api.fish.audio/v1/tts';
const FISH_AUDIO_VOICE_ID = '931fad22448d4bd4a6052e84e788f9a1'; // 神里綾華音色（最熱門，3030+ 創作者使用）

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

// Fish Audio TTS 语音合成（高擬真質量）
async function callFishAudioTTS(text) {
  try {
    // 硬編碼 Fish Audio API Key 和神里綾華音色 ID
    const FISH_AUDIO_API_KEY = '3c5352b30bab411ab7882991f102a8fb';
    const AYAKA_VOICE_ID = '931fad22448d4bd4a6052e84e788f9a1';

    console.log('[Fish Audio] 開始 TTS 合成', {
      textLength: text.length,
      voiceId: AYAKA_VOICE_ID,
      apiKey: FISH_AUDIO_API_KEY.substring(0, 8) + '...'
    });

    const resp = await fetch(FISH_AUDIO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FISH_AUDIO_API_KEY}`
      },
      body: JSON.stringify({
        text: text,
        voice_id: AYAKA_VOICE_ID,
        model: 's2.1-pro',
        format: 'mp3'
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[Fish Audio] TTS 失敗:', resp.status, errText);
      // 不降級，直接返回 null
      return null;
    }

    // 獲取音頻 ArrayBuffer
    const audioBuffer = await resp.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString('base64');

    console.log('[Fish Audio] TTS 成功', {
      audioSize: base64.length,
      format: 'audio/mpeg'
    });

    return {
      audio: base64,
      audioFormat: 'audio/mpeg'
    };
  } catch (err) {
    console.error('[Fish Audio] TTS 異常:', err);
    // 不降級，直接返回 null
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
    temperature = 0.7
  } = req.body || {};

  console.log('[Request Received]', { messageCount: messages.length, hasSystem: !!system });

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

    // 2. 調用 Fish Audio TTS 生成高擬真語音（硬編碼綾華音色）
    const ttsResult = await callFishAudioTTS(reply);

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
