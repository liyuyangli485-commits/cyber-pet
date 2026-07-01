# Nova Bot —— 本地后端 + 前端 UI

前端只跟本地后端通信，密钥仅保存在后端 `.env`，浏览器不再持有任何 Key。

## 一、目录结构

```
nova-bot/
├─ server.js          # Express 后端：转发到 Anthropic
├─ package.json
├─ .env.example       # ← 复制成 .env 后填入你的真实密钥
├─ .env               # ← 你需要手动创建，不会被 git 提交
└─ public/
   └─ chatbot.html    # 前端 UI（自动由后端同源提供）
```

## 二、快速启动（3 步）

```bash
# 1. 进入目录
cd C:\Users\25310\nova-bot

# 2. 安装依赖
npm install

# 3. 配置密钥：把 .env.example 复制为 .env，并在其中填入你的 sk-ant-... 密钥
copy .env.example .env
# 然后用记事本打开 .env，把 ANTHROPIC_API_KEY 那一行替换成真实密钥

# 4. 启动
npm start
```

启动成功后访问： **http://localhost:3000/chatbot.html**

## 三、关于 401 Unauthorized

401 = Anthropic 服务器拒绝你的密钥。在本架构下，密钥**唯一**的填写位置是：

```
C:\Users\25310\nova-bot\.env   →   ANTHROPIC_API_KEY=sk-ant-...
```

排查清单：
1. `.env` 文件是否真的叫 `.env`（不是 `.env.txt`，不是 `.env.example`）
2. 密钥行**没有引号、没有空格**：`ANTHROPIC_API_KEY=sk-ant-xxxxx`
3. 密钥确实以 `sk-ant-` 开头，且未被吊销（之前明文贴出过的那两把强烈建议去 console.anthropic.com 立即吊销）
4. 改完 `.env` 必须 **重启 `npm start`**（dotenv 只在启动时读一次）
5. 终端会打印 `[Anthropic Error]`，看具体 `type`：`authentication_error` = 密钥；`not_found_error` = 模型名；`overloaded_error` = 官方过载

## 四、为什么这样更安全

- **密钥不暴露在浏览器**：用户按 F12 看 Network 看到的只是 `/api/chat`，不会看到你的 sk-ant-。
- **没有 CORS 问题**：前端和后端是同一个 origin (`http://localhost:3000`)，浏览器不会发起预检拦截。
- **失败时返回中文 hint**：401/404/429 都有针对性的中文提示，告诉你下一步该改哪里。

## 五、切换模型 / 修改人设

- 模型：编辑 `public/chatbot.html` 顶部的 `const MODEL`，或在 `.env` 改 `DEFAULT_MODEL`。
- 人设（System Prompt）：编辑 `public/chatbot.html` 顶部的 `const SYSTEM_PROMPT`。
