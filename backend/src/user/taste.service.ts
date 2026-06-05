import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface UserTaste {
  genres: string[];
  artists: string[];
  moods: string[];
  dislike: string[];
  description: string;
}

@Injectable()
export class TasteService {
  private readonly logger = new Logger(TasteService.name);
  private readonly tastePath: string;

  constructor(private readonly config: ConfigService) {
    this.tastePath = this.config.get<string>('TASTE_FILE_PATH')
      || join(process.cwd(), '..', 'user-data', 'taste.md');
  }

  getTaste(): UserTaste {
    // 1. 尝试读取 taste.md 文件
    if (existsSync(this.tastePath)) {
      try {
        const content = readFileSync(this.tastePath, 'utf-8');
        return this.parseTasteFile(content);
      } catch (e) {
        this.logger.warn(`Failed to read taste file: ${e}`);
      }
    }

    // 2. 返回默认品味
    return this.getDefaultTaste();
  }

  private parseTasteFile(content: string): UserTaste {
    const taste: UserTaste = {
      genres: [],
      artists: [],
      moods: [],
      dislike: [],
      description: '',
    };

    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## ')) {
        currentSection = trimmed.slice(3).toLowerCase();
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const item = trimmed.slice(2).trim();
        switch (currentSection) {
          case 'genres':
          case '曲风':
            taste.genres.push(item);
            break;
          case 'artists':
          case '歌手':
            taste.artists.push(item);
            break;
          case 'moods':
          case '心情':
            taste.moods.push(item);
            break;
          case 'dislike':
          case '不喜欢':
            taste.dislike.push(item);
            break;
        }
      } else if (trimmed && !trimmed.startsWith('#') && currentSection === '') {
        taste.description += trimmed + ' ';
      }
    }

    taste.description = taste.description.trim() || '热爱音乐的用户';
    return taste;
  }

  private getDefaultTaste(): UserTaste {
    return {
      genres: ['Pop', 'Rock', 'Jazz', 'Electronic', 'R&B'],
      artists: [],
      moods: ['放松', '专注', '开心'],
      dislike: [],
      description: '音乐爱好者，喜欢多种风格',
    };
  }
}
