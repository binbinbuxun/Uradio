import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** 播放触发方式 */
export type PlayTrigger = 'user_request' | 'auto_next' | 'recommendation' | 'search' | 'chat_play' | 'manual';

@Entity()
@Index('idx_play_history_played_at', ['playedAt'])
@Index('idx_play_history_song_id', ['songId'])
export class PlayHistory {
  @PrimaryGeneratedColumn()
  id: number;

  /** 网易云歌曲 ID */
  @Column()
  songId: string;

  /** 歌名 */
  @Column()
  title: string;

  /** 歌手 */
  @Column({ default: '' })
  artist: string;

  /** 专辑 */
  @Column({ default: '' })
  album: string;

  /** 封面 URL */
  @Column({ default: '' })
  coverUrl: string;

  /** 歌曲时长(秒) */
  @Column({ default: 0 })
  duration: number;

  /** 触发方式 */
  @Column({ type: 'varchar', length: 32, default: 'auto_next' })
  trigger: PlayTrigger;

  /** 播放时间 */
  @CreateDateColumn()
  playedAt: Date;

  /** 关联的 chatId (如果是对话触发的) */
  @Column({ nullable: true, type: 'varchar', length: 64 })
  chatId: string | null;

  /** 播放到多少秒 (切歌时记录) */
  @Column({ default: 0 })
  position: number;
}
