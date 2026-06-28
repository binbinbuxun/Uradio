import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface StructuredResponse {
  say: string;
  play: { keyword: string; title?: string; artist?: string }[];
  reason: string;
  action: 'play' | 'pause' | 'next' | 'prev' | null;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly personaPath: string;
  private readonly primaryModel: string;
  private readonly lightModel: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('LLM_API_KEY') || '';
    this.apiUrl = this.config.get<string>('LLM_API_URL') || 'https://api.deepseek.com/v1/chat/completions';
    this.personaPath = this.config.get<string>('DJ_PERSONA_PATH')
      || join(process.cwd(), '..', 'user-data', 'dj-persona.md');
    this.primaryModel = this.config.get<string>('LLM_MODEL') || 'deepseek-chat';
    this.lightModel = this.resolveLightModel();
  }

  // persona 文件按优先级加载，超预算时从低优先级截断/跳过
  private readonly PERSONA_BUDGET = 6000;

  // B: keyword 规则共享常量，所有涉及搜索关键词的 prompt 共用
  private readonly KEYWORD_RULES = `### keyword 规则（最关键）

keyword 是用于音乐搜索引擎的精确搜索词，必须符合以下规则：
- 格式：歌名、歌手名、或"歌手名 歌名"
- 绝对不要写描述性文本或情绪表达
- **只推荐原唱/官方版本，绝不推荐翻唱**，keyword 必须包含原唱歌手名以确保匹配原唱
- 正确示例：✅ "稻香 周杰伦" ✅ "Miles Davis" ✅ "菊次郎的夏天 久石让" ✅ "好久不见 陈奕迅"
- 错误示例：❌ "一些轻松的爵士乐" ❌ "适合下雨听的歌" ❌ "安静的钢琴曲" ❌ "稻香 翻唱"`;

  private resolveLightModel(): string {
    const configured = this.config.get<string>('LLM_LIGHT_MODEL')?.trim();
    if (configured) return configured;

    const primary = this.config.get<string>('LLM_MODEL') || 'deepseek-chat';
    if (/reasoner|thinking|deepseek-v4-flash/i.test(primary)) {
      this.logger.log(`LLM light model fallback: ${primary} -> deepseek-chat`);
      return 'deepseek-chat';
    }
    return primary;
  }

  // P1-1: Function Calling 工具定义（OpenAI 兼容格式）
  private readonly DJ_REPLY_TOOL = {
    type: 'function' as const,
    function: {
      name: 'dj_reply',
      description: 'AI DJ 的结构化回复。根据用户输入和上下文，生成自然口语回复，并可选择推荐歌曲。',
      parameters: {
        type: 'object' as const,
        properties: {
          say: {
            type: 'string' as const,
            description: 'DJ 对用户的口语回复，2-3句，自然亲切。不加书名号《》，歌曲信息放在 play 里。',
          },
          play: {
            type: 'array' as const,
            description: '推荐给用户的歌曲列表。不需要推荐时为空数组。每次最多推荐1首，除非用户明确要求多首。',
            items: {
              type: 'object' as const,
              properties: {
                keyword: {
                  type: 'string' as const,
                  description: '用于音乐搜索引擎的精确关键词。格式：歌名、歌手名、或"歌手名 歌名"。必须包含原唱歌手名，绝不推荐翻唱版本。示例："稻香 周杰伦"、"Miles Davis"、"好久不见 陈奕迅"。',
                },
                title: {
                  type: 'string' as const,
                  description: '歌曲名，与 keyword 对应。',
                },
                artist: {
                  type: 'string' as const,
                  description: '歌手名，必须是原唱歌手。',
                },
              },
              required: ['keyword'],
            },
          },
          reason: {
            type: 'string' as const,
            description: '推荐理由，一句话解释为什么推荐这首歌。无推荐时为空字符串。',
          },
          action: {
            type: 'string' as const,
            description: '需要执行的播放控制指令。不需要时省略或为 null。',
            enum: ['play', 'pause', 'next', 'prev'],
          },
        },
        required: ['say'],
      },
    },
  };

  /**
   * 净化 say 字段：去除历史上下文注入的系统标记，防止 LLM 模仿输出
   * 去掉 [推荐: ...] (旧格式) 和 [系统记录: ...] (新格式)
   */
  private sanitizeSay(say: string): string {
    if (!say) return say;
    const cleaned = say
      .replace(/\s*\[[^:\]]+:[^\]]*\]\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return this.dedupeRepeatedSentences(cleaned);
  }

  private dedupeRepeatedSentences(text: string): string {
    const segments = text
      .split(/(?<=[。！？!?；;])/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length <= 1) {
      return text.trim();
    }

    const deduped: string[] = [];
    for (const segment of segments) {
      const normalized = segment.replace(/\s+/g, '');
      const prev = deduped[deduped.length - 1];
      if (prev && prev.replace(/\s+/g, '') === normalized) {
        continue;
      }
      deduped.push(segment);
    }

    return deduped.join(' ').trim();
  }

  private finalizeSegueText(text: string, nextTitle: string, nextArtist: string): string {
    const artistPrefix = nextArtist ? nextArtist + '的' : '';
    const fallback = '接下来这首，听听' + artistPrefix + nextTitle + '。';
    const cleaned = this.sanitizeSay(text)
      .replace(/^[\u201c\u201d"' + "'" + '`]+|[\u201c\u201d"' + "'" + '`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return fallback;

    const stripped = cleaned.replace(/[\uFF0C\u3001\uFF1A\uFF1B,;\-\u2014\u2013\s]+$/g, '').trim();
    if (!stripped || stripped.length < 6) return fallback;

    if (/[\u3002\uFF01\uFF1F!?]$/.test(cleaned)) {
      return cleaned;
    }

    if (/[\uFF0C\u3001\uFF1A\uFF1B,;\-\u2014\u2013]$/.test(cleaned)) {
      return stripped + '，接下来听' + artistPrefix + nextTitle + '。';
    }

    return stripped + '。';
  }

  private parseSongLine(line: string): { keyword: string; title?: string; artist?: string } | null {
    const cleaned = line
      .replace(/^[-*\u2022]+\s*/, '')
      .replace(/^\d+\s*[.)\u3001]\s*/, '')
      .trim();
    if (!cleaned) return null;

    const quoted = cleaned.match(/\u300a([^\u300b]+)\u300b/);
    if (quoted) {
      const title = quoted[1].trim();
      const rest = cleaned
        .replace(quoted[0], '')
        .replace(/^[\s:\uFF1A\-\u2013\u2014]+|[\s:\uFF1A\-\u2013\u2014]+$/g, '')
        .replace(/^\u7684+|\u7684+$/g, '')
        .trim();
      return {
        keyword: rest ? `${title} ${rest}` : title,
        title,
        artist: rest || undefined,
      };
    }

    const pairMatch = cleaned.match(/^(.+?)\s*[\-\u2013\u2014]\s*(.+)$/);
    if (pairMatch) {
      const title = pairMatch[1].trim();
      const artist = pairMatch[2].trim();
      if (title && artist) {
        return {
          keyword: `${title} ${artist}`,
          title,
          artist,
        };
      }
    }

    return null;
  }

  private parsePlainTextStructuredReply(raw: string): StructuredResponse {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sayLines: string[] = [];
    const play: StructuredResponse['play'] = [];

    for (const line of lines) {
      const looksLikeSongLine = /^[-*\u2022]\s+/.test(line)
        || /^\d+\s*[.)\u3001]\s+/.test(line)
        || /^[^\n.!?\u3002\uff01\uff1f]{1,80}\s*[\-\u2013\u2014]\s*[^\n.!?\u3002\uff01\uff1f]{1,80}$/.test(line);

      if (looksLikeSongLine) {
        const parsed = this.parseSongLine(line);
        if (parsed) {
          play.push(parsed);
          continue;
        }
      }

      sayLines.push(line);
    }

    if (play.length === 0) {
      const songMatches = raw.match(/《(.+?)》/g);
      if (songMatches) {
        for (const match of songMatches) {
          const title = match.replace(/[《》]/g, '').trim();
          if (title) {
            play.push({ keyword: title, title });
          }
        }
      }
    }

    return {
      say: this.sanitizeSay(sayLines.join(' ').trim()),
      play,
      reason: '',
      action: null,
    };
  }

  /**
   * 智能 persona 拼装：按优先级加载文件，超预算时从最低优先级截断/跳过
   * 优先级: dj-persona(1) > mood-rules(2) > taste(3) > routines(4)
   */
  private getPersona(): string {
    const userDataDir = join(process.cwd(), '..', 'user-data');

    const filePriority = [
      { name: 'DJ人格', path: this.personaPath, priority: 1 },
      { name: '心情映射', path: join(userDataDir, 'mood-rules.md'), priority: 2 },
      { name: '音乐品味', path: join(userDataDir, 'taste.md'), priority: 3 },
      { name: '作息规律', path: join(userDataDir, 'routines.md'), priority: 4 },
    ];

    const loadedParts: { name: string; content: string; priority: number }[] = [];

    for (const file of filePriority) {
      if (existsSync(file.path)) {
        try {
          const content = readFileSync(file.path, 'utf-8');
          loadedParts.push({ name: file.name, content, priority: file.priority });
        } catch (e) {
          this.logger.warn(`Failed to read ${file.name} file: ${e}`);
        }
      }
    }

    if (loadedParts.length === 0) {
      return '你是 Uradio 的 AI DJ，简短自然地回复用户。';
    }

    const totalLen = loadedParts.reduce((sum, p) => sum + p.content.length, 0);
    if (totalLen <= this.PERSONA_BUDGET) {
      return loadedParts.map(p => p.content).join('\n\n---\n\n');
    }

    // 超预算：按优先级从高到低保留，低优先级截断或跳过
    const sorted = [...loadedParts].sort((a, b) => a.priority - b.priority);
    const resultParts: string[] = [];
    let remaining = this.PERSONA_BUDGET;

    for (const part of sorted) {
      if (part.content.length <= remaining) {
        resultParts.push(part.content);
        remaining -= part.content.length + 10;
      } else if (remaining > 200) {
        const truncated = part.content.slice(0, remaining - 10);
        this.logger.warn(`Persona budget: truncated ${part.name} from ${part.content.length} to ${truncated.length} chars`);
        resultParts.push(truncated);
        break;
      } else {
        this.logger.warn(`Persona budget: skipped ${part.name} (${part.content.length} chars)`);
        break;
      }
    }

    return resultParts.join('\n\n---\n\n');
  }

  async generateSegue(
    currentTitle: string,
    currentArtist: string,
    nextTitle: string,
    nextArtist: string,
    slotContext: string,
  ): Promise<string | null> {
    if (!this.apiKey) {
      this.logger.debug('LLM_API_KEY not configured, skipping segue generation');
      return null;
    }

    const persona = this.getPersona();

    // A: persona 放 system 消息，任务描述和具体输入放 user 消息
    const systemContent = persona;
    const userContent = `${slotContext}

为歌曲切换做串场介绍。
当前：${currentArtist} 的《${currentTitle}》
下一首：${nextArtist} 的《${nextTitle}》
要求：
- 只输出1句完整串场词，不要分段，不要解释
- 30字以内，自然有温度
- 结尾必须用句号、问号或叹号
- 不能以逗号、顿号、冒号、分号、省略号或破折号结尾
- 不要只写半句意象，例如“从回声里走出来，”这种不完整表达。`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.lightModel,
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
          ],
          max_tokens: 120,
          temperature: 0.8,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`LLM API error: ${response.status}, body: ${body.slice(0, 300)}`);
        return null;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      return text ? this.finalizeSegueText(text, nextTitle, nextArtist) : null;
    } catch (error) {
      this.logger.error(`LLM request failed: ${error}`);
      return null;
    }
  }

  async classifySongGenre(title: string, artist: string): Promise<string[]> {
    if (!this.apiKey) return [];

    // A: 用 system 消息定义任务角色
    const systemContent = '你是音乐流派分类专家。根据歌曲信息判断其曲风流派。';
    const userContent = `判断这首歌的曲风流派：${artist} 的《${title}》
从以下流派中选择最匹配的 1-3 个：流行、摇滚、民谣、电子、说唱、爵士、R&B、古典、乡村、原声、舞曲、灵魂、放克、雷鬼、金属、朋克、独立、氛围、低保真、波萨诺瓦、世界音乐
只输出流派名称，用逗号分隔，不要其他内容。如："流行, R&B"`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get<string>('LLM_MODEL') || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
          ],
          max_tokens: 30,
          temperature: 0.3,
        }),
      });

      if (!response.ok) return [];
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) return [];

      return text.split(/[,，、]/).map(g => g.trim()).filter(g => g.length > 0);
    } catch {
      return [];
    }
  }

  async chat(messages: { role: string; content: string }[]): Promise<string | null> {
    if (!this.apiKey) {
      this.logger.debug('LLM_API_KEY not configured');
      return null;
    }

    const persona = this.getPersona();

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get<string>('LLM_MODEL') || 'deepseek-chat',
          messages: [
            { role: 'system', content: persona },
            ...messages,
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`LLM API error: ${response.status}, body: ${body.slice(0, 300)}`);
        return null;
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch (error) {
      this.logger.error(`LLM request failed: ${error}`);
      return null;
    }
  }

  async generateOpening(slotContext: string): Promise<{ say: string } | null> {
    if (!this.apiKey) return null;

    const persona = this.getPersona();

    // A: persona 放 system 消息，任务描述和具体输入放 user 消息
    const systemContent = persona;
    const userContent = `${slotContext}

主持 Uradio 电台节目开场。
作为电台 DJ，欢迎听众收听 Uradio，介绍当前时段和氛围，预告接下来会播放的音乐风格。
要求：2-3句话，40字以内，自然有温度，像真正电台 DJ 开场。只输出开场词文本。`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.lightModel,
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
          ],
          max_tokens: 180,
          temperature: 0.8,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`LLM opening API error: ${response.status}, body: ${body.slice(0, 300)}`);
        return null;
      }
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        this.logger.warn(`LLM opening returned empty content: ${JSON.stringify(data).slice(0, 300)}`);
        return null;
      }
      return { say: this.sanitizeSay(text) };
    } catch (error) {
      this.logger.error(`LLM opening request failed: ${error}`);
      return null;
    }
  }

  async generateRecommendation(
    recentTitles: string[],
    slotContext: string,
  ): Promise<{ say: string; play: { keyword: string; title?: string; artist?: string; reason?: string }[] } | null> {
    if (!this.apiKey) return null;

    const persona = this.getPersona();
    const recentList = recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n');

    // A: persona 放 system 消息，任务+keyword规则也放在 system
    // B: keyword 规则使用共享常量 KEYWORD_RULES
    const systemContent = `${persona}\n\n---\n\n## 输出规范\n\n${this.KEYWORD_RULES}`;

    const userContent = `${slotContext}

最近播放的歌曲：
${recentList}

请根据最近播放的曲风和你对听众口味的了解，推荐 2-3 首歌，每首歌附带一句话推荐理由。

输出格式（严格 JSON）：
{"say":"DJ口头推荐语（2-3句，自然口语，向听众介绍你要推荐的歌）","play":[{"keyword":"歌名 歌手","title":"歌名","artist":"歌手","reason":"推荐理由（一句话）"}]}

要求：say 不要包含书名号《》，歌名信息放在 play 里。play 数组包含 2-3 首歌。keyword 必须是精确搜索词，不要写描述性文本。`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.lightModel,
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
          ],
          max_tokens: 480,
          temperature: 0.8,
        }),
      });

      if (!response.ok) return null;
      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;

      const jsonStr = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      try {
        const parsed = JSON.parse(jsonStr);
        return {
          say: this.sanitizeSay(parsed.say || ''),
          play: Array.isArray(parsed.play) ? parsed.play.slice(0, 3) : [],
        };
      } catch {
        this.logger.warn('Failed to parse recommendation JSON');
        return null;
      }
    } catch (error) {
      this.logger.error(`LLM recommendation request failed: ${error}`);
      return null;
    }
  }

  /**
   * 结构化对话：返回 {say, play[], reason, action}
   * @param messages 对话历史 + 当前用户消息（纯用户原话，不含系统指令）
   * @param systemContext 系统级上下文（时段、播放状态、已执行操作等），作为独立 system 消息区段注入
   */
  async chatStructured(
    messages: { role: string; content: string }[],
    systemContext?: string,
  ): Promise<StructuredResponse | null> {
    if (!this.apiKey) {
      this.logger.debug('LLM_API_KEY not configured');
      return null;
    }

    const persona = this.getPersona();

    // P0-5: 格式规范与行为规则分离
    // B: keyword 规则使用共享常量 KEYWORD_RULES
    // P0-3: few-shot 示例覆盖闲聊/点歌/情绪推荐三种场景
    const formatSpec = `\n\n---\n\n## 输出规范

### JSON 格式

你必须以 JSON 格式回复，不要输出其他内容。格式如下：
{"say":"DJ说的话","play":[{"keyword":"搜索词","title":"歌名(可选)","artist":"歌手(可选)"}],"reason":"推荐理由","action":null}

${this.KEYWORD_RULES}

### 行为规则

- say: 自然口语回复，2-3句。不加书名号《》，**绝不在此列出歌名**，歌曲信息必须且只能放在 play 里
- play: 推荐歌曲列表。不需要推荐时为空数组 []
- reason: 推荐理由一句话。无推荐时为 ""
- action: 需要切换播放状态时填 "play"/"pause"/"next"/"prev"，否则 null
- 直接输出 JSON，不要加 Markdown 代码块标记

### 推荐决策规则

不是每次对话都要推荐歌。请尽量克制，只在用户明确想听歌时才推荐：
- 用户在闲聊、倾诉情绪但没有明确要歌 → play 为空数组 []（这是最常见的情况）
- 用户说"随便聊聊""聊聊吧"等 → play 为空数组 []
- 用户明确说"来一首""放一首""想听xxx" → 推荐 1 首，最多 2 首
- 用户说"推荐几首xxx的歌""来几首xxx的歌" → 推荐该歌手的 1-2 首代表作，必须放在 play 里
- 用户描述情绪但没提音乐 → 先回应情绪，play 为空数组 []，除非语境非常明确暗示需要音乐
- 每次推荐不超过 1 首，除非用户明确说"多来几首"或"再来一首"
- 先回应人的情绪，再考虑是否需要递歌
- **绝不推荐翻唱版本**，只推荐原唱。keyword 必须包含原唱歌手名
- **重要：当用户想听歌时，歌曲信息只能通过 play 字段传递，禁止在 say 文本中用书名号或列举歌名**

### 参考示例

用户"今天心情不太好" → {"say":"嗯，心情低落的时候，有时候什么都不想听，有时候又需要一首安静的歌陪着。要不要来点温柔的？","play":[],"reason":"","action":null}

用户"今天好累，来首安静的吧" → {"say":"辛苦了，给你放一首安静的歌。","play":[{"keyword":"好久不见 陈奕迅","title":"好久不见","artist":"陈奕迅"}],"reason":"陈奕迅的深情嗓音很适合疲惫时静静听","action":null}

用户"放一首周杰伦的稻香" → {"say":"来了，一首充满阳光的歌。","play":[{"keyword":"稻香 周杰伦","title":"稻香","artist":"周杰伦"}],"reason":"轻快的旋律能带来好心情","action":null}

用户"推荐几首周杰伦的歌" → {"say":"好，给你推荐周杰伦的经典。","play":[{"keyword":"七里香 周杰伦","title":"七里香","artist":"周杰伦"},{"keyword":"稻香 周杰伦","title":"稻香","artist":"周杰伦"}],"reason":"周杰伦的代表作","action":null}

用户"随便聊聊天吧" → {"say":"好啊，有什么想聊的？音乐、生活，都可以聊。","play":[],"reason":"","action":null}

用户"帮我切歌" → {"say":"好，换一首。","play":[],"reason":"","action":"next"}

用户"来首安静的歌" → {"say":"嗯，给你一首安静的。","play":[{"keyword":"菊次郎的夏天 久石让","title":"菊次郎的夏天","artist":"久石让"}],"reason":"久石让的钢琴旋律温柔又有画面感","action":null}`;

    // P0-2: systemContext 作为独立区段，不再混入 user message
    // P0-1: 使用完整 persona，不做硬截断（getPersona 内部已有优先级管理）
    const systemContent = systemContext
      ? `${persona}${formatSpec}\n\n---\n\n## 当前上下文\n\n${systemContext}`
      : `${persona}${formatSpec}`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get<string>('LLM_MODEL') || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemContent },
            ...messages,
          ],
          max_tokens: 600,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`LLM API error: ${response.status}, model=${this.config.get<string>('LLM_MODEL')}, body=${body.slice(0, 300)}`);
        return null;
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;

      // 智能提取 JSON：找最外层花括号块
      const jsonMatch = raw.match(/\{[\s\S]*"say"[\s\S]*"play"[\s\S]*\}/);
      if (!jsonMatch) {
        return this.parsePlainTextStructuredReply(raw);
      }

      const jsonStr = jsonMatch[0].replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      try {
        const parsed = JSON.parse(jsonStr);
        // 如果 JSON 前有实质性文本，用它作为 say（而非 JSON 内的 say）
        const prefix = raw.slice(0, raw.indexOf(jsonMatch[0])).trim();
        return {
          say: this.sanitizeSay(prefix.length > 5 ? prefix : (parsed.say || '')),
          play: Array.isArray(parsed.play) ? parsed.play : [],
          reason: parsed.reason || '',
          action: ['play', 'pause', 'next', 'prev'].includes(parsed.action) ? parsed.action : null,
        };
      } catch {
        // JSON 解析失败 → 退化为纯文本
        this.logger.warn('Failed to parse structured JSON, falling back to plain text');
        return this.parsePlainTextStructuredReply(raw);
      }
    } catch (error) {
      this.logger.error(`LLM structured request failed: ${error}`);
      return null;
    }
  }

  /**
   * P1-1: Function Calling 版本的结构化对话
   * 使用 OpenAI 兼容的 tools/tool_calls 参数，让 LLM 直接返回结构化函数调用
   * 替代 prompt 模拟 JSON 输出，显著提升准确性和稳定性
   */
  async chatStructuredWithFC(
    messages: { role: string; content: string }[],
    systemContext?: string,
  ): Promise<StructuredResponse | null> {
    if (!this.apiKey) {
      this.logger.debug('LLM_API_KEY not configured');
      return null;
    }

    const persona = this.getPersona();

    // 行为规则（不含 JSON 格式说明，因为用 Function Calling 替代）
    const behaviorSpec = `\n\n---\n\n## 行为规则

### 回复风格
- say: 自然口语回复，2-3句。不加书名号《》，**绝不在此列出歌名**，歌曲信息必须且只能放在 play 里
- play: 推荐歌曲列表。不需要推荐时为空数组 []
- reason: 推荐理由一句话。无推荐时为 ""
- action: 需要切换播放状态时填 "play"/"pause"/"next"/"prev"，否则省略

### 推荐决策规则
不是每次对话都要推荐歌。请尽量克制，只在用户明确想听歌时才推荐：
- 用户在闲聊、倾诉情绪但没有明确要歌 → play 为空数组 []（这是最常见的情况）
- 用户说"随便聊聊""聊聊吧"等 → play 为空数组 []
- 用户明确说"来一首""放一首""想听xxx" → 推荐 1 首，最多 2 首
- 用户说"推荐几首xxx的歌""来几首xxx的歌" → 推荐该歌手的 1-2 首代表作，必须放在 play 里
- 用户描述情绪但没提音乐 → 先回应情绪，play 为空数组 []，除非语境非常明确暗示需要音乐
- 每次推荐不超过 1 首，除非用户明确说"多来几首"或"再来一首"
- 先回应人的情绪，再考虑是否需要递歌
- **绝不推荐翻唱版本**，只推荐原唱。keyword 必须包含原唱歌手名
- **重要：当用户想听歌时，歌曲信息只能通过 play 字段传递，禁止在 say 文本中用书名号或列举歌名**

### 参考示例
用户"今天心情不太好" → say="嗯，心情低落的时候，有时候什么都不想听，有时候又需要一首安静的歌陪着。要不要来点温柔的？", play=[]
用户"今天好累，来首安静的吧" → say="辛苦了，给你放一首安静的歌。", play=[{"keyword":"好久不见 陈奕迅","title":"好久不见","artist":"陈奕迅"}]
用户"放一首周杰伦的稻香" → say="来了，一首充满阳光的歌。", play=[{"keyword":"稻香 周杰伦","title":"稻香","artist":"周杰伦"}]
用户"随便聊聊天吧" → say="好啊，有什么想聊的？音乐、生活，都可以聊。", play=[]
用户"帮我切歌" → say="好，换一首。", play=[], action="next"
用户"来首安静的歌" → say="嗯，给你一首安静的。", play=[{"keyword":"菊次郎的夏天 久石让","title":"菊次郎的夏天","artist":"久石让"}]
用户"推荐几首周杰伦的歌" → say="好，给你推荐周杰伦的经典。", play=[{"keyword":"七里香 周杰伦","title":"七里香","artist":"周杰伦"},{"keyword":"稻香 周杰伦","title":"稻香","artist":"周杰伦"}]
用户"来点陈奕迅的歌" → say="来两首陈奕迅的。", play=[{"keyword":"好久不见 陈奕迅","title":"好久不见","artist":"陈奕迅"}]`;

    const systemContent = systemContext
      ? `${persona}${behaviorSpec}\n\n---\n\n## 当前上下文\n\n${systemContext}`
      : `${persona}${behaviorSpec}`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get<string>('LLM_MODEL') || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemContent },
            ...messages.filter(m => m.role === 'user' || m.role === 'assistant'),
          ],
          tools: [this.DJ_REPLY_TOOL],
          // 注意: deepseek 思考模式(如 deepseek-v4-flash)不支持 tool_choice 强制参数，
          // 用 "auto" 让模型自然选择，依赖 prompt 引导其调用 dj_reply 函数
          tool_choice: 'auto',
          max_tokens: 600,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`LLM API error (FC): ${response.status}, body=${body.slice(0, 300)}`);
        // 降级：fallback 到 chatStructured
        this.logger.warn('Function Calling failed, falling back to chatStructured');
        return this.chatStructured(messages, systemContext);
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;

      // 检查是否有 tool_calls
      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        if (toolCall.function?.name === 'dj_reply') {
          const argsStr = toolCall.function.arguments;
          try {
            const parsed = JSON.parse(argsStr);
            return {
              say: this.sanitizeSay(parsed.say || ''),
              play: Array.isArray(parsed.play) ? parsed.play : [],
              reason: parsed.reason || '',
              action: ['play', 'pause', 'next', 'prev'].includes(parsed.action) ? parsed.action : null,
            };
          } catch (e) {
            this.logger.error(`Failed to parse function arguments: ${argsStr}, error: ${e}`);
            // 降级到 chatStructured
            return this.chatStructured(messages, systemContext);
          }
        }
      }

      // 如果没有 tool_calls（可能模型选择了直接回复），降级
      const content = message?.content?.trim();
      if (content) {
        this.logger.warn('Function Calling returned plain text instead of tool_call, parsing plain text response');
        return this.parsePlainTextStructuredReply(content);
      }

      return null;
    } catch (error) {
      this.logger.error(`LLM Function Calling request failed: ${error}`);
      // 降级到 chatStructured
      return this.chatStructured(messages, systemContext);
    }
  }

  /**
   * P1-2: 搜索反馈环 — 当关键词搜索失败时，让 LLM 修正关键词
   * 返回修正后的关键词列表（与输入顺序对应）
   */
  async refineSearchKeywords(
    failedItems: { keyword: string; title?: string; artist?: string }[],
    searchResults: { keyword: string; results: string }[],
  ): Promise<{ keyword: string; title?: string; artist?: string }[]> {
    if (!this.apiKey || failedItems.length === 0) return failedItems;

    const persona = this.getPersona();
    const feedbackLines = failedItems.map((item, i) => {
      const searchInfo = searchResults.find(s => s.keyword === item.keyword);
      return `- 原关键词："${item.keyword}"${item.title ? ` 歌名《${item.title}》` : ''}${item.artist ? ` 歌手${item.artist}` : ''} → 搜索结果：${searchInfo?.results || '无结果'}`;
    });

    const systemContent = persona;
    const userContent = `以下是我用关键词搜索音乐时失败的情况：
${feedbackLines.join('\n')}

请为每个失败的关键词，给出 1-2 个修正后的搜索关键词。
修正原则：
1. 去掉可能的多余描述词，只保留核心歌名/歌手名
2. 如果歌名是英文名，尝试只用歌手名搜索
3. 如果歌手名有误，尝试只用歌名搜索
4. 关键词格式必须是"歌名"或"歌手名"或"歌手名 歌名"
5. **只推荐原唱/官方版本，绝不推荐翻唱**，修正后的关键词必须包含原唱歌手名

输出格式（严格 JSON 数组，顺序与输入对应）：
[{"keyword":"修正后的关键词","title":"歌名（如已知）","artist":"歌手名（如已知）"}]

只输出 JSON，不要其他内容。`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get<string>('LLM_MODEL') || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
          ],
          max_tokens: 400,
          temperature: 0.3,
        }),
      });

      if (!response.ok) return failedItems;

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) return failedItems;

      const jsonStr = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p: any) => ({
          keyword: p.keyword || '',
          title: p.title || undefined,
          artist: p.artist || undefined,
        })).filter((p: any) => p.keyword);
      }
      return failedItems;
    } catch (error) {
      this.logger.warn(`Failed to refine search keywords: ${error}`);
      return failedItems;
    }
  }
}

