import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export type IntentType =
  | 'next'
  | 'prev'
  | 'pause'
  | 'play'
  | 'add_song'
  | 'search_song'
  | 'remove_song'
  | 'volume_up'
  | 'volume_down'
  | null;

export interface DetectedIntent {
  type: IntentType;
  params?: {
    keyword?: string;
    index?: number;
    songName?: string;
  };
}

const CN_NUM: Record<string, number> = {
  '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

function parseChineseNum(str: string): number | undefined {
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  if (CN_NUM[str] !== undefined) return CN_NUM[str];
  const m = str.match(/^十([一二三四五六七八九])?$/);
  if (m) return 10 + (m[1] ? CN_NUM[m[1]] : 0);
  return undefined;
}

// 从配置文件加载关键词
let keywordsCache: Record<string, string[]> | null = null;

function loadKeywords(): Record<string, string[]> {
  if (keywordsCache) return keywordsCache;

  const configPath = process.env.INTENT_KEYWORDS_PATH
    || join(process.cwd(), '..', 'user-data', 'intent-keywords.json');

  if (existsSync(configPath)) {
    try {
      keywordsCache = JSON.parse(readFileSync(configPath, 'utf-8'));
      return keywordsCache!;
    } catch {
      // fall through
    }
  }

  // 默认关键词
  keywordsCache = {
    next: ['下一首', '切歌', '换一首', '跳过'],
    prev: ['上一首', '回退', '退回去', '往回'],
    pause: ['暂停', '停一下', '停'],
    play: ['继续'],
    add_song: ['来一首', '放一首', '给我放', '帮我放', '整一首', '来点', '来个'],
    search_song: ['播放', '我想听', '我要听', '听听', '想听', '帮我播放', '换到'],
    remove_song: ['删除', '移除', '去掉', '不要', '帮我删除', '帮我移除', '帮我去掉'],
    volume_up: ['音量大', '声音大', '调大音量', '调高音量', '大声'],
    volume_down: ['音量小', '声音小', '调小音量', '调低音量', '小声'],
  };
  return keywordsCache!;
}

export function reloadKeywords() {
  keywordsCache = null;
}

export function detectIntent(message: string): DetectedIntent {
  const msg = message.trim();
  const kw = loadKeywords();

  // --- 简单指令 (精确匹配) ---
  if (kw.next?.some(k => msg === k)) return { type: 'next' };
  if (kw.prev?.some(k => msg === k)) return { type: 'prev' };
  if (kw.pause?.some(k => msg === k)) return { type: 'pause' };
  if (kw.play?.some(k => msg === k)) return { type: 'play' };

  // --- 添加歌曲 (立即播放): 来一首/放一首... + 关键词 ---
  const addPatterns = kw.add_song?.join('|') || '';
  if (addPatterns) {
    const addMatch = msg.match(new RegExp(`(?:${addPatterns})\\s*(.+?)(?:的歌|的音乐|的歌曲|好不好|吧|怎么样)?$`));
    if (addMatch) {
      const keyword = addMatch[1].trim();
      if (keyword && keyword.length <= 20 && !/^(上|下|一|首|暂停|播放|继续)$/.test(keyword)) {
        return { type: 'add_song', params: { keyword } };
      }
    }
  }

  // --- 搜索歌曲 (显示卡片供选择): 播放/我想听... + 关键词 ---
  const searchPatterns = kw.search_song?.join('|') || '';
  if (searchPatterns) {
    const searchMatch = msg.match(new RegExp(`(?:${searchPatterns})\\s*(.+?)(?:的歌|的音乐|的歌曲|好不好|吧|怎么样)?$`));
    if (searchMatch) {
      const keyword = searchMatch[1].trim();
      if (keyword && keyword.length <= 20 && !/^(上|下|一|首|暂停|播放|继续)$/.test(keyword)) {
        return { type: 'search_song', params: { keyword } };
      }
    }
  }

  // --- 删除歌曲 by 位置 ---
  const removePatterns = kw.remove_song?.join('|') || '';
  if (removePatterns) {
    const removePosMatch = msg.match(new RegExp(`(?:${removePatterns})\\s*(?:第)?\\s*([一二三四五六七八九十百\\d]+)\\s*首`));
    if (removePosMatch) {
      const num = parseChineseNum(removePosMatch[1]);
      if (num !== undefined && num >= 1) {
        return { type: 'remove_song', params: { index: num } };
      }
    }

    // --- 删除歌曲 by 名称 ---
    const removeNameMatch = msg.match(new RegExp(`(?:${removePatterns})\\s*(.{1,20})$`));
    if (removeNameMatch) {
      const name = removeNameMatch[1].trim();
      if (name && name.length > 0 && !/^\d+首$/.test(name)) {
        return { type: 'remove_song', params: { songName: name } };
      }
    }
  }

  // --- 音量调节 ---
  const volUpPatterns = kw.volume_up?.join('|') || '';
  const volDownPatterns = kw.volume_down?.join('|') || '';
  if (volUpPatterns && new RegExp(`(?:${volUpPatterns})`).test(msg)) {
    return { type: 'volume_up' };
  }
  if (volDownPatterns && new RegExp(`(?:${volDownPatterns})`).test(msg)) {
    return { type: 'volume_down' };
  }

  return { type: null };
}
