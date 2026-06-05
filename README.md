# Uradio

AI 个人电台 — 你的全天候 DJ，懂你的音乐品味。

### 核心功能

- **AI DJ 对话** — 自然语言点歌、切歌、搜索，DJ 根据你的品味推荐歌曲
- **电台模式** — DJ 在曲风切换时自动串场，每 5-10 首插入推荐歌单
- **开场白** — 首次播放时 DJ 根据时段生成欢迎语
- **日推播放** — 接入网易云音乐日推，自动获取播放列表
- **时段感知** — DJ 根据早晚时段调整推荐曲风和话术
- **TTS 语音** — Azure TTS 流式合成，DJ 回复带语音朗读

### 技术栈

| 层       | 技术                                        |
| -------- | ------------------------------------------- |
| 前端     | React 19 + TypeScript + Vite + Tailwind CSS |
| 后端     | NestJS + TypeScript + MySQL + TypeORM       |
| 实时通信 | Socket.IO (WebSocket)                       |
| AI       | DeepSeek API (LLM) + Azure TTS              |
|          |                                             |

### 项目结构

```
Uradio/
├── frontend/          # React SPA
│   └── src/
│       ├── components/   # Clock, Player, Queue, Chat, Login
│       ├── api/          # HTTP + WebSocket 接口
│       └── utils.ts
├── backend/           # NestJS API
│   └── src/
│       ├── chat/         # 对话 + WebSocket Gateway
│       ├── tts/          # TTS + 预取 + 串场
│       ├── llm/          # DeepSeek LLM 封装
│       ├── music/        # 网易云音乐 API
│       ├── scheduler/    # 时段排程
│       ├── state/        # 播放状态管理
│       └── user/         # 用户 + 口味配置
├── user-data/         # DJ 人格 / 口味 / 作息 / 心情规则
└── 文档/              # PRD + 待办清单 + 优化计划
```

### 快速开始

**前置**：Node.js 18+、MySQL、网易云音乐账号

```bash
# 1. 后端
cd backend
cp .env.example .env          # 填入 API Key 和数据库配置
npm install
npm run start:dev

# 2. 前端
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

**环境变量** (`backend/.env`):

| 变量                                | 说明                          |
| ----------------------------------- | ----------------------------- |
| `LLM_API_KEY`                     | DeepSeek API Key              |
| `LLM_MODEL`                       | 模型名                        |
| `AZURE_SPEECH_KEY`                | Azure TTS Key                 |
| `AZURE_SPEECH_REGION`             | Azure 区域                    |
| `DB_HOST/PORT/USER/PASS/DATABASE` | MySQL 配置                    |
| `NETEASE_COOKIE`                  | 网易云 Cookie（前端登录获取） |

### 用户数据

编辑 `user-data/` 目录下的文件定制 DJ 行为：

- `dj-persona.md` — DJ 人设
- `taste.md` — 音乐口味与禁忌
- `routines.md` — 每日作息
- `mood-rules.md` — 心情→曲风映射
