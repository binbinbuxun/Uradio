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

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('LLM_API_KEY') || '';
    this.apiUrl = this.config.get<string>('LLM_API_URL') || 'https://api.deepseek.com/v1/chat/completions';
    this.personaPath = this.config.get<string>('DJ_PERSONA_PATH')
      || join(process.cwd(), '..', 'user-data', 'dj-persona.md');
  }

  private getPersona(): string {
    const userDataDir = join(process.cwd(), '..', 'user-data');
    const parts: string[] = [];

    // DJ 人格
    const personaFile = this.personaPath;
    if (existsSync(personaFile)) {
      try {
        parts.push(readFileSync(personaFile, 'utf-8'));
      } catch (e) {
        this.logger.warn(`Failed to read persona file: ${e}`);
      }
    }

    // 用户品味
    const tasteFile = join(userDataDir, 'taste.md');
    if (existsSync(tasteFile)) {
      try {
        parts.push(readFileSync(tasteFile, 'utf-8'));
      } catch (e) {
        this.logger.warn(`Failed to read taste file: ${e}`);
      }
    }

    // 作息规律
    const routinesFile = join(userDataDir, 'routines.md');
    if (existsSync(routinesFile)) {
      try {
        parts.push(readFileSync(routinesFile, 'utf-8'));
      } catch (e) {
        this.logger.warn(`Failed to read routines file: ${e}`);
      }
    }

    // 心情映射规则
    const moodRulesFile = join(userDataDir, 'mood-rules.md');
    if (existsSync(moodRulesFile)) {
      try {
        parts.push(readFileSync(moodRulesFile, 'utf-8'));
      } catch (e) {
        this.logger.warn(`Failed to read mood rules file: ${e}`);
      }
    }

    if (parts.length === 0) {
      return '你是 Uradio 的 AI DJ，简短自然地回复用户。';
    }

    return parts.join('\n\n---\n\n');
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

    const prompt = `${persona}

${slotContext}

任务：为歌曲切换做串场介绍。
当前：${currentArtist} 的《${currentTitle}》
下一首：${nextArtist} 的《${nextTitle}》
要求：30字以内，自然有温度，只输出串场词文本。`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get<string>('LLM_MODEL') || 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 60,
          temperature: 0.8,
        }),
      });

      if (!response.ok) {
        this.logger.error(`LLM API error: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch (error) {
      this.logger.error(`LLM request failed: ${error}`);
      return null;
    }
  }

  async classifySongGenre(title: string, artist: string): Promise<string[]> {
    if (!this.apiKey) return [];

    const prompt = `判断这首歌的曲风流派：${artist} 的《${title}》
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
          messages: [{ role: 'user', content: prompt }],
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
        this.logger.error(`LLM API error: ${response.status}`);
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

    const prompt = `${persona}

${slotContext}

任务：主持 Uradio 电台节目开场。
你作为电台 DJ，欢迎听众收听 Uradio，介绍当前时段和氛围，预告接下来会播放的音乐风格。
要求：2-3句话，40字以内，自然有温度，像真正电台 DJ 开场。只输出开场词文本。`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get<string>('LLM_MODEL') || 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 80,
          temperature: 0.8,
        }),
      });

      if (!response.ok) return null;
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      return text ? { say: text } : null;
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

    const prompt = `${persona}

${slotContext}

任务：作为电台 DJ，你已经连续播放了几首歌，现在想给听众推荐 2-3 首你可能喜欢的歌。

最近播放的歌曲：
${recentList}

请根据最近播放的曲风和你对听众口味的了解，推荐 2-3 首歌，每首歌附带一句话推荐理由。

输出格式（严格 JSON）：
{"say":"DJ口头推荐语（2-3句，自然口语，向听众介绍你要推荐的歌）","play":[{"keyword":"歌名 歌手（用于搜索）","reason":"推荐理由（一句话）"}]}

要求：say 不要包含书名号《》，歌名信息放在 play 里。play 数组包含 2-3 首歌。`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get<string>('LLM_MODEL') || 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 400,
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
          say: parsed.say || '',
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

  async chatStructured(messages: { role: string; content: string }[]): Promise<StructuredResponse | null> {
    if (!this.apiKey) {
      this.logger.debug('LLM_API_KEY not configured');
      return null;
    }

    const persona = this.getPersona();
    const formatHint = `\n\n---\n\n## 输出格式\n\n你必须以 JSON 格式回复，不要输出其他内容。格式如下：\n\n\`\`\`json\n{\n  "say": "DJ说的话（自然口语，2-3句）",\n  "play": [\n    { "keyword": "用于搜索的关键词", "title": "歌名(可选)", "artist": "歌手(可选)" }\n  ],\n  "reason": "推荐理由（一句话）",\n  "action": null\n}\n\`\`\`\n\n规则：\n- say: 你的口头回复，保持简短自然。不要在里面加书名号《》，歌曲信息在 play 字段里。\n- play: 要推荐的歌曲列表，每首歌给 keyword 用于搜索。不需要推荐时为空数组[]。\n- reason: 推荐理由，没有推荐时为空字符串""。\n- action: 如果需要切换播放状态，填 "play"/"pause"/"next"/"prev"，否则 null。\n- 不要输出 Markdown 代码块标记，直接输出 JSON 字符串。`;

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
            { role: 'system', content: persona + formatHint },
            ...messages,
          ],
          max_tokens: 600,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        this.logger.error(`LLM API error: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;

      // 尝试解析 JSON（处理可能的 Markdown 代码块包裹）
      const jsonStr = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      try {
        const parsed = JSON.parse(jsonStr);
        return {
          say: parsed.say || '',
          play: Array.isArray(parsed.play) ? parsed.play : [],
          reason: parsed.reason || '',
          action: ['play', 'pause', 'next', 'prev'].includes(parsed.action) ? parsed.action : null,
        };
      } catch {
        // JSON 解析失败 → 退化为纯文本（say = 原文本，play = 从《》提取）
        this.logger.warn('Failed to parse structured JSON, falling back to plain text');
        const songMatches = raw.match(/《(.+?)》/g);
        const play = songMatches
          ? songMatches.map(m => ({ keyword: m.replace(/[《》]/g, '').trim() }))
          : [];
        return { say: raw, play, reason: '', action: null };
      }
    } catch (error) {
      this.logger.error(`LLM structured request failed: ${error}`);
      return null;
    }
  }
}
