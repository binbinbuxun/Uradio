import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlayHistory, PlayTrigger } from './play-history.entity';

@Injectable()
export class PlayHistoryService {
  private readonly logger = new Logger(PlayHistoryService.name);

  constructor(
    @InjectRepository(PlayHistory)
    private readonly playHistoryRepo: Repository<PlayHistory>,
  ) {}

  /**
   * 记录一次播放事件
   */
  async record(params: {
    songId: string;
    title: string;
    artist?: string;
    album?: string;
    coverUrl?: string;
    duration?: number;
    trigger: PlayTrigger;
    chatId?: string;
    position?: number;
  }): Promise<PlayHistory> {
    const entry = this.playHistoryRepo.create({
      songId: params.songId,
      title: params.title,
      artist: params.artist || '',
      album: params.album || '',
      coverUrl: params.coverUrl || '',
      duration: params.duration || 0,
      trigger: params.trigger,
      chatId: params.chatId ?? null,
      position: params.position || 0,
    });

    try {
      const saved = await this.playHistoryRepo.save(entry);
      this.logger.debug(`Recorded play: ${params.title} - ${params.artist} (${params.trigger})`);
      return saved;
    } catch (e) {
      this.logger.warn(`Failed to record play history: ${e}`);
      return entry;
    }
  }

  /**
   * 获取最近 N 首播放记录 (用于上下文)
   */
  async getRecent(count = 5): Promise<PlayHistory[]> {
    const records = await this.playHistoryRepo.find({
      order: { playedAt: 'DESC' },
      take: count,
    });
    return records.reverse();
  }

  /**
   * 获取格式化的最近播放文本 (用于 systemContext)
   */
  async getRecentFormatted(count = 5): Promise<string> {
    const records = await this.getRecent(count);
    if (records.length === 0) return '无';
    return records
      .map(r => `${r.title}${r.artist ? ' - ' + r.artist : ''}`)
      .join(', ');
  }

  /**
   * 获取某首歌的播放次数
   */
  async getPlayCount(songId: string): Promise<number> {
    return this.playHistoryRepo.count({ where: { songId } });
  }

  /**
   * 获取最近 N 小时内的播放记录
   */
  async getRecentByHours(hours = 24, limit = 100): Promise<PlayHistory[]> {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const records = await this.playHistoryRepo
      .createQueryBuilder('ph')
      .where('ph.playedAt >= :since', { since })
      .orderBy('ph.playedAt', 'DESC')
      .take(limit)
      .getMany();
    return records.reverse();
  }

  /**
   * 获取播放统计: 各触发方式的次数
   */
  async getTriggerStats(): Promise<Record<string, number>> {
    const result = await this.playHistoryRepo
      .createQueryBuilder('ph')
      .select('ph.trigger', 'trigger')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ph.trigger')
      .getRawMany();
    const stats: Record<string, number> = {};
    for (const row of result) {
      stats[row.trigger] = parseInt(row.count, 10);
    }
    return stats;
  }
}
